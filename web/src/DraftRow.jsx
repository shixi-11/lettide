import React from 'react';import {FileText,Trash2,RotateCcw,Loader2} from 'lucide-react';import {t} from './locale.js';
export default function DraftRow({draft,onOpen,onDelete,onRestore,onMenu,busy,dateLabel}){
 const sending=draft.status==='sending';
 const discard=()=>{if(!busy&&!sending)onDelete(draft)};
 return <div className="draft-row" role="group" aria-label={draft.subject||t('无主题')} onContextMenu={e=>onMenu(e,draft)}>
  <button className="message-row" onClick={()=>onOpen(draft)} onKeyDown={e=>{if(!draft.deletedAt&&(e.key==='Delete'||e.key==='Backspace'&&(e.metaKey||e.ctrlKey))){e.preventDefault();discard()}}}>
   <span className="sender-avatar violet"><FileText size={19}/></span><span className="row-content"><span className="row-top"><strong>{draft.to||t('未填写收件人')}</strong><time>{dateLabel(draft.deletedAt||draft.updatedAt)}</time></span><span className="row-subject">{draft.subject||t('无主题')}</span><span className="row-excerpt">{sending?t('正在发送…'):draft.status==='outcome_unknown'?t('发送结果待确认'):draft.text||t('继续编辑这封邮件')}</span></span>
  </button>
  <button className="draft-row-action icon-button" aria-label={t(draft.deletedAt?'恢复草稿':'删除草稿')} title={t(sending?'正在发送的草稿暂时不能删除':draft.deletedAt?'恢复草稿':'删除草稿')} disabled={busy||sending} onClick={()=>draft.deletedAt?onRestore(draft):discard()}>{busy?<Loader2 size={16}/>:draft.deletedAt?<RotateCcw size={16}/>:<Trash2 size={16}/>}</button>
 </div>
}
