import { Worker } from 'node:worker_threads';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKER = fileURLToPath(new URL('./local-translate-worker.js', import.meta.url));

/** Local, offline NLLB translation. The worker owns all model and network activity. */
export class LocalTranslator {
  #worker;
  #state = { state: 'checking', progress: 0, downloadedBytes: 0, totalBytes: 0, error: null };
  #waiters = new Map();
  #nextId = 1;
  #downloadRequested = false;

  constructor({ modelDir = join(homedir(), '.lettide', 'models'), workerFactory = (url, options) => new Worker(url, options) } = {}) {
    this.modelDir = resolve(modelDir);
    this.#worker = workerFactory(WORKER, { workerData: { modelDir: this.modelDir } });
    this.#worker.on('message', (message) => this.#message(message));
    this.#worker.on('error', (error) => this.#fail(error));
    this.#worker.on('exit', (code) => { if (code && this.#state.state !== 'closed') this.#fail(new Error(`Translation worker exited (${code})`)); });
    this.#worker.unref?.();
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

  async translate(text, targetLanguage, { sourceLanguage } = {}) {
    if (this.#state.state !== 'ready') throw new Error('Offline translation model is not ready');
    if (typeof text !== 'string' || !text.trim() || text.length > 100000) throw new Error('Invalid translation text');
    if (!languageCodes[targetLanguage]) throw new Error('Unsupported target language');
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#waiters.set(id, { resolve, reject });
      this.#worker.postMessage({ type: 'translate', id, text, targetLanguage, sourceLanguage });
    });
  }

  async close() {
    if (this.#state.state === 'closed') return;
    this.#state.state = 'closed';
    for (const waiter of this.#waiters.values()) waiter.reject(new Error('Translator closed'));
    this.#waiters.clear();
    await this.#worker.terminate();
  }

  #message(m) {
    if (m.type === 'status') {
      this.#state = { ...this.#state, ...m.value };
      if (this.#state.state === 'not_downloaded' && this.#downloadRequested) {
        this.#downloadRequested = false;
        void this.download();
      }
    }
    if (m.type === 'result') {
      const waiter = this.#waiters.get(m.id); if (!waiter) return;
      this.#waiters.delete(m.id); m.error ? waiter.reject(new Error(m.error)) : waiter.resolve(m.text);
    }
  }
  #fail(error) {
    this.#state = { ...this.#state, state: 'error', error: error?.message || 'Translation worker failed' };
    for (const waiter of this.#waiters.values()) waiter.reject(error);
    this.#waiters.clear();
  }
}

export const languageCodes = Object.freeze({ '简体中文': 'zho_Hans', English: 'eng_Latn', 日本語: 'jpn_Jpan', 한국어: 'kor_Hang', '繁體中文': 'zho_Hant', Français: 'fra_Latn' });

