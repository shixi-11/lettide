// Anonymous Google Translate web transport; not the supported Cloud Translation API.
// No account credentials, subject, headers, attachments, or message IDs leave this process.
export const languageCodes = Object.freeze({'简体中文':'zh-CN','English':'en','日本語':'ja','한국어':'ko','繁體中文':'zh-TW','Français':'fr'});
export function splitText(text, limit=3500) {
  const chunks=[]; let pending='';
  for(const char of text){pending+=char;if(pending.length>=limit){chunks.push(pending);pending='';}}
  if(pending)chunks.push(pending);
  return chunks;
}
export async function translateGoogle(text,targetLanguage,{fetchImpl=fetch}={}) {
  const tl=languageCodes[targetLanguage];
  if(!tl)throw new Error('Unsupported translation language');
  if(typeof text!=='string'||!text.trim()||text.length>100000)throw new Error('Invalid translation text');
  const result=[];
  // Preserve paragraph and line boundaries instead of relying on the web service to do so.
  for(const part of text.split(/(\r?\n+)/)){
    if(!part.trim()){result.push(part);continue;}
    for(const chunk of splitText(part)){
      const body=new URLSearchParams({client:'gtx',sl:'auto',tl,dt:'t',q:chunk});
      const response=await fetchImpl('https://translate.googleapis.com/translate_a/single',{
        method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:body.toString(),signal:AbortSignal.timeout(20000),redirect:'error',
      });
      if(!response.ok)throw new Error('Google translation is temporarily unavailable');
      const data=await response.json();
      const translated=Array.isArray(data?.[0])?data[0].map(x=>typeof x?.[0]==='string'?x[0]:'').join(''):'';
      if(!translated.trim())throw new Error('Google translation returned no text');
      result.push(translated);
    }
  }
  return result.join('');
}
