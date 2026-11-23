import type { FileExtractionDocument } from "@arclattice/domain";
import { useMemo, useState } from "react";
import { Button } from "../../components/ui/Button";
import { VirtualTaskCollection } from "../tasks/VirtualTaskCollection";
import {
  delimitedSampleCharacters,
  sampleDelimited,
} from "./delimited-preview";

export function FilePreview({
  document,
  extension,
  zh,
}: {
  document: FileExtractionDocument;
  extension: string;
  zh: boolean;
}) {
  const chunks = useMemo(
    () => document.chunks.map((chunk) => ({ ...chunk, id: chunk.locator })),
    [document],
  );
  const [source, setSource] = useState(false);
  const table = useMemo(() => {
    if (
      !["tsv", "csv"].includes(extension) ||
      !chunks.length ||
      chunks.some((chunk) => chunk.kind !== "TABLE")
    )
      return null;
    let sample = "";
    for (const chunk of chunks) {
      sample += chunk.text.slice(
        0,
        delimitedSampleCharacters + 1 - sample.length,
      );
      if (sample.length > delimitedSampleCharacters) break;
    }
    return sampleDelimited(sample, extension === "tsv" ? "\t" : ",");
  }, [chunks, extension]);
  const pages = useMemo(() => {
    if (extension !== "pdf") return [];
    const byNumber = new Map<number, typeof chunks>();
    for (const chunk of chunks) {
      const match = /^page:(\d+)\/chunk:\d+$/.exec(chunk.locator);
      if (!match || chunk.kind !== "PAGE") return [];
      const number = Number(match[1]);
      const page = byNumber.get(number) ?? [];
      page.push(chunk);
      byNumber.set(number, page);
    }
    return [...byNumber].sort(([a], [b]) => a - b);
  }, [chunks, extension]);
  const [pageIndex, setPageIndex] = useState(0);
  const activeIndex = Math.min(pageIndex, pages.length - 1);
  const page = pages[activeIndex];
  return (
    <div className="file-text-preview">
      {page && (
        <nav
          className="file-preview-tools"
          aria-label={zh ? "PDF 文本分页" : "PDF text pages"}
        >
          <Button
            variant="ghost"
            disabled={activeIndex === 0}
            onClick={() => setPageIndex(activeIndex - 1)}
          >
            {zh ? "上一页" : "Previous page"}
          </Button>
          <span role="status">
            {zh
              ? `第 ${page[0]} 页 · 提取文本`
              : `Page ${page[0]} · Extracted text`}
          </span>
          <Button
            variant="ghost"
            disabled={activeIndex === pages.length - 1}
            onClick={() => setPageIndex(activeIndex + 1)}
          >
            {zh ? "下一页" : "Next page"}
          </Button>
        </nav>
      )}
      {table && (
        <div className="file-preview-tools">
          <Button
            type="button"
            variant="ghost"
            aria-pressed={source}
            onClick={() => setSource(!source)}
          >
            {zh ? "源文本" : "Source text"}
          </Button>
          {table.clipped && !source && (
            <span role="status">
              {zh
                ? "仅显示部分行列，可切换至源文本。"
                : "Showing a sample. Open source text for the full extraction."}
            </span>
          )}
        </div>
      )}
      {table && !source ? (
        <div
          className="file-table-scroll"
          role="region"
          tabIndex={0}
          aria-label={zh ? "表格预览" : "Table preview"}
        >
          <table>
            <caption>{zh ? "表格内容" : "Table contents"}</caption>
            <tbody>
              {table.rows.map((row, index) => (
                <tr key={index}>
                  <th scope="row">{index + 1}</th>
                  {row.map((cell, column) => (
                    <td key={column}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <VirtualTaskCollection
          items={page?.[1] ?? chunks}
          virtualizeAfter={10}
          estimatedRowHeight={240}
          render={(chunk) => (
            <section key={chunk.locator}>
              {chunk.title && <h3>{chunk.title}</h3>}
              <pre>{chunk.text}</pre>
            </section>
          )}
        />
      )}
    </div>
  );
}
