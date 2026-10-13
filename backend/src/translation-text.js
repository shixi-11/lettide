const URL_RE = /((?:https?:\/\/|www\.)[^\s<>()]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|(?<![\p{L}\p{N}])[A-Z][a-z]+(?:[A-Z][A-Za-z0-9]*)+(?![\p{L}\p{N}]))/gu;

export function assertTranslationChanged(sourceText, translatedText, sourceLanguage, targetLanguage) {
  if (sourceLanguage !== targetLanguage && translatedText.trim() === sourceText.trim()) {
    throw new Error('Local model returned the original text for a different target language');
  }
}


const targetScripts={zho_Hans:['Han','Latin'],zho_Hant:['Han','Latin'],eng_Latn:['Latin'],fra_Latn:['Latin'],jpn_Jpan:['Han','Hiragana','Katakana','Latin'],kor_Hang:['Hangul','Latin']};
const examinedScripts=['Arabic','Greek','Hebrew','Cyrillic','Han','Hiragana','Katakana','Hangul','Thai','Devanagari'];
const prose=text=>String(text).replace(/https?:\/\/\S+|www\.\S+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/gu,' ');
function maxRepetition(text){
 const words=prose(text).toLowerCase().match(/[\p{L}\p{N}]+/gu)||[];let maximum=1;
 for(let width=1;width<=6;width++)for(let i=0;i+width*2<=words.length;i++){
  let repeats=1,j=i+width;while(j+width<=words.length&&words.slice(i,i+width).every((word,k)=>word===words[j+k])){repeats++;j+=width;}
  maximum=Math.max(maximum,repeats);if(repeats>1)i+=(repeats-1)*width;
 }
 for(const match of prose(text).matchAll(/([\p{L}]{2,12})(?:[\s\p{P}]*\1){4,}/gu))maximum=Math.max(maximum,match[0].split(match[1]).length-1);
 return maximum;
}
export function assertTranslationQuality(sourceText,translatedText,targetLanguage){
 const source=prose(sourceText),translated=prose(translatedText),allowed=targetScripts[targetLanguage];
 if(allowed)for(const script of examinedScripts){if(allowed.includes(script))continue;const pattern=new RegExp('\\p{Script='+script+'}','gu'),before=(source.match(pattern)||[]).length,after=(translated.match(pattern)||[]).length;if(after>before+2)throw new Error('Translation contains an unexpected language. Please retry.');}
 if(translated.length>Math.max(100,source.length*5+40))throw new Error('Translation contains abnormal repetition. Please retry.');
 if(maxRepetition(translated)>=Math.max(5,maxRepetition(source)*2+2))throw new Error('Translation contains abnormal repetition. Please retry.');
 if(['zho_Hans','zho_Hant'].includes(targetLanguage)&&(source.match(/\p{Script=Latin}/gu)||[]).length>40&&(translated.match(/\p{Script=Latin}/gu)||[]).length>40&&!/\p{Script=Han}/u.test(translated))throw new Error('Translation contains an unexpected language. Please retry.');
}

export function sentencePieces(text){
 const parts=[];let start=0;const boundary=/[.!?。！？]+["'”’)]?(\s+)(?=[\p{Lu}\p{Script=Han}\p{Script=Hiragana}\p{Script=Hangul}\p{N}])/gu;
 for(const match of text.matchAll(boundary)){
  const prefix=text.slice(start,match.index),lastWord=prefix.match(/[\p{L}\p{N}.]+$/u)?.[0]||'';
  if(/^(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|e\.g|i\.e)$/iu.test(lastWord)||/^(?:[A-Z]|\d+)$/u.test(lastWord))continue;
  const cut=match.index+match[0].length-match[1].length;parts.push(text.slice(start,cut),match[1]);start=cut+match[1].length;
 }
 if(start<text.length)parts.push(text.slice(start));return parts;
}

/** Split text while preserving paragraph breaks and URLs exactly. */
export async function tokenSegments(text, tokenCount, { tokenLimit = 800, onProgress = () => {} } = {}) {
  const out = [];
  let completed = 0;
  onProgress({ phase: 'preparing', completed, total: text.length });
  const push = (value, translate) => {
    out.push({ text: value, translate });
    completed += value.length;
    onProgress({ phase: 'preparing', completed, total: text.length });
  };

  for (const paragraph of text.split(/(\r?\n+)/u)) {
    if (!paragraph.trim() || paragraph.includes('\n')) {
      if (paragraph) push(paragraph, false);
      continue;
    }
    for (const [index, protectedPiece] of paragraph.split(URL_RE).entries()) {
    for(const piece of index%2?[protectedPiece]:sentencePieces(protectedPiece)){
      if (!piece) continue;
      if (index % 2 || !/\p{L}/u.test(piece)) {
        push(piece, false);
        continue;
      }
      let rest = piece;
      while (rest) {
        const window = safeCodePointBoundary(rest, Math.min(rest.length, tokenLimit * 8));
        const windowText = rest.slice(0, window);
        if (await tokenCount(windowText) <= tokenLimit) {
          push(windowText, true);
          rest = rest.slice(window);
          continue;
        }
        let low = 1;
        // Only tokenize a bounded prefix. Searching the full remainder on every
        // chunk makes long emails quadratic in tokenizer input volume.
        let high = window;
        let best = 0;
        while (low <= high) {
          const mid = Math.floor((low + high) / 2);
          const safeMid = safeCodePointBoundary(rest, mid);
          if (safeMid > 0 && await tokenCount(rest.slice(0, safeMid)) <= tokenLimit) {
            best = safeMid;
            low = mid + 1;
          } else high = mid - 1;
        }
        if (!best) throw new Error('Could not split text within the model token limit');
        let cut = best;
        const prefix = rest.slice(0, best);
        const boundary = Math.max(
          prefix.lastIndexOf(' '), prefix.lastIndexOf('\t'),
          prefix.lastIndexOf('.'), prefix.lastIndexOf('。'),
          prefix.lastIndexOf('!'), prefix.lastIndexOf('?'),
        );
        if (boundary >= best * 0.65) cut = boundary + 1;
        cut = safeCodePointBoundary(rest, cut);
        if (!cut || await tokenCount(rest.slice(0, cut)) > tokenLimit) cut = best;
        push(rest.slice(0, cut), true);
        rest = rest.slice(cut);
      }
    }
    }
  }
  return out;
}

function safeCodePointBoundary(text, offset) {
  if (offset > 0 && offset < text.length) {
    const previous = text.charCodeAt(offset - 1);
    const next = text.charCodeAt(offset);
    if (previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) return offset - 1;
  }
  return offset;
}
