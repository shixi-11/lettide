const URL_RE = /((?:https?:\/\/|www\.)[^\s<>()]+)/giu;

export function assertTranslationChanged(sourceText, translatedText, sourceLanguage, targetLanguage) {
  if (sourceLanguage !== targetLanguage && translatedText.trim() === sourceText.trim()) {
    throw new Error('Local model returned the original text for a different target language');
  }
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
    for (const [index, piece] of paragraph.split(URL_RE).entries()) {
      if (!piece) continue;
      if (index % 2) {
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
