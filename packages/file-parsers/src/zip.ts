import {
  FileExtractionError,
  fileExtractionLimits,
} from "@arclattice/application";
import { unzipSync } from "fflate";

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
/** Validate all central-directory metadata before any decompression allocation. */
export function officeArchive(bytes: Uint8Array): Record<string, Uint8Array> {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = -1;
    for (
      let offset = bytes.length - 22;
      offset >= Math.max(0, bytes.length - 65558);
      offset--
    )
      if (
        view.getUint32(offset, true) === 0x06054b50 &&
        offset + 22 + view.getUint16(offset + 20, true) === bytes.length
      ) {
        end = offset;
        break;
      }
    if (
      end < 0 ||
      view.getUint16(end + 4, true) ||
      view.getUint16(end + 6, true) ||
      view.getUint16(end + 8, true) !== view.getUint16(end + 10, true)
    )
      throw new FileExtractionError("MALFORMED");
    const count = view.getUint16(end + 10, true),
      centralSize = view.getUint32(end + 12, true),
      centralOffset = view.getUint32(end + 16, true);
    if (count > fileExtractionLimits.archiveEntries)
      throw new FileExtractionError("RESOURCE_LIMIT");
    if (!count || centralOffset + centralSize !== end)
      throw new FileExtractionError("MALFORMED");
    const entries = new Map<
      string,
      { size: number; crc: number; extract: boolean }
    >();
    const ranges: { start: number; end: number }[] = [];
    let cursor = centralOffset,
      expanded = 0;
    for (let i = 0; i < count; i++) {
      if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50)
        throw new FileExtractionError("MALFORMED");
      const flags = view.getUint16(cursor + 8, true),
        compression = view.getUint16(cursor + 10, true),
        crc = view.getUint32(cursor + 16, true),
        compressed = view.getUint32(cursor + 20, true),
        size = view.getUint32(cursor + 24, true),
        nameLength = view.getUint16(cursor + 28, true),
        extra = view.getUint16(cursor + 30, true),
        comment = view.getUint16(cursor + 32, true),
        start = view.getUint32(cursor + 42, true);
      if (flags & 1) throw new FileExtractionError("ENCRYPTED");
      if (compression !== 0 && compression !== 8)
        throw new FileExtractionError("UNSUPPORTED");
      if ((expanded += size) > fileExtractionLimits.expandedBytes)
        throw new FileExtractionError("RESOURCE_LIMIT");
      if (
        cursor + 46 + nameLength + extra + comment > end ||
        view.getUint16(cursor + 34, true) !== 0 ||
        start + 30 > centralOffset ||
        view.getUint32(start, true) !== 0x04034b50
      )
        throw new FileExtractionError("MALFORMED");
      const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
      const name = new TextDecoder("utf-8", { fatal: true }).decode(nameBytes);
      if (
        !name ||
        name.includes("\0") ||
        name.includes("\\") ||
        name.startsWith("/") ||
        /^[a-z]:/i.test(name) ||
        name
          .split("/")
          .some((part) =>
            ["..", ".", "__proto__", "constructor", "prototype"].includes(part),
          ) ||
        entries.has(name) ||
        /(^|\/)vbaProject\.bin$/i.test(name) ||
        /(^|\/)embeddings\//i.test(name)
      )
        throw new FileExtractionError("UNSAFE_CONTENT");
      const localNameLength = view.getUint16(start + 26, true),
        localExtra = view.getUint16(start + 28, true),
        dataStart = start + 30 + localNameLength + localExtra;
      if (
        view.getUint16(start + 6, true) !== flags ||
        view.getUint16(start + 8, true) !== compression ||
        localNameLength !== nameLength ||
        (!(flags & 8) &&
          (view.getUint32(start + 14, true) !== crc ||
            view.getUint32(start + 18, true) !== compressed ||
            view.getUint32(start + 22, true) !== size)) ||
        dataStart + compressed > centralOffset ||
        !nameBytes.every((byte, index) => byte === bytes[start + 30 + index])
      )
        throw new FileExtractionError("MALFORMED");
      ranges.push({ start, end: dataStart + compressed });
      const extract = name.endsWith(".xml") || name.endsWith(".rels");
      if (extract && size > fileExtractionLimits.xmlBytes)
        throw new FileExtractionError("RESOURCE_LIMIT");
      entries.set(name, { size, crc, extract });
      cursor += 46 + nameLength + extra + comment;
    }
    if (cursor !== end) throw new FileExtractionError("MALFORMED");
    ranges.sort((a, b) => a.start - b.start);
    if (
      ranges.some(
        (range, index) => index > 0 && range.start < ranges[index - 1]!.end,
      )
    )
      throw new FileExtractionError("MALFORMED");
    const files = unzipSync(bytes, {
      filter: (entry) => entries.get(entry.name)?.extract === true,
    });
    for (const [name, entry] of entries)
      if (entry.extract) {
        const file = files[name];
        if (!file || file.length !== entry.size || crc32(file) !== entry.crc)
          throw new FileExtractionError("MALFORMED");
      }
    if (!files["[Content_Types].xml"])
      throw new FileExtractionError("MALFORMED");
    return files;
  } catch (error) {
    if (error instanceof FileExtractionError) throw error;
    throw new FileExtractionError("MALFORMED");
  }
}
