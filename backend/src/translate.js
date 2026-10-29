// Anonymous Google web transport. No paid API, credentials, headers or attachments.
export const languageCodes=Object.freeze({'简体中文':'zh-CN',English:'en','日本語':'ja','한국어':'ko','繁體中文':'zh-TW',Français:'fr'});
export function splitText(text,limit=3500){
 const chunks=[];let pending=text;
 while(pending.length>limit){
  let cut=0;const window=pending.slice(0,limit+1),candidates=[...window.matchAll(/(?:\n[\t ]*\n|[.!?。！？][ \t]+|[ \t]+|\n)/g)];
  for(const match of candidates){const boundary=match.index+match[0].length;if(boundary<=limit&&boundary>=limit/2)cut=boundary;}
  if(!cut){cut=limit;const code=pending.charCodeAt(cut-1);if(code>=0xd800&&code<=0xdbff)cut--;}
  chunks.push(pending.slice(0,cut));pending=pending.slice(cut);
 }if(pending)chunks.push(pending);return chunks;
}
export async function translateGoogle(text,targetLanguage,{fetchImpl=fetch,sourceLanguage='',signal,timeoutMs=20000}={}){
 const tl=languageCodes[targetLanguage],sl=languageCodes[sourceLanguage]||'auto';
 if(!tl)throw new Error('Unsupported translation language');
 if(typeof text!=='string'||!text.trim()||text.length>100000)throw new Error('Invalid translation text');
 const deadline=AbortSignal.timeout(timeoutMs),requestSignal=signal?AbortSignal.any([signal,deadline]):deadline;
 const chunks=splitText(text),result=new Array(chunks.length);let next=0;
 // A normal email is one request. Long emails use at most three requests at a time,
 // one deadline for the entire operation, and retain their original chunk order.
 await Promise.all(Array.from({length:Math.min(3,chunks.length)},async()=>{
  while(next<chunks.length){const index=next++,body=new URLSearchParams({client:'gtx',sl,tl,dt:'t',q:chunks[index]});
   const response=await fetchImpl('https://translate.googleapis.com/translate_a/single',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body.toString(),signal:requestSignal,redirect:'error'});
   if(!response.ok)throw new Error('Google translation is temporarily unavailable');
   const data=await response.json(),translated=Array.isArray(data?.[0])?data[0].map(x=>typeof x?.[0]==='string'?x[0]:'').join(''):'';
   if(!translated.trim())throw new Error('Google translation returned no text');result[index]=translated;
  }
 }));return result.join('');
}
