/** Ordered-subsequence ranking, favoring exact, prefix and word-boundary matches. */
export function commandScore(title: string, query: string): number {
  const text = title.normalize("NFKC").toLocaleLowerCase();
  const needle = query.trim().normalize("NFKC").toLocaleLowerCase();
  if (!needle) return 0;
  if (text === needle) return 1000;
  if (text.startsWith(needle)) return 800 - text.length;
  const exact = text.indexOf(needle);
  if (exact >= 0) return 600 - exact - text.length / 10;
  let position = -1,
    score = 0;
  for (const char of needle) {
    if (/\s/.test(char)) continue;
    const next = text.indexOf(char, position + 1);
    if (next < 0) return -1;
    score += next === position + 1 ? 20 : 5;
    if (next === 0 || /[\s/_-]/.test(text[next - 1]!)) score += 15;
    score -= next - position - 1;
    position = next;
  }
  return score - text.length / 10;
}
