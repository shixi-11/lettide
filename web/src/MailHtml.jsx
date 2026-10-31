import React, {useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {ImageOff} from 'lucide-react';
import {t} from './locale.js';

// Remote pictures stay off until the reader allows them for that one message (senders use them to see who opened).
const allowedImages=new Set();
const themeOf=()=>document.documentElement.dataset.theme==='dark'?'dark':'light';
const subscribeTheme=fn=>{const o=new MutationObserver(fn);o.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});return()=>o.disconnect();};
const remote=/^\s*(?:https?:)?\/\//i,secure=value=>value.trim().replace(/^(?:http:)?\/\//i,'https://'),remoteCss=/url\(\s*['"]?\s*(?:https?:)?\/\//i;

// The sender's page is parsed, never run: scripts, frames, plugins, meta refresh and remote styles are dropped,
// links open outside the app, and a CSP inside the page blocks anything that slips through.
export function preparePage(html,{allowImages,dark}){
 const doc=new DOMParser().parseFromString(html,'text/html');let blocked=0;
 doc.querySelectorAll('script,noscript,iframe,frame,frameset,object,embed,applet,portal,base,meta,link,template').forEach(n=>n.remove());
 const image=(el,attr)=>{const value=el.getAttribute(attr);if(value==null)return;if(/^\s*data:image\//i.test(value))return;if(remote.test(value)&&allowImages)el.setAttribute(attr,secure(value));else{if(remote.test(value))blocked++;el.removeAttribute(attr);}};
 for(const el of doc.querySelectorAll('*')){
  for(const {name} of [...el.attributes])if(/^on/i.test(name)||name==='formaction'||name==='action'||name==='ping')el.removeAttribute(name);
  const tag=el.localName;
  if(tag==='a'||tag==='area'){const href=(el.getAttribute('href')||'').trim();if(/^(?:https?:|mailto:)/i.test(href)){el.setAttribute('target','_blank');el.setAttribute('rel','noopener noreferrer');}else if(!href.startsWith('#'))el.removeAttribute('href');}
  if(tag==='img'||tag==='input'||tag==='source'){image(el,'src');el.removeAttribute('loading');}
  if(el.hasAttribute('srcset')){const value=el.getAttribute('srcset');if(allowImages&&!/(^|,)\s*(?!https?:|\/\/)[a-z][a-z0-9+.-]*:/i.test(value))el.setAttribute('srcset',value.split(',').map(secure).join(', '));else{if(remote.test(value))blocked++;el.removeAttribute('srcset');}}
  if(tag==='image'||tag==='use'||tag==='feimage'){image(el,'href');image(el,'xlink:href');}
  for(const attr of ['background','poster'])image(el,attr);
  if(!allowImages&&remoteCss.test(el.getAttribute('style')||''))blocked++;
 }
 if(!allowImages)for(const style of doc.querySelectorAll('style'))if(remoteCss.test(style.textContent||''))blocked++;
 // Mail that paints its own backgrounds is a designed page and keeps its colors; everything else reads in Lettide's own theme.
 const painted=/(?:^|;)\s*background(?:-color)?\s*:\s*(?!\s*(?:transparent|none|inherit|initial|#fff(?:fff)?\b|white\b|rgba?\(\s*255\s*,\s*255\s*,\s*255))/i;
 const designed=[...doc.querySelectorAll('[bgcolor],[background],[style]')].some(el=>{const bg=(el.getAttribute('bgcolor')||'').trim();return el.hasAttribute('background')||bg&&!/^(?:#fff(?:fff)?|white|transparent)$/i.test(bg)||painted.test(el.getAttribute('style')||'');})||[...doc.querySelectorAll('style')].some(s=>/background(?:-color)?\s*:\s*(?!\s*(?:transparent|none|#fff(?:fff)?\b|white\b))/i.test(s.textContent||''));
 const head=doc.head,base=doc.createElement('style'),csp=doc.createElement('meta'),referrer=doc.createElement('meta');
 csp.setAttribute('http-equiv','Content-Security-Policy');
 csp.setAttribute('content',`default-src 'none'; script-src 'none'; img-src data:${allowImages?' https:':''}; style-src 'unsafe-inline'; font-src data:; media-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'`);
 referrer.setAttribute('name','referrer');referrer.setAttribute('content','no-referrer');
 const app=getComputedStyle(document.documentElement),token=(name,fallback)=>app.getPropertyValue(name).trim()||fallback;
 const text=token('--text',dark?'#e4eaf7':'#1f2329'),muted=token('--muted','#8f9ab1'),accent=token('--accent','#377ffa'),line=token('--line','#d5dce6'),font=app.fontFamily||'"Segoe UI","Microsoft YaHei UI",sans-serif';
 base.textContent=designed
  ?`:root{color-scheme:light}html{background:#ffffff;overflow-x:auto;overflow-y:auto}body{margin:0;padding:18px 20px;color:#1f2329;font:14px/1.6 "Segoe UI","Microsoft YaHei UI","PingFang SC",Arial,sans-serif;overflow-wrap:break-word}img{max-width:100%;height:auto}pre{white-space:pre-wrap}a{color:#1a5fd0}blockquote{margin:0 0 0 .8ex;padding-left:1ex;border-left:1px solid #ccc}::-webkit-scrollbar{width:8px;height:8px}::-webkit-scrollbar-thumb{background:#c5cad2;border-radius:8px}`
  // Same type, color and rhythm as the plain-text reader (.mail-text); sender font colors give way to the theme.
  :`:root{color-scheme:${dark?'dark':'light'}}html{background:transparent;overflow-x:auto;overflow-y:hidden}body{margin:0;padding:0;color:${text};font:400 14px/1.85 ${font};overflow-wrap:anywhere}body *{font-family:inherit!important}body *:not(a){color:inherit!important;background-color:transparent!important;border-color:${line}!important}a,a *{color:${accent}!important}img{max-width:100%;height:auto}pre{white-space:pre-wrap;font:inherit}hr{border:0;border-top:1px solid ${line}}blockquote{margin:0 0 0 .8ex;padding-left:1ex;border-left:2px solid ${line}!important;color:${muted}!important}td,th{font:inherit}::-webkit-scrollbar{width:8px;height:8px}::-webkit-scrollbar-thumb{background:${line};border-radius:8px}`;
 head.prepend(csp,referrer,base);
 return {doc:'<!doctype html>'+doc.documentElement.outerHTML,blocked,themed:!designed};
}

// A sandbox without allow-same-origin cannot be measured from outside, so an invisible twin with the same page
// (no scripts, no clicks) reports the height; the reader only ever touches the fully isolated frame.
function PageFrame({doc,title,themed}){
 const box=useRef(null),probe=useRef(null),[height,setHeight]=useState(360);
 useEffect(()=>{const frame=probe.current;if(!frame)return;let raf=0;const timers=[];
  const measure=()=>{cancelAnimationFrame(raf);raf=requestAnimationFrame(()=>{try{const d=frame.contentDocument,root=d?.documentElement;if(!root||!d.body)return;const wide=root.scrollWidth>root.clientWidth+1;setHeight(Math.ceil(Math.max(root.scrollHeight,d.body.scrollHeight))+(wide?10:0)+2);}catch{}});};
  const loaded=()=>{measure();try{frame.contentDocument.addEventListener('load',measure,true);frame.contentDocument.addEventListener('error',measure,true);}catch{}timers.push(setTimeout(measure,300),setTimeout(measure,1500));};
  frame.addEventListener('load',loaded);const ro=new ResizeObserver(measure);if(box.current)ro.observe(box.current);
  return()=>{frame.removeEventListener('load',loaded);ro.disconnect();cancelAnimationFrame(raf);timers.forEach(clearTimeout);};
 },[doc]);
 return <div className={themed?"mail-page-card themed":"mail-page-card"} ref={box}><iframe className="mail-page-frame" title={title||t('邮件正文')} sandbox="allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" srcDoc={doc} style={{height}}/><iframe ref={probe} className="mail-page-probe" aria-hidden="true" tabIndex={-1} scrolling="no" sandbox="allow-same-origin" srcDoc={doc}/></div>;
}

export default function MailHtml({message,fallback}){
 const id=message.id,[state,setState]=useState({id:null,status:'loading'}),[allow,setAllow]=useState(()=>allowedImages.has(id)),[showPage,setShowPage]=useState(false);
 const dark=useSyncExternalStore(subscribeTheme,themeOf)==='dark';
 useEffect(()=>{let live=true;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000);setAllow(allowedImages.has(id));setShowPage(false);setState({id,status:'loading'});
  fetch('/api/messages/'+encodeURIComponent(id)+'/html',{signal:controller.signal}).then(r=>r.ok?r.json():null).then(body=>{if(live)setState({id,status:body?.html?'ready':'none',html:body?.html||'',shell:!!body?.shell});}).catch(()=>{if(live)setState({id,status:'none'});}).finally(()=>clearTimeout(timer));
  return()=>{live=false;clearTimeout(timer);controller.abort();};
 },[id]);
 const page=useMemo(()=>state.status==='ready'?preparePage(state.html,{allowImages:allow,dark}):null,[state,allow,dark]);
 if(!page||state.id!==id)return fallback;
 if(state.shell&&!showPage)return <>{fallback}<div className="mail-page-note"><button className="text-button" onClick={()=>setShowPage(true)}>{t('查看网页版式')}</button></div></>;
 return <div className="mail-page">{(page.blocked>0&&!allow||state.shell)&&<div className="mail-page-bar">{page.blocked>0&&!allow&&<><ImageOff size={15}/><span>{t('已暂停加载远程图片，保护你的阅读隐私。')}</span><button className="text-button" onClick={()=>{allowedImages.add(id);setAllow(true);}}>{t('显示图片')}</button></>}{state.shell&&<button className="text-button" onClick={()=>setShowPage(false)}>{t('改看纯文字')}</button>}</div>}<PageFrame doc={page.doc} title={message.subject} themed={page.themed}/></div>;
}
