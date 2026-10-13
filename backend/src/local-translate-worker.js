import { parentPort, workerData } from 'node:worker_threads';
import { mkdir, stat, rename, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { detectSourceLanguage, normalizeLanguage } from './translation-language.js';
import { assertTranslationChanged, assertTranslationQuality, tokenSegments } from './translation-text.js';

const MODEL = 'Xenova/nllb-200-distilled-600M';
const REVISION = '261c31d1a5732c67cdd16d80e8d6088507c7ccea';
const ROOT = join(workerData.modelDir, MODEL);
const FILES = [
  ['config.json', 873], ['generation_config.json', 189], ['quantize_config.json', 3258],
  ['sentencepiece.bpe.model', 4852054], ['special_tokens_map.json', 3548], ['tokenizer.json', 17331224], ['tokenizer_config.json', 544],
  ['onnx/encoder_model_quantized.onnx', 419120483], ['onnx/decoder_model_merged_quantized.onnx', 475505771],
];
const SHA256 = {
  'sentencepiece.bpe.model': '14bb8dfb35c0ffdea7bc01e56cea38b9e3d5efcdcb9c251d6b40538e1aab555a',
  'tokenizer.json': '8ac789ad7dabea44d41537822d48c516ba358374c51813e2cba78c006e150c94',
  'onnx/encoder_model_quantized.onnx': '5cde664eacba07a62f198857ec6c06e09572b1ebb77c8137f1fa99ac604a3a28',
  'onnx/decoder_model_merged_quantized.onnx': 'dd66608c2a4194e78f95548fa0e64f24302303698c5b09fa8e1f9e16ec00676b',
};
const TOTAL = FILES.reduce((n, [, size]) => n + size, 0);
let pipe;
let busy = false;
const translationQueue = [];
let activeTranslation = null;
let activeStarted = false;
let lastProgressReport = 0;
const sendStatus = (state, extra = {}) => {
  const now = Date.now();
  if (state === 'downloading' && now - lastProgressReport < 100) return;
  lastProgressReport = now;
  parentPort.postMessage({ type: 'status', value: { state, progress: 0, downloadedBytes: 0, totalBytes: TOTAL, error: null, ...extra } });
};

async function filesPresent() {
  try { for (const [name, size] of FILES) if (!(await validFile(join(ROOT, name), name, size))) return false; return true; }
  catch { return false; }
}
async function validFile(path, name, size) {
  if ((await stat(path)).size !== size) return false;
  const expected = SHA256[name];
  if (!expected) return true;
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex') === expected;
}
async function loadModel() {
  sendStatus('loading', { progress: 100, downloadedBytes: TOTAL });
  const { env, pipeline } = await import('@huggingface/transformers');
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = workerData.modelDir + (workerData.modelDir.endsWith('/') || workerData.modelDir.endsWith('\\') ? '' : '/');
  env.cacheDir = join(workerData.modelDir, '.cache');
  env.useFSCache = true;
  pipe = await pipeline('translation', MODEL, { dtype: 'q8', device: 'cpu', local_files_only: true });
  globalThis.fetch = async () => { throw new Error('Network access is disabled after the local model is loaded'); };
  sendStatus('ready', { progress: 100, downloadedBytes: TOTAL });
}

async function doDownload() {
  if (busy) return;
  busy = true;
  try {
    await mkdir(ROOT, { recursive: true });
    let done = 0;
    for (const [name, size] of FILES) {
      const dest = join(ROOT, name);
      try { if (await validFile(dest, name, size)) { done += size; continue; } } catch {}
      await rm(dest, { force: true });
      await mkdir(dirname(dest), { recursive: true });
      const temp = `${dest}.partial`;
      const url = `https://huggingface.co/${MODEL}/resolve/${REVISION}/${name}?download=true`;
      const file = await import('node:fs');
      let received = await stat(temp).then(info => info.size).catch(() => 0);
      while (received < size) {
        let chunkComplete = false;
        let lastError;
        for (let attempt = 0; attempt < 4 && !chunkComplete; attempt++) {
          const offset = await stat(temp).then(info => info.size).catch(() => 0);
          const end = Math.min(size - 1, offset + 8 * 1024 * 1024 - 1);
          sendStatus('downloading', { progress: Math.floor((done + offset) * 100 / TOTAL), downloadedBytes: done + offset });
          try {
            const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(5 * 60 * 1000), headers: { Range: `bytes=${offset}-${end}` } });
            if (!response.ok || !response.body) throw new Error(`Model download failed (${response.status})`);
            const ranged = response.status === 206;
            if (!ranged && response.status !== 200) throw new Error('Model server returned an invalid range response');
            if (!ranged && offset > 0) await rm(temp, { force: true });
            received = ranged ? offset : 0;
            const expectedEnd = ranged ? end + 1 : size;
            const output = file.createWriteStream(temp, { flags: ranged && offset > 0 ? 'a' : 'w' });
            let streamError = null;
            output.on('error', error => { streamError = error; });
            try {
              for await (const chunk of response.body) {
                received += chunk.byteLength;
                if (received > size || (ranged && received > expectedEnd)) throw new Error('Downloaded model file size does not match pinned manifest');
                if (streamError) throw streamError;
                if (!output.write(Buffer.from(chunk))) await once(output, 'drain');
                sendStatus('downloading', { progress: Math.floor((done + received) * 100 / TOTAL), downloadedBytes: done + received });
              }
              output.end();
              await finished(output);
              if (streamError) throw streamError;
            } catch (error) { output.destroy(); throw error; }
            chunkComplete = received === expectedEnd;
            if (!chunkComplete) throw new Error('Model download ended before the requested file range was complete');
          } catch (error) {
            lastError = error;
            received = await stat(temp).then(info => info.size).catch(() => 0);
            if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
          }
        }
        if (!chunkComplete) throw lastError || new Error('Model download failed');
      }
      if (!(await validFile(temp, name, size))) { await rm(temp, { force: true }); throw new Error('Downloaded model checksum does not match the pinned manifest'); }
      await rename(temp, dest);
      done += size;
    }
    await loadModel();
  } catch (error) {
    sendStatus('error', { error: error?.message || 'Model download failed' });
  } finally { busy = false; }
}

