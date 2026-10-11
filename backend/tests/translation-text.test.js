import test from 'node:test';
import assert from 'node:assert/strict';
import { assertTranslationChanged, tokenSegments } from '../src/translation-text.js';

test('long fictional text is divided under the token limit with preparation progress', async () => {
  const text = ('Fictional paragraph one. Fictional paragraph two. ').repeat(9);
  const progress = [];
  const count = async value => value.length;
  const parts = await tokenSegments(text, count, { tokenLimit: 40, onProgress: value => progress.push(value) });
  assert.ok(parts.filter(part => part.translate).length > 1);
  assert.ok(parts.every(part => part.text.length <= 40 || !part.translate));
  assert.equal(parts.map(part => part.text).join(''), text);
  assert.equal(progress[0].phase, 'preparing');
  assert.equal(progress.at(-1).completed, text.length);
  assert.equal(progress.at(-1).total, text.length);
});

test('URL and line separators remain intact while only prose is selected for translation', async () => {
  const text = 'Fictional note: https://example.invalid/a\n\nSecond line.';
  const parts = await tokenSegments(text, async value => value.length);
  assert.equal(parts.map(part => part.text).join(''), text);
  assert.equal(parts.find(part => part.text.startsWith('https://')).translate, false);
  assert.ok(parts.some(part => part.text === '\n\n' && !part.translate));
});

test('50,000 fictional characters use only bounded tokenizer inputs and safe token cuts', async () => {
  const text = 'a'.repeat(24999) + '😀' + 'b'.repeat(25000);
  let largestInput = 0;
  const count = async value => {
    largestInput = Math.max(largestInput, value.length);
    return Array.from(value).length;
  };
  const parts = await tokenSegments(text, count, { tokenLimit: 1000 });
  const translated = parts.filter(part => part.translate);
  assert.ok(largestInput <= 8000);
  assert.ok(largestInput < text.length);
  assert.ok(translated.every(part => Array.from(part.text).length <= 1000));
  assert.ok(translated.every(part => !/^[\uDC00-\uDFFF]/u.test(part.text) && !/[\uD800-\uDBFF]$/u.test(part.text)));
  assert.equal(parts.map(part => part.text).join(''), text);
});

test('identical output cannot be accepted for different source and target languages', () => {
  assert.throws(() => assertTranslationChanged('Fictional source.', 'Fictional source.', 'eng_Latn', 'zho_Hans'), /original text/i);
  assert.doesNotThrow(() => assertTranslationChanged('Names only.', 'Names only.', 'eng_Latn', 'eng_Latn'));
  assert.doesNotThrow(() => assertTranslationChanged('Fictional source.', '虚构译文。', 'eng_Latn', 'zho_Hans'));
});
