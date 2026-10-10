import React, {useCallback, useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {ArrowDown, ArrowUp, GripVertical, Mail, RefreshCw, Trash2, X} from 'lucide-react';
import {getLanguage, locale, setLanguage, subscribeLanguage} from './locale.js';
import './AccountManager.css';

const copy = {
 zh: {title:'邮箱管理', close:'关闭', refresh:'刷新列表', empty:'还没有连接邮箱', drag:'拖动排序', up:'上移', down:'下移', remove:'删除本机连接', confirmTitle:'删除这个本机连接？', confirmText:'这会从叠信移除此邮箱连接及本机保存的邮件和草稿。邮箱服务商中的邮件不会被删除。', cancel:'取消', confirm:'确认删除', busy:'正在删除…', error:'操作未成功，请重试。', orderError:'邮箱列表已变化，已刷新列表，请重新排序。', connected:'已连接', removed:'本机连接已删除'},
 en: {title:'Manage accounts', close:'Close', refresh:'Refresh list', empty:'No email accounts connected', drag:'Drag to reorder', up:'Move up', down:'Move down', remove:'Remove local connection', confirmTitle:'Remove this local connection?', confirmText:'This removes the account connection and locally stored mail and drafts from Lettide. Messages at your email provider will remain.', cancel:'Cancel', confirm:'Remove connection', busy:'Removing…', error:'The action failed. Please try again.', orderError:'The account list changed. It has been refreshed; please reorder again.', connected:'Connected', removed:'Local connection removed'},
};
const words = () => copy[locale() === 'en' ? 'en' : 'zh'];
async function request(path, options={}) {
 const response = await fetch(`/api${path}`, {...options, headers:{'Content-Type':'application/json', ...options.headers}});
 let body=null; try { body=await response.json(); } catch {}
 if (!response.ok) { const error=new Error(body?.error||words().error); error.status=response.status; throw error; }
 return body;
}
const providerName = id => ({qq:'QQ 邮箱',godaddy:'GoDaddy',gmail:'Gmail',microsoft:'Microsoft 365'}[id]||id);

export default function AccountManager({onClose}={}) {
 const language=useSyncExternalStore(subscribeLanguage,getLanguage);
 const [accounts,setAccounts]=useState([]), [error,setError]=useState(''), [loading,setLoading]=useState(true), [pending,setPending]=useState(null), [busy,setBusy]=useState(false), [dragged,setDragged]=useState(null);
 const w=words();
 const ordering=useRef(false);
 useEffect(()=>{const mq=window.matchMedia('(prefers-color-scheme: dark)');const apply=()=>{const saved=localStorage.getItem('mail-theme')||'system';document.documentElement.dataset.theme=saved==='system'?(mq.matches?'dark':'light'):saved;};apply();mq.addEventListener('change',apply);window.addEventListener('storage',apply);return()=>{mq.removeEventListener('change',apply);window.removeEventListener('storage',apply);};},[]);
 const refresh=useCallback(async()=>{if(ordering.current)return;try{setAccounts(await request('/accounts'));setError('');}catch(e){setError(e.message||words().error);}finally{setLoading(false);}},[]);
 useEffect(()=>{refresh();const timer=setInterval(refresh,5000);const focus=()=>refresh();window.addEventListener('focus',focus);return()=>{clearInterval(timer);window.removeEventListener('focus',focus);};},[refresh]);
 useEffect(()=>{document.documentElement.lang=locale();document.title=`${words().title} · ${locale()==='en'?'Lettide':'叠信'}`;window.lettide?.setLanguage?.(locale());},[language]);
 function move(from,to){if(ordering.current||busy||to<0||to>=accounts.length)return;const next=[...accounts], [item]=next.splice(from,1);next.splice(to,0,item);setAccounts(next);persistOrder(next);}
 async function persistOrder(next){ordering.current=true;setBusy(true);try{await request('/accounts/order',{method:'PUT',body:JSON.stringify({ids:next.map(a=>a.id)})});setError('');}catch(e){ordering.current=false;await refresh();setError(e.status===409?words().orderError:(e.message||words().error));}finally{ordering.current=false;setBusy(false);}}
 async function remove(){if(!pending||busy)return;setBusy(true);setError('');try{await request(`/accounts/${encodeURIComponent(pending.id)}`,{method:'DELETE'});setAccounts(rows=>rows.filter(a=>a.id!==pending.id));setPending(null);}catch(e){setError(e.message||words().error);}finally{setBusy(false);}}
 function dragDrop(index){if(ordering.current||busy||dragged===null||dragged===index)return;const next=[...accounts], [item]=next.splice(dragged,1);next.splice(index,0,item);setAccounts(next);setDragged(null);persistOrder(next);}
 return <main className="account-manager">
  <header className="am-header"><div className="am-brand"><img src="/favicon.svg" alt=""/><div><h1>{w.title}</h1><p>{locale()==='en'?'Sort and remove accounts connected on this device.':'排序并管理这台设备上连接的邮箱。'}</p></div></div><div className="am-header-actions"><button className="am-icon" onClick={refresh} aria-label={w.refresh} title={w.refresh}><RefreshCw size={18}/></button>{onClose&&<button className="am-icon" onClick={onClose} aria-label={w.close} title={w.close}><X size={18}/></button>}</div></header>
  {error&&<div className="am-error" role="alert">{error}</div>}
  <section className="am-content" aria-label={w.title}>{loading?<p className="am-empty">{locale()==='en'?'Loading…':'正在加载…'}</p>:accounts.length===0?<p className="am-empty">{w.empty}</p>:<ol className="am-list">{accounts.map((a,index)=><li key={a.id} className={'am-row '+(dragged===index?'am-dragging':'')} draggable onDragStart={e=>{setDragged(index);e.dataTransfer.effectAllowed='move';}} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();dragDrop(index);}} onDragEnd={()=>setDragged(null)}>
   <span className="am-grip" title={w.drag} aria-label={w.drag}><GripVertical size={19}/></span><span className={'am-avatar am-'+(a.provider||'default')}>{providerName(a.provider).slice(0,1)}</span><span className="am-info"><strong>{a.name||a.email}</strong><small>{a.email} · {providerName(a.provider)}</small></span><span className="am-status"><i/> {w.connected}</span><div className="am-actions"><button className="am-icon" onClick={()=>move(index,index-1)} disabled={index===0||busy} aria-label={w.up} title={w.up}><ArrowUp size={17}/></button><button className="am-icon" onClick={()=>move(index,index+1)} disabled={index===accounts.length-1||busy} aria-label={w.down} title={w.down}><ArrowDown size={17}/></button><button className="am-icon am-delete" onClick={()=>setPending(a)} disabled={busy} aria-label={w.remove} title={w.remove}><Trash2 size={17}/></button></div>
  </li>)}</ol>}</section>
  <footer className="am-footer"><Mail size={16}/><span>{locale()==='en'?'Changes apply to this device.':'调整仅影响这台设备。'}</span><div className="am-locale"><button className={locale()==='zh-CN'?'active':''} onClick={()=>setLanguage('zh-CN')}>中文</button><button className={locale()==='en'?'active':''} onClick={()=>setLanguage('en')}>EN</button></div></footer>
  {pending&&<div className="am-shade" role="presentation"><section className="am-dialog" role="alertdialog" aria-modal="true" aria-labelledby="am-confirm-title"><h2 id="am-confirm-title">{w.confirmTitle}</h2><p><strong>{pending.email}</strong></p><p>{w.confirmText}</p><div className="am-dialog-actions"><button className="am-secondary" onClick={()=>setPending(null)} disabled={busy}>{w.cancel}</button><button className="am-danger" onClick={remove} disabled={busy}>{busy?w.busy:w.confirm}</button></div></section></div>}
 </main>;
}
