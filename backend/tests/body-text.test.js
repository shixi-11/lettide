import test from 'node:test';
import assert from 'node:assert/strict';
import {htmlBodyToText} from '../src/mail.js';

test('HTML bodies read like the rendered email: blocks, table rows and link text, without hidden parts',()=>{
  assert.equal(htmlBodyToText('Hello thereNext lineRequest your place [https://x.test/t]','<p>Hello there</p><p>Next line</p><p><a href="https://x.test/t">Request your place</a></p>'),'Hello there\n\nNext line\n\nRequest your place');
  assert.equal(htmlBodyToText('','<table><tr><td>Dear reader</td></tr><tr><td>Row one</td></tr></table>'),'Dear reader\nRow one');
  assert.equal(htmlBodyToText('','<div style="DISPLAY: none">Preheader</div><h2>Mixed Case</h2><img src="p.gif" alt="pixel">'),'Mixed Case');
  assert.equal(htmlBodyToText('','<div style=DISPLAY:none>Leak</div><span style="mso-hide:all">Outlook</span><p>Body</p>'),'Body');
  assert.equal(htmlBodyToText('','<div style="display:none;display:block">Shown</div>'),'Shown');
});

test('Visible text is never rewritten and shell HTML falls back to the plain alternative',()=>{
  assert.equal(htmlBodyToText('','<p>Use style="White Space" here.</p>'),'Use style="White Space" here.');
  assert.equal(htmlBodyToText('',`<p title=" style='X">Hello Big World</p><p>It's Visible</p>`),"Hello Big World\n\nIt's Visible");
  assert.equal(htmlBodyToText('Your code is 482913. It expires in 10 minutes.','<p><a href="https://x.test/v">View email</a></p>'),'Your code is 482913. It expires in 10 minutes.');
  assert.equal(htmlBodyToText('Plain only',''),'Plain only');
});
