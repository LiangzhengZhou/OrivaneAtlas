import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { describe, expect, it } from "vitest";
import { Markdown } from "./Markdown";

const render = (text: string) =>
  renderToStaticMarkup(createElement(Markdown, { text }));

describe("note and mathematical Markdown rendering", () => {
  it("keeps File references in the workspace and external links isolated", () => {
    const id = "33333333-3333-4333-8333-333333333333";
    const html = render(
      `[source](#library?file=${id})\n\n[external](https://example.com/)`,
    );
    expect(html).toContain(`<a href="#library?file=${id}">source</a>`);
    expect(html).toContain(
      'href="https://example.com/" rel="noreferrer noopener" target="_blank"',
    );
  });
  it("preserves single newlines, GFM tables and task lists without math", () => {
    const html = render(
      "first line\nsecond line\n\n| Heading |\n| --- |\n| Value |\n\n- [x] Done",
    );
    expect(html).toContain("first line<br/>\nsecond line");
    expect(html).toContain("<table>");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("checked");
    expect(html).not.toContain("katex");
  });

  it("renders both inline and display math and preserves escaped dollars", () => {
    const html = render("Inline $x^2$\n\n$$\nx+y\n$$\n\nPrice \\$5");
    expect(html).toContain('class="katex"');
    expect(html).toContain('class="katex-display"');
    expect(html).toContain("Price $5");
  });

  it("keeps raw HTML, executable links and external images inert in both paths", () => {
    for (const suffix of ["", "\n\n$x$"]) {
      const html = render(
        "<script>alert(1)</script>\n\n[unsafe](javascript:alert(1))\n\n![external](https://example.com/image.png)" +
          suffix,
      );
      expect(html).not.toContain("<script>");
      expect(html).not.toContain('href="javascript:');
      expect(html).not.toContain("<img");
      expect(html).toContain("external");
    }
  });

  it("matches the established reader for block syntax, footnotes, math and inert HTML", () => {
    for (const text of [
      "# Heading\n\n> Quote\n\n---",
      "- one\n  - nested\n\n1. ordered\n2. list",
      "```typescript\nconst a = 1;\n```\n\n`inline`",
      "| left | right |\n| :--- | ---: |\n| a | b |",
      "- [ ] open\n- [x] done\n\n~~removed~~",
      "Footnote[^a]\n\n[^a]: Definition",
      '<div onclick="alert(1)">inert</div>\n\n<style>body{display:none}</style>',
      "Inline $x^2$\n\n$$\nx+y\n$$\n\nPrice \\$5",
      "$\\href{javascript:alert(1)}{unsafe}$",
    ]) {
      const expected = renderToStaticMarkup(
        createElement(
          "div",
          { className: "markdown" },
          createElement(ReactMarkdown, {
            remarkPlugins: [remarkGfm, remarkMath, remarkBreaks],
            rehypePlugins: [[rehypeKatex, { strict: "ignore", trust: false }]],
            components: {
              a: ({ href, children }) =>
                href && /^(https?:\/\/|#)/.test(href)
                  ? createElement(
                      "a",
                      { href, rel: "noreferrer noopener", target: "_blank" },
                      children,
                    )
                  : createElement("span", null, children),
            },
            children: text,
          }),
        ),
      );
      expect(render(text)).toBe(expected);
    }
    expect(render("Second document")).not.toContain("footnote");
  });
});
