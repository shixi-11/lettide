import { parentPort, workerData } from 'node:worker_threads';
import { mkdir, stat, rename, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';

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
let translationQueue = Promise.resolve();
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

function guessSource(text) {
  if (/[\u3040-\u30ff]/u.test(text)) return 'jpn_Jpan';
  if (/[\uac00-\ud7af]/u.test(text)) return 'kor_Hang';
  if (/[\u3400-\u9fff]/u.test(text)) return /[體國學說愛門風]/u.test(text) ? 'zho_Hant' : 'zho_Hans';
  if (/[àâçéèêëîïôûùüÿœæ]/iu.test(text) || /\b(le|la|les|des|une|est|bonjour|merci|vous|pour)\b/iu.test(text)) return 'fra_Latn';
  return 'eng_Latn';
}
const codes = { '简体中文': 'zho_Hans', English: 'eng_Latn', 日本語: 'jpn_Jpan', 한국어: 'kor_Hang', '繁體中文': 'zho_Hant', Français: 'fra_Latn' };
const URL_RE = /((?:https?:\/\/|www\.)[^\s<>()]+)/giu;
const MAX_SOURCE_TOKENS = 800;
const MAX_OUTPUT_TOKENS = 512;
const TRANSLATION_BATCH_SIZE = 4;
async function tokenCount(text) {
  const encoded = await pipe.tokenizer(text, { add_special_tokens: true });
  const ids = encoded.input_ids;
  return ids?.dims?.at(-1) ?? ids?.data?.length ?? ids?.length ?? 0;
}
async function tokenSegments(text, tokenLimit = MAX_SOURCE_TOKENS) {
  const out = [];
  for (const paragraph of text.split(/(\r?\n+)/u)) {
    if (!paragraph.trim() || paragraph.includes('\n')) { out.push({ text: paragraph, translate: false }); continue; }
    for (const [i, piece] of paragraph.split(URL_RE).entries()) {
      if (!piece) continue;
      if (i % 2) { out.push({ text: piece, translate: false }); continue; }
      let rest = piece;
      while (rest) {
        if (await tokenCount(rest) <= tokenLimit) { out.push({ text: rest, translate: true }); break; }
        let low = 1; let high = rest.length; let best = 0;
        while (low <= high) {
          const mid = Math.floor((low + high) / 2);
          if (await tokenCount(rest.slice(0, mid)) <= tokenLimit) { best = mid; low = mid + 1; }
          else high = mid - 1;
        }
        if (!best) throw new Error('Could not split text within the model token limit');
        let cut = best;
        const boundary = Math.max(rest.lastIndexOf(' ', best), rest.lastIndexOf('\t', best), rest.lastIndexOf('.', best), rest.lastIndexOf('。', best), rest.lastIndexOf('!', best), rest.lastIndexOf('?', best));
        if (boundary >= best * 0.65) cut = boundary + 1;
        out.push({ text: rest.slice(0, cut), translate: true }); rest = rest.slice(cut);
      }
    }
  }
  return out;
}
async function translatePiece(text, source, target, depth = 0) {
  const leading = text.match(/^\s*/u)?.[0] || '';
  const trailing = text.match(/\s*$/u)?.[0] || '';
  const body = text.slice(leading.length, text.length - trailing.length);
  if (!body) return text;
  const result = await pipe(body, { src_lang: source, tgt_lang: target, max_new_tokens: MAX_OUTPUT_TOKENS });
  const translated = result?.[0]?.translation_text;
  if (typeof translated !== 'string' || !translated.trim()) throw new Error('Local model returned no translation');
  if (await tokenCount(translated) < MAX_OUTPUT_TOKENS - 1) return leading + translated.trim() + trailing;
  if (depth >= 3) throw new Error('Translation output remains too long after splitting; shorten this text and retry');
  const smaller = await tokenSegments(body, Math.max(100, Math.floor(MAX_SOURCE_TOKENS / 2 ** (depth + 1))));
  let output = '';
  for (const part of smaller) output += part.translate ? await translatePiece(part.text, source, target, depth + 1) : part.text;
  return leading + output + trailing;
}
async function translatePieces(texts, source, target) {
  if (texts.length === 1) return [await translatePiece(texts[0], source, target)];
  const bounds = texts.map(text => ({ leading: text.match(/^\s*/u)?.[0] || '', trailing: text.match(/\s*$/u)?.[0] || '' }));
  const bodies = texts.map((text, i) => text.slice(bounds[i].leading.length, text.length - bounds[i].trailing.length));
  const results = await pipe(bodies, { src_lang: source, tgt_lang: target, max_new_tokens: MAX_OUTPUT_TOKENS });
  if (!Array.isArray(results) || results.length !== texts.length) throw new Error('Local model returned an incomplete translation batch');
  const output = [];
  for (let i = 0; i < results.length; i++) {
    const translated = results[i]?.translation_text;
    if (typeof translated !== 'string' || !translated.trim() || await tokenCount(translated) >= MAX_OUTPUT_TOKENS - 1) {
      output.push(await translatePiece(texts[i], source, target));
    } else {
      output.push(bounds[i].leading + translated.trim() + bounds[i].trailing);
    }
  }
  return output;
}
async function translatePreservingStructure(text, source, target, onProgress) {
  const parts = await tokenSegments(text);
  const total = parts.filter(part => part.translate && part.text.trim()).length;
  let completed = 0;
  onProgress({ phase: 'running', completed, total });
  const output = [];
  for (let i = 0; i < parts.length;) {
    if (!parts[i].translate || !parts[i].text.trim()) { output.push(parts[i++].text); continue; }
    const batch = [parts[i++].text];
    const separators = [];
    while (batch.length < TRANSLATION_BATCH_SIZE) {
      let j = i;
      let separator = '';
      while (j < parts.length && !parts[j].translate && /^\s*$/u.test(parts[j].text)) separator += parts[j++].text;
      if (!separator || j >= parts.length || !parts[j].translate) break;
      separators.push(separator);
      batch.push(parts[j].text);
      i = j + 1;
    }
    const translated = await translatePieces(batch, source, target);
    completed += batch.length;
    onProgress({ phase: 'running', completed, total });
    for (let j = 0; j < translated.length; j++) {
      output.push(translated[j]);
      if (j < separators.length) output.push(separators[j]);
    }
  }
  return output.join('');
}
async function translate(text, targetLanguage, sourceLanguage, onProgress = () => {}) {
  if (!pipe) throw new Error('Offline translation model is not ready');
  const target = codes[targetLanguage];
  if (!target) throw new Error('Unsupported target language');
  const source = codes[sourceLanguage] || guessSource(text);
  if (source === target) return text;
  onProgress({ phase: 'preparing', completed: 0, total: 0 });
  return translatePreservingStructure(text, source, target, onProgress);
}

parentPort.on('message', async (m) => {
  if (m.type === 'download') { void doDownload(); return; }
  if (m.type === 'translate') {
    translationQueue = translationQueue.then(async () => {
      try { parentPort.postMessage({ type: 'result', id: m.id, text: await translate(m.text, m.targetLanguage, m.sourceLanguage, value => parentPort.postMessage({ type: 'translation-progress', id: m.id, value })) }); }
      catch (error) { parentPort.postMessage({ type: 'result', id: m.id, error: error?.message || 'Local translation failed' }); }
    });
  }
});

if (await filesPresent()) {
  try { await loadModel(); } catch (error) { sendStatus('error', { error: error?.message || 'Model load failed' }); }
} else sendStatus('not_downloaded');
