// BODYSTRUCTURE lets a reader fetch text without downloading every attachment.
export function describeParts(structure,messageId){
 const text=[],attachments=[];
 const walk=node=>{if(!node)return;const type=String(node.type||'').toLowerCase(),filename=node.dispositionParameters?.filename||node.parameters?.name;
  if(node.disposition==='attachment'||filename||node.id&&!type.startsWith('text/')||!node.childNodes?.length&&type&&!type.startsWith('text/')&&!type.startsWith('multipart/')){attachments.push({id:messageId+':part:'+node.part,filename:filename||'attachment',size:node.size||0,remotePart:node.part});return;}
  if(node.childNodes?.length){node.childNodes.forEach(walk);return;}
  if(type==='text/plain'||type==='text/html')text.push({...node,part:node.part||'1',type});
 };
 walk(structure);return {text,attachments};
}
export async function readDownload(download,maxBytes){
 if(!download?.content)throw new Error('Message part is unavailable');let size=0;const chunks=[];
 for await(const chunk of download.content){const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=bytes.length;if(size>maxBytes){download.content.destroy?.();throw new Error('Message part exceeds the download limit');}chunks.push(bytes);}
 if(download.meta?.expectedSize>size&&size>=maxBytes)throw new Error('Message part exceeds the download limit');
 return Buffer.concat(chunks);
}
