import {test} from 'node:test';import assert from 'node:assert/strict';
globalThis.window={lettide:{}};globalThis.localStorage={getItem:()=> 'en',setItem(){}};
const {t,setLanguage}=await import('../../web/src/locale.js');
const errors=['A sending draft cannot be deleted. Wait for the send result.','Draft is in Trash. Restore it before editing.','Draft is in Trash. Restore it before sending.','Select the drafts to clear'];
test('new draft errors remain English in an English client and translate in Chinese',()=>{setLanguage('en');assert.equal(t('删除草稿'),'Delete draft');for(const error of errors)assert.equal(t(error),error);setLanguage('zh-CN');for(const error of errors)assert.match(t(error),/[\u3400-\u9fff]/);assert.equal(t('取消'),'取消')});
