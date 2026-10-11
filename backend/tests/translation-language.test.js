import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSourceLanguage, normalizeLanguage } from '../src/translation-language.js';

test('source detection uses dominant body and script-specific evidence', () => {
  assert.equal(detectSourceLanguage('Hello, please read this email.\n谢谢。'), 'eng_Latn');
  assert.equal(detectSourceLanguage('The wordmail message is ready.'), 'eng_Latn');
  assert.equal(detectSourceLanguage('wordmail'), null);
  assert.equal(detectSourceLanguage('這是一封虛構郵件，請稍後回覆。'), 'zho_Hant');
  assert.equal(detectSourceLanguage('これは架空のメールです。'), 'jpn_Jpan');
  assert.equal(detectSourceLanguage('안녕하세요, 가상의 메일입니다.'), 'kor_Hang');
  assert.equal(detectSourceLanguage('你好'), null);
  assert.equal(detectSourceLanguage('東京大阪'), null);
});

test('source language accepts supported display names and model codes only', () => {
  assert.equal(normalizeLanguage('繁體中文'), 'zho_Hant');
  assert.equal(normalizeLanguage('zho_Hant'), 'zho_Hant');
  assert.equal(normalizeLanguage('unknown'), null);
});
