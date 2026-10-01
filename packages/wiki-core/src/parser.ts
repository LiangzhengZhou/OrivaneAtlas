import type { WikiHeading, WikiLink } from "./types";

function codeRanges(markdown: string) {
  const ranges: Array<[number, number]> = [];
  let fence: { marker: string; start: number } | null = null;
  for (const match of markdown.matchAll(/[^\n]*\n|[^\n]+$/g)) {
    const line = match[0].replace(/\r?\n$/, "");
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!marker) continue;
    if (!fence) {
      if (marker[1]!.startsWith("`") && marker[2]!.includes("`")) continue;
      fence = { marker: marker[1]!, start: match.index };
    } else if (
      marker[1]![0] === fence.marker[0] &&
      marker[1]!.length >= fence.marker.length &&
      !marker[2]!.trim()
    ) {
      ranges.push([fence.start, match.index + match[0].length]);
      fence = null;
    }
  }
  if (fence) ranges.push([fence.start, markdown.length]);
  const ticks = [...markdown.matchAll(/`+/g)].filter(
    (match) =>
      !ranges.some(([from, to]) => match.index >= from && match.index < to),
  );
  const next = new Map<number, number>();
  const closing: Array<number | undefined> = [];
  for (let index = ticks.length - 1; index >= 0; index--) {
    const tick = ticks[index]!;
    closing[index] = next.get(tick[0].length);
    next.set(tick[0].length, index);
  }
  for (let index = 0; index < ticks.length; index++) {
    const tick = ticks[index]!;
    const endIndex = closing[index];
    if (endIndex === undefined || escaped(markdown, tick.index)) continue;
    const end = ticks[endIndex]!;
    ranges.push([tick.index, end.index + end[0].length]);
    index = endIndex;
  }
  return ranges;
}

function escaped(markdown: string, offset: number) {
  let slashes = 0;
  for (let index = offset - 1; index >= 0 && markdown[index] === "\\"; index--)
    slashes++;
  return slashes % 2 === 1;
}

export function parseWikiLinks(markdown: string): WikiLink[] {
  const excluded = codeRanges(markdown);
  const links: WikiLink[] = [];
  const pattern = /(!?)\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g;
  for (const match of markdown.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (excluded.some(([from, to]) => start >= from && start < to)) continue;
    if (escaped(markdown, start) || !match[2]!.trim()) continue;
    links.push({
      targetText: match[2]!.trim(),
      alias: match[4]?.trim() ?? null,
      heading: match[3]?.trim() ?? null,
      start,
      end: start + match[0].length,
      embed: match[1] === "!",
    });
  }
  return links;
}

export function parseHeadings(markdown: string): WikiHeading[] {
  return markdown.split(/\r?\n/).flatMap((line) => {
    const match = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
    if (!match) return [];
    const text = match[2]!.trim();
    return [
      {
        text,
        slug: text
          .toLocaleLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, "-")
          .replace(/^-|-$/g, ""),
        level: match[1]!.length,
      },
    ];
  });
}
