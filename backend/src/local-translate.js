import { Worker } from 'node:worker_threads';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

  constructor({ modelDir = join(homedir(), '.lettide', 'models'), workerFactory = (url, options) => new Worker(url, options), translateTimeoutMs = (length) => Math.min(20 * 60_000, 5 * 60_000 + length * 10) } = {}) {
    this.modelDir = resolve(modelDir);
    this.#workerFactory = workerFactory;
    this.#translateTimeoutMs = translateTimeoutMs;
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
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#waiters.set(id, { resolve, reject, timeout: null, timeoutMs: this.#translateTimeoutMs(text.length), requestId });
      this.#worker.postMessage({ type: 'translate', id, text, targetLanguage, sourceLanguage });
    });
  }

  async #restartWorker() {
    if (this.#state.state === 'closed') return;
    const previous = this.#worker;
    this.#state = { ...this.#state, state: 'loading', error: null, translation: null };
    for (const waiter of this.#waiters.values()) {
      clearTimeout(waiter.timeout);
      waiter.reject(new Error('Local translation was interrupted while the model restarted. Wait until it is ready, then retry.'));
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
    for (const waiter of this.#waiters.values()) { clearTimeout(waiter.timeout); waiter.reject(new Error('Translator closed')); }
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
        this.#state.translation = { requestId: waiter.requestId, ...m.value };
        if (!waiter.timeout) {
          waiter.timeout = setTimeout(() => {
            if (!this.#waiters.has(m.id)) return;
            this.#waiters.delete(m.id);
            waiter.reject(new Error('Local translation timed out. The model is restarting; wait until it is ready, then retry.'));
            void this.#restartWorker();
          }, waiter.timeoutMs);
        }
      }
    }
    if (m.type === 'result') {
      const waiter = this.#waiters.get(m.id); if (!waiter) return;
      this.#state.translation = null;
      this.#waiters.delete(m.id); clearTimeout(waiter.timeout); m.error ? waiter.reject(new Error(m.error)) : waiter.resolve(m.text);
    }
  }
  #fail(error) {
    if (this.#state.state === 'closed' || this.#state.state === 'error') return;
    this.#state = { ...this.#state, state: 'error', error: error?.message || 'Translation worker failed', translation: null };
    for (const waiter of this.#waiters.values()) { clearTimeout(waiter.timeout); waiter.reject(error); }
    this.#waiters.clear();
  }
}

export const languageCodes = Object.freeze({ '简体中文': 'zho_Hans', English: 'eng_Latn', 日本語: 'jpn_Jpan', 한국어: 'kor_Hang', '繁體中文': 'zho_Hant', Français: 'fra_Latn' });
