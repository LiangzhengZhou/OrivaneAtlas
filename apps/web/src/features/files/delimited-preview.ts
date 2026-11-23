/** Display-only sample. Quoted line breaks and doubled quotes remain literal cell text. */
export const delimitedSampleCharacters = 64000;

export function sampleDelimited(text: string, delimiter: "," | "\t") {
  const maxRows = 50;
  const maxColumns = 24;

  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    closedQuote = false,
    clipped = false;
  const finishCell = () => {
    if (row.length < maxColumns) row.push(cell);
    else clipped = true;
    cell = "";
    closedQuote = false;
  };
  const finishRow = () => {
    finishCell();
    rows.push(row);
    row = [];
  };
  const limit = Math.min(text.length, delimitedSampleCharacters);
  let i = 0;
  for (; i < limit && rows.length < maxRows; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (text[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        quoted = false;
        closedQuote = true;
      }
    } else if (ch === delimiter) finishCell();
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      finishRow();
    } else if (ch === '"' && !cell && !closedQuote) quoted = true;
    else if (closedQuote || ch === '"') return null;
    else cell += ch;
  }
  if (i < text.length) clipped = true;
  else {
    if (quoted) return null;
    if (row.length || cell.length || closedQuote) finishRow();
  }
  return rows.length ? { rows, clipped } : null;
}
