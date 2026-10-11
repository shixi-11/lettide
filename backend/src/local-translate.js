import { Worker } from 'node:worker_threads';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { languageCodes, normalizeLanguage } from './translation-language.js';

const WORKER = fileURLToPath(new URL('./local-translate-worker.js', import.meta.url));

/** Local, offline NLLB translation. The worker owns all model and network activity. */
export class LocalTranslator {
  #worker;
  #state = { state: 'checking', progress: 0, downloadedBytes: 0, totalBytes: 0, error: null, translation: null };
  #waiters = new Map();
  #nextId = 1;
  #downloadRequested = false;
  #workerFactory;
  #translateTimeoutMs;
  #queueTimeoutMs;
  #maxPendingTranslations;
  #cancelAckTimeoutMs;

  constructor({ modelDir = join(homedir(), '.lettide', 'models'), workerFactory = (url, options) => new Worker(url, options), translateTimeoutMs = (length) => Math.min(20 * 60_000, 5 * 60_000 + length * 10), queueTimeoutMs = (position) => Math.min(60 * 60_000 + 30_000, 30_000 + position * 20 * 60_000), maxPendingTranslations = 4, cancelAckTimeoutMs = 300 } = {}) {
    this.modelDir = resolve(modelDir);
    this.#workerFactory = workerFactory;
    this.#translateTimeoutMs = translateTimeoutMs;
    this.#queueTimeoutMs = queueTimeoutMs;
    this.#maxPendingTranslations = maxPendingTranslations;
    this.#cancelAckTimeoutMs = cancelAckTimeoutMs;
    this.#startWorker();
  }

