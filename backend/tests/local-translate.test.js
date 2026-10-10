import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { LocalTranslator } from '../src/local-translate.js';

class FakeWorker extends EventEmitter {
  messages = [];
  postMessage(message) { this.messages.push(message); }
  async terminate() { this.emit('exit', 0); }
}

test('local translator starts download explicitly, reports progress, and gates translation until ready', async () => {
  const worker = new FakeWorker();
  const translator = new LocalTranslator({ modelDir: 'C:/lettide-test/models', workerFactory: () => worker });
  assert.equal((await translator.status()).state, 'checking');
  worker.emit('message', { type: 'status', value: { state: 'not_downloaded' } });
  assert.equal((await translator.status()).state, 'not_downloaded');
  await assert.rejects(translator.translate('Hello', '简体中文'), /not ready/);
  const started = await translator.download();
  assert.equal(started.state, 'downloading');
  assert.equal(worker.messages[0].type, 'download');
  worker.emit('message', { type: 'status', value: { state: 'downloading', progress: 42, downloadedBytes: 100, totalBytes: 200 } });
  assert.equal((await translator.status()).progress, 42);
  worker.emit('message', { type: 'status', value: { state: 'ready', progress: 100, downloadedBytes: 200 } });
  const pending = translator.translate('Hello', '简体中文');
  assert.equal(worker.messages.at(-1).targetLanguage, '简体中文');
  worker.emit('message', { type: 'result', id: worker.messages.at(-1).id, text: '你好' });
  assert.equal(await pending, '你好');
  await translator.close();
});

test('download failures remain retryable', async () => {
  const worker = new FakeWorker();
  const translator = new LocalTranslator({ workerFactory: () => worker });
  worker.emit('message', { type: 'status', value: { state: 'not_downloaded' } });
  await translator.download();
  worker.emit('message', { type: 'status', value: { state: 'error', error: 'offline' } });
  assert.equal((await translator.status()).state, 'error');
  await translator.download();
  assert.equal(worker.messages.filter((message) => message.type === 'download').length, 2);
  await translator.close();
});
