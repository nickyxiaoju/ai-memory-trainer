export function chars(value: string) { return Array.from(value); }

export function findCodePoints(hay: string, needle: string) {
  const text = chars(hay), word = chars(needle);
  if (!word.length) return 0;
  outer: for (let i = 0; i + word.length <= text.length; i++) {
    for (let j = 0; j < word.length; j++) if (text[i + j] !== word[j]) continue outer;
    return i;
  }
  return -1;
}

export function sliceCodePoints(value: string, start: number, end: number) {
  return chars(value).slice(start, end).join('');
}
