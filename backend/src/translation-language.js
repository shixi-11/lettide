export const languageCodes = Object.freeze({
  '简体中文': 'zho_Hans',
  English: 'eng_Latn',
  日本語: 'jpn_Jpan',
  한국어: 'kor_Hang',
  '繁體中文': 'zho_Hant',
  Français: 'fra_Latn',
});

const codeSet = new Set(Object.values(languageCodes));
const frenchWords = new Set('bonjour merci vous votre nous je suis une des pour avec dans pas mais est cette qui que sur votre il elle nous ils elles les du au aux sont avez était faire reçu réponse courriel langue français'.split(' '));
const englishWords = new Set('hello please read this that the an a is are was were have has from with your you we i it for and but not can could would will thank thanks dear regards message attached today tomorrow'.split(' '));
const accentsFrench = /[àâçéèêëîïôûùüÿœæ]/giu;

// Exclusive, common script-specific cues. Shared Han characters are omitted.
const traditionalCues = new Set(Array.from('這虛郵會盡為與後發現務東時華來將廣經過點開對當區難優歡無實際機電問題長書親臺灣鐘萬認請讓從進選處識詞雖還麼買聽見號體國學說愛門風龍馬車魚鳥氣頭邊遠連給個關聲畫讀稱謝應簡轉換內業貴專斷變傳統權證護滿確離舊標價賣線網頁圖報閉擇聯絡訊範預覽驗該獨限維複雜顏動頻質調遷計產髮隻雙數據檔軟腦戶場樓縣鄉濟帳義譯體佈儲刪設於編輯誤結狀態輸庫雲隱順經驗覆語辨準實際歡迎郵件標題資訊'));
const simplifiedCues = new Set(Array.from('这虚邮会尽为与后发现务东时华来将广经过点开对当区难优欢无实机电问题长书亲台湾钟万认请让从进选处识词虽还么买听见号体国学说爱门风龙马车鱼鸟气头边远连给个关声画读称谢应简转换内业贵专断变传统权证护满确离旧标价卖线网页图报闭择联络讯范预览验该独限维复杂颜动频质调迁计产发只双数据档软脑户场楼县乡济帐义译布储删设于编辑误结状态输库云隐顺经验覆语辨准实际欢迎邮件标题资讯'));

for (const shared of '限覆辨迎件') { traditionalCues.delete(shared); simplifiedCues.delete(shared); }

export function normalizeLanguage(value) {
  if (codeSet.has(value)) return value;
  return languageCodes[value] || null;
}

function wordSet(text) {
  return new Set(text.toLowerCase().match(/[\p{Script=Latin}]+/gu) || []);
}

function countIntersection(words, vocabulary) {
  let count = 0;
  for (const word of words) if (vocabulary.has(word)) count++;
  return count;
}

export function detectSourceLanguage(text) {
  const body = String(text).replace(/https?:\/\/\S+|www\.\S+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/gu, ' ');
  const kana = (body.match(/[\u3040-\u30ff]/gu) || []).length;
  const hangul = (body.match(/[\uac00-\ud7af]/gu) || []).length;
  const han = (body.match(/[\u3400-\u9fff]/gu) || []).length;
  const latinCount = (body.match(/\p{Script=Latin}/gu) || []).length;
  const words = wordSet(body);
  const englishScore = countIntersection(words, englishWords);
  const frenchScore = countIntersection(words, frenchWords);
  const accentCount = (body.match(accentsFrench) || []).length;

  // Prefer a clearly dominant Latin body when a short Chinese/Japanese
  // signature is appended. A Han-only body still uses exclusive script cues.
  if (latinCount >= 12 && latinCount >= (han + kana + hangul) * 1.5) {
    if (frenchScore >= 2 && frenchScore > englishScore) return 'fra_Latn';
    if (englishScore >= 2 && englishScore > frenchScore) return 'eng_Latn';
    if (accentCount >= 2 && frenchScore >= 1) return 'fra_Latn';
  }

  if (kana >= 2 && kana >= latinCount * 0.5) return 'jpn_Jpan';
  if (hangul >= 2 && hangul >= latinCount * 0.5) return 'kor_Hang';

  if (han > 0 && han >= latinCount * 0.5) {
    const chars = new Set(Array.from(body));
    let traditional = 0;
    let simplified = 0;
    for (const char of chars) {
      if (traditionalCues.has(char)) traditional++;
      if (simplifiedCues.has(char)) simplified++;
    }
    if (traditional >= 2 && traditional - simplified >= 2) return 'zho_Hant';
    if (simplified >= 2 && simplified - traditional >= 2) return 'zho_Hans';
  }

  if (frenchScore >= 2 && frenchScore > englishScore) return 'fra_Latn';
  if (englishScore >= 2 && englishScore > frenchScore) return 'eng_Latn';
  if (kana >= 2) return 'jpn_Jpan';
  if (hangul >= 2) return 'kor_Hang';
  return null;
}
