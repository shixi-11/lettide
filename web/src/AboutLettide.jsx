import React, {useState} from 'react';
import {Heart, ExternalLink, Mail, Copy} from 'lucide-react';
import {locale} from './locale.js';

const repository='https://github.com/shixi-11/lettide';
const contact='info@elevencapital.ltd';
export default function AboutLettide({version,onOpen}) {
 const en=locale()==='en',brand=en?'Lettide':'叠信';
 const [feedback,setFeedback]=useState('');
 async function open(url){setFeedback('');try{await onOpen(url)}catch{setFeedback('open-error')}}
 async function copy(){setFeedback('');try{if(window.lettide?.copyContactEmail){const result=await window.lettide.copyContactEmail();if(result?.ok!==true)throw new Error('Copy failed')}else await navigator.clipboard.writeText(contact);setFeedback('copied')}catch{setFeedback('copy-error')}}
 return <section className="settings-section about-lettide" aria-label={en?'About Lettide':'关于叠信'}>
  <div><div className="about-title"><h3>{brand}</h3><span>v{version}</span></div><p className="hint">© 2026 {en?'Shixi Lin':'光之十一'}</p></div>
  <p>{en?'Free for personal and business use.':'个人和企业均可免费使用。'}</p>
  <div className="about-actions"><button type="button" className="secondary" onClick={()=>open('https://shixilin.com/'+(en?'en':'zh')+'/support')}><Heart size={16}/>{en?'Support Lettide':'支持叠信'}<ExternalLink size={13}/></button><button type="button" className="secondary" onClick={()=>open(repository+'/tree/v'+encodeURIComponent(version))}><ExternalLink size={16}/>{en?'Source code':'查看源码'}</button></div>
  <p className="hint">{en?'Contributions are voluntary and help support ongoing maintenance. All features are available without donating.':'打赏完全自愿，用于支持后续维护，不影响任何功能的使用。'}</p>
  <div className="about-contact"><p>{en?'Collaborations':'合作联系'}</p><button type="button" className="text-button" aria-label={en?'Copy collaboration email':'复制合作邮箱'} title={en?'Copy email address':'复制邮箱地址'} onClick={copy}><Mail size={16}/><span>{contact}</span><Copy size={14}/></button></div>
  <div className="about-legal"><button type="button" className="text-button" onClick={()=>open(repository+'/blob/v'+encodeURIComponent(version)+'/LICENSE')}>GNU AGPLv3 · AGPL-3.0-only <ExternalLink size={12}/></button><p>{en?'Provided without warranty. You may modify and redistribute this software under the AGPLv3 terms. Third-party components retain their own licenses.':'本软件不提供担保，可按 AGPLv3 条款修改和再分发。第三方组件保留各自许可。'}</p></div>
  <p className="about-feedback" role={feedback.endsWith('error')?'alert':'status'}>{feedback==='copied'?(en?'Email address copied.':'邮箱地址已复制。'):feedback==='copy-error'?(en?'Could not copy. Select and copy the address above.':'复制失败，请选中上方地址手动复制。'):feedback==='open-error'?(en?'Could not open the link. Please try again.':'暂时无法打开链接，请重试。'):''}</p>
 </section>;
}