const MAX_SOURCE_TOKENS = 800;
const MAX_OUTPUT_TOKENS = 512;
async function tokenCount(text) {
  const encoded = await pipe.tokenizer(text, { add_special_tokens: true });
  const ids = encoded.input_ids;
  return ids?.dims?.at(-1) ?? ids?.data?.length ?? ids?.length ?? 0;
}
async function translatePiece(text, source, target, depth = 0) {
  const leading = text.match(/^\s*/u)?.[0] || '';
  const trailing = text.match(/\s*$/u)?.[0] || '';
  const body = text.slice(leading.length, text.length - trailing.length);
  if (!body) return text;
  const result = await pipe(body, { src_lang: source, tgt_lang: target, max_new_tokens: MAX_OUTPUT_TOKENS });
  const translated = result?.[0]?.translation_text;
  if (typeof translated !== 'string' || !translated.trim()) throw new Error('Local model returned no translation');
  assertTranslationQuality(body, translated, target);
  if (await tokenCount(translated) < MAX_OUTPUT_TOKENS - 1) return leading + translated.trim() + trailing;
  if (depth >= 3) throw new Error('Translation output remains too long after splitting; shorten this text and retry');
  const smaller = await tokenSegments(body, tokenCount, { tokenLimit: Math.max(100, Math.floor(MAX_SOURCE_TOKENS / 2 ** (depth + 1))) });
  let output = '';
  for (const part of smaller) output += part.translate ? await translatePiece(part.text, source, target, depth + 1) : part.text;
  return leading + output + trailing;
}
async function translatePreservingStructure(text, source, target, onProgress) {
  const parts = await tokenSegments(text, tokenCount, { tokenLimit: MAX_SOURCE_TOKENS, onProgress });
  const total = parts.filter(part => part.translate && part.text.trim()).length;
  let completed = 0;
  const output = [];
  onProgress({ phase: 'running', completed, total });
  let preserveSignatureName = false;
  for (const part of parts) {
    if (!part.translate || !part.text.trim()) { output.push(part.text); continue; }
    // Transformers.js 3.8.1 continues generating an already-ended short row
    // until the whole batch ends. Never batch mixed-length translation rows.
    const closing = source === 'eng_Latn' && ['zho_Hans', 'zho_Hant'].includes(target)
      && /^(?:Best,|Best regards,?|Kind regards,?|Regards,|Sincerely,|Yours sincerely,?)$/iu.test(part.text.trim());
    if (closing) {
      output.push(part.text.replace(part.text.trim(), '祝好，'));
      preserveSignatureName = true;
    } else if (preserveSignatureName && /^[\p{L} .'-]{1,60}$/u.test(part.text.trim())) {
      output.push(part.text);
      preserveSignatureName = false;
    } else {
      preserveSignatureName = false;
      output.push(await translatePiece(part.text, source, target));
    }
    completed++;
    onProgress({ phase: 'running', completed, total, partialText: output.join('') });
  }
  return output.join('');
}
async function translate(text, targetLanguage, sourceLanguage, onProgress = () => {}) {
  if (!pipe) throw new Error('Offline translation model is not ready');
  const target = normalizeLanguage(targetLanguage);
  if (!target) throw new Error('Unsupported target language');
  const source = sourceLanguage ? normalizeLanguage(sourceLanguage) : detectSourceLanguage(text);
  if (sourceLanguage && !source) throw new Error('Unsupported source language');
  if (!source) throw new Error('Source language is ambiguous. Choose the source language and retry.');
  if (source === target) return text;
  onProgress({ phase: 'preparing', completed: 0, total: text.length });
  const result = await translatePreservingStructure(text, source, target, onProgress);
  assertTranslationChanged(text, result, source, target);
  assertTranslationQuality(text, result, target);
  return result;
}

function reportQueue() {
  let position = activeTranslation ? 1 : 0;
  for (const item of translationQueue) {
    parentPort.postMessage({ type: 'translation-progress', id: item.id, value: { phase: 'queued', position, completed: 0, total: position } });
    position++;
  }
}

function scheduleNextTranslation() {
  if (activeTranslation || !translationQueue.length) return;
  activeTranslation = translationQueue.shift();
  activeStarted = false;
  reportQueue();
  parentPort.postMessage({ type: 'translation-start', id: activeTranslation.id, total: activeTranslation.text.length });
}

async function runActiveTranslation() {
  if (!activeTranslation || activeStarted) return;
  activeStarted = true;
  const item = activeTranslation;
  try {
    const text = await translate(item.text, item.targetLanguage, item.sourceLanguage, value => parentPort.postMessage({ type: 'translation-progress', id: item.id, value }));
    parentPort.postMessage({ type: 'result', id: item.id, text });
  } catch (error) {
    parentPort.postMessage({ type: 'result', id: item.id, error: error?.message || 'Local translation failed' });
  } finally {
    activeTranslation = null;
    activeStarted = false;
    reportQueue();
    setImmediate(scheduleNextTranslation);
  }
}

parentPort.on('message', async (m) => {
  if (m.type === 'download') { void doDownload(); return; }
  if (m.type === 'translate') {
    translationQueue.push(m);
    reportQueue();
    scheduleNextTranslation();
    return;
  }
  if (m.type === 'start-ack') {
    if (activeTranslation?.id === m.id) void runActiveTranslation();
    return;
  }
  if (m.type === 'cancel') {
    const index = translationQueue.findIndex(item => item.id === m.id);
    if (index >= 0) {
      translationQueue.splice(index, 1);
      parentPort.postMessage({ type: 'cancel-ack', id: m.id, phase: 'queued' });
      reportQueue();
    } else if (activeTranslation?.id === m.id) {
      parentPort.postMessage({ type: 'cancel-ack', id: m.id, phase: 'active' });
    } else parentPort.postMessage({ type: 'cancel-ack', id: m.id, phase: 'done' });
  }
});

if (await filesPresent()) {
  try { await loadModel(); } catch (error) { sendStatus('error', { error: error?.message || 'Model load failed' }); }
} else sendStatus('not_downloaded');