  #startWorker() {
    const worker = this.#workerFactory(WORKER, { workerData: { modelDir: this.modelDir } });
    this.#worker = worker;
    worker.on('message', (message) => { if (this.#worker === worker) this.#message(message); });
    worker.on('error', (error) => { if (this.#worker === worker) this.#fail(error); });
    worker.on('exit', (code) => { if (this.#worker === worker && code && this.#state.state !== 'closed') this.#fail(new Error(`Translation worker exited (${code})`)); });
    worker.unref?.();
  }

  async status() { return structuredClone(this.#state); }

  async download() {
    if (this.#state.state === 'closed') throw new Error('Translator is closed');
    if (this.#state.state === 'checking') { this.#downloadRequested = true; return this.status(); }
    if (!['not_downloaded', 'error'].includes(this.#state.state)) return this.status();
    this.#state = { state: 'downloading', progress: 0, downloadedBytes: 0, totalBytes: this.#state.totalBytes, error: null };
    this.#worker.postMessage({ type: 'download' });
    return this.status();
  }

  async translate(text, targetLanguage, { sourceLanguage, requestId = null } = {}) {
    if (this.#state.state !== 'ready') throw new Error('Offline translation model is not ready');
    if (typeof text !== 'string' || !text.trim() || text.length > 100000) throw new Error('Invalid translation text');
    if (!languageCodes[targetLanguage]) throw new Error('Unsupported target language');
    if (sourceLanguage && !normalizeLanguage(sourceLanguage)) throw new Error('Unsupported source language');
    if (this.#waiters.size >= this.#maxPendingTranslations) throw new Error('Local translation queue is full. Wait for a translation to finish, then retry.');
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const queuePosition = this.#waiters.size;
      const waiter = { resolve, reject, activeTimeout: null, queueTimeout: null, cancelAckTimeout: null, phase: 'queued', timeoutMs: this.#translateTimeoutMs(text.length), requestId };
      waiter.queueTimeout = setTimeout(() => this.#timeout(id, 'queue'), this.#queueTimeoutMs(queuePosition));
      this.#waiters.set(id, waiter);
      this.#worker.postMessage({ type: 'translate', id, text, targetLanguage, sourceLanguage });
    });
  }

  async cancel(requestId) {
    if (!requestId) return false;
    const entry = [...this.#waiters.entries()].find(([, waiter]) => waiter.requestId === requestId);
    if (!entry) return false;
    const [id, waiter] = entry;
    if (waiter.phase !== 'queued') {
      await this.#cancelActive(id);
      return true;
    }
    waiter.cancelAckTimeout = setTimeout(() => { void this.#cancelActive(id); }, this.#cancelAckTimeoutMs);
    this.#worker?.postMessage({ type: 'cancel', id });
    return true;
  }

  async #cancelActive(id) {
    const waiter = this.#waiters.get(id);
    if (!waiter) return;
    this.#waiters.delete(id);
    clearTimeout(waiter.queueTimeout);
    clearTimeout(waiter.activeTimeout);
    clearTimeout(waiter.cancelAckTimeout);
    if (this.#state.translation?.requestId === waiter.requestId) this.#state.translation = null;
    waiter.reject(new Error('Local translation cancelled.'));
    await this.#restartWorker('Local translation cancelled; other pending requests were interrupted while the model restarted.');
  }

  #timeout(id, phase) {
    const waiter = this.#waiters.get(id);
    if (!waiter) return;
    this.#waiters.delete(id);
    clearTimeout(waiter.queueTimeout);
    clearTimeout(waiter.activeTimeout);
    waiter.reject(new Error(phase === 'queue'
      ? 'Local translation queue timed out. The model is restarting; wait until it is ready, then retry.'
      : 'Local translation timed out. The model is restarting; wait until it is ready, then retry.'));
    void this.#restartWorker();
  }

  async #restartWorker(interruptionMessage = 'Local translation was interrupted while the model restarted. Wait until it is ready, then retry.') {
    if (this.#state.state === 'closed') return;
    const previous = this.#worker;
    this.#state = { ...this.#state, state: 'loading', error: null, translation: null };
    for (const waiter of this.#waiters.values()) {
      clearTimeout(waiter.queueTimeout);
      clearTimeout(waiter.activeTimeout);
      clearTimeout(waiter.cancelAckTimeout);
      waiter.reject(new Error(interruptionMessage));
    }
    this.#waiters.clear();
    this.#worker = null;
    try {
      await previous.terminate().catch(() => {});
      if (this.#state.state !== 'closed') this.#startWorker();
    } catch (error) { this.#fail(error); }
  }

  async close() {
    if (this.#state.state === 'closed') return;
    this.#state.state = 'closed';
    for (const waiter of this.#waiters.values()) { clearTimeout(waiter.queueTimeout); clearTimeout(waiter.activeTimeout); clearTimeout(waiter.cancelAckTimeout); waiter.reject(new Error('Translator closed')); }
    this.#waiters.clear();
    const worker = this.#worker;
    this.#worker = null;
    await worker?.terminate();
  }

  #message(m) {
    if (m.type === 'status') {
      this.#state = { ...this.#state, ...m.value };
      if (this.#state.state === 'not_downloaded' && this.#downloadRequested) {
        this.#downloadRequested = false;
        void this.download();
      }
    }
    if (m.type === 'translation-progress') {
      const waiter = this.#waiters.get(m.id);
      if (waiter) {
        waiter.phase = m.value.phase;
        this.#state.translation = { requestId: waiter.requestId, ...m.value };
        if (m.value.phase !== 'queued' && !waiter.activeTimeout) {
          clearTimeout(waiter.queueTimeout);
          waiter.activeTimeout = setTimeout(() => this.#timeout(m.id, 'active'), waiter.timeoutMs);
        }
      }
    }
    if (m.type === 'translation-start') {
      const waiter = this.#waiters.get(m.id);
      if (waiter) {
        waiter.phase = 'preparing';
        this.#state.translation = { requestId: waiter.requestId, phase: 'preparing', completed: 0, total: m.total };
        clearTimeout(waiter.queueTimeout);
        if (!waiter.activeTimeout) waiter.activeTimeout = setTimeout(() => this.#timeout(m.id, 'active'), waiter.timeoutMs);
        this.#worker?.postMessage({ type: 'start-ack', id: m.id });
      }
    }
    if (m.type === 'cancel-ack') {
      const waiter = this.#waiters.get(m.id);
      if (!waiter) return;
      clearTimeout(waiter.cancelAckTimeout);
      if (m.phase === 'queued') {
        this.#waiters.delete(m.id);
        clearTimeout(waiter.queueTimeout);
        clearTimeout(waiter.activeTimeout);
        if (this.#state.translation?.requestId === waiter.requestId) this.#state.translation = null;
        waiter.reject(new Error('Local translation cancelled.'));
      } else if (m.phase === 'active') void this.#cancelActive(m.id);
    }
    if (m.type === 'result') {
      const waiter = this.#waiters.get(m.id); if (!waiter) return;
      this.#state.translation = null;
      this.#waiters.delete(m.id); clearTimeout(waiter.queueTimeout); clearTimeout(waiter.activeTimeout); clearTimeout(waiter.cancelAckTimeout); m.error ? waiter.reject(new Error(m.error)) : waiter.resolve(m.text);
    }
  }
  #fail(error) {
    if (this.#state.state === 'closed' || this.#state.state === 'error') return;
    this.#state = { ...this.#state, state: 'error', error: error?.message || 'Translation worker failed', translation: null };
    for (const waiter of this.#waiters.values()) { clearTimeout(waiter.queueTimeout); clearTimeout(waiter.activeTimeout); clearTimeout(waiter.cancelAckTimeout); waiter.reject(error); }
    this.#waiters.clear();
  }
}

export { languageCodes };
