import React,{useEffect,useRef,useState} from 'react';
import {t} from './locale.js';
export default function MailContextMenu({menu,folders,onAction,onClose}){
 const box=useRef(),[move,setMove]=useState(false);
 useEffect(()=>{const close=e=>{if(!box.current?.contains(e.target))onClose()};const key=e=>{if(e.key==='Escape')onClose();if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();const buttons=[...box.current.querySelectorAll('button:not(:disabled)')];const i=buttons.indexOf(document.activeElement);buttons[(i+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus()}};document.addEventListener('pointerdown',close);document.addEventListener('keydown',key);window.addEventListener('resize',onClose);box.current.querySelector('button')?.focus();return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',key);window.removeEventListener('resize',onClose)}},[]);
 const action=(patch)=>{onClose();onAction(menu.message,patch)};
 return <div ref={box} className="mail-context-menu" role="menu" aria-label={t('邮件操作')} style={{left:Math.min(menu.x,window.innerWidth-246),top:Math.min(menu.y,window.innerHeight-330)}}>
  <button role="menuitem" onClick={()=>action({unread:!menu.message.unread})}>{t(menu.message.unread?'标为已读':'标为未读')}</button>
  <button role="menuitem" onClick={()=>action({starred:!menu.message.starred})}>{t(menu.message.starred?'取消星标':'添加星标')}</button>
  <button role="menuitem" onClick={()=>action({folder:'archive'})}>{t('归档')}</button>
  <button role="menuitem" aria-haspopup="menu" aria-expanded={move} onClick={()=>setMove(!move)}>{t('移动到…')} ›</button>
  {move&&<div className="context-folders" role="group" aria-label={t('移动到文件夹')}>{[['inbox',t('收件箱')],['junk',t('垃圾邮件')],['trash',t('已删除')],...folders.filter(f=>f.accountId===menu.message.accountId&&f.role==='custom').map(f=>[f.id,f.name])].map(([id,name])=><button role="menuitem" title={name} key={id} onClick={()=>action({folder:id})}>{name}</button>)}</div>}
  <button role="menuitem" className="danger" onClick={()=>action({folder:'trash'})}>{t('删除邮件')}</button>
 </div>
}
