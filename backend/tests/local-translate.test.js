import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { LocalTranslator } from '../src/local-translate.js';

class FakeWorker extends EventEmitter {
  messages = [];
  terminateCode = 0;
  postMessage(message) { this.messages.push(message); }
  async terminate() { this.emit('exit', this.terminateCode); }
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
  const pending = translator.translate('Hello', '简体中文', { requestId: 'fictional-request' });
  assert.equal(worker.messages.at(-1).targetLanguage, '简体中文');
  worker.emit('message', { type: 'translation-progress', id: worker.messages.at(-1).id, value: { phase: 'running', completed: 1, total: 3 } });
  assert.deepEqual((await translator.status()).translation, { requestId: 'fictional-request', phase: 'running', completed: 1, total: 3 });
  worker.emit('message', { type: 'result', id: worker.messages.at(-1).id, text: '你好' });
  assert.equal(await pending, '你好');
  assert.equal((await translator.status()).translation, null);
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

test('a stalled translation times out, replaces the worker, and can be retried', async () => {
  const workers = [];
  const translator = new LocalTranslator({
    workerFactory: () => { const worker = new FakeWorker(); workers.push(worker); return worker; },
    translateTimeoutMs: () => 10,
  });
  workers[0].terminateCode = 1;
  workers[0].emit('message', { type: 'status', value: { state: 'ready' } });
  const stalled = translator.translate('Fictional email text.', '简体中文');
  const activeId = workers[0].messages.at(-1).id;
  const queued = translator.translate('Another fictional paragraph.', '简体中文');
  workers[0].emit('message', { type: 'translation-progress', id: activeId, value: { phase: 'preparing', completed: 0, total: 0 } });
  await assert.rejects(stalled, /timed out.*restarting/i);
  await assert.rejects(queued, /interrupted.*restarted/i);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(workers.length, 2);
  assert.equal((await translator.status()).state, 'loading');
  workers[1].emit('message', { type: 'status', value: { state: 'ready' } });
  const retry = translator.translate('Fictional email text.', '简体中文');
  workers[1].emit('message', { type: 'translation-progress', id: workers[1].messages.at(-1).id, value: { phase: 'running', completed: 0, total: 1 } });
  workers[1].emit('message', { type: 'result', id: workers[1].messages.at(-1).id, text: '虚构邮件文本。' });
  assert.equal(await retry, '虚构邮件文本。');
  workers[0].emit('exit', 1);
  assert.equal((await translator.status()).state, 'ready');
  await translator.close();
});
