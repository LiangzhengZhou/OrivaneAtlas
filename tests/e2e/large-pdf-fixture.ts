/** Two colored pages separated by an unreferenced stream, with valid xref offsets. */
export function largeSurveyPdf() {
  const stream = (text: string) =>
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`;
  const page = (content: number) =>
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources <<>> /Contents ${content} 0 R >>`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>",
    page(4),
    stream("1 0 0 rg 0 0 100 100 re f"),
    stream(" ".repeat(18 * 1024 * 1024)),
    page(7),
    stream("0 0 1 rg 0 0 100 100 re f"),
  ];
  const chunks = [Buffer.from("%PDF-1.7\n")],
    offsets: number[] = [];
  let length = chunks[0]!.length;
  for (const [i, object] of objects.entries()) {
    offsets.push(length);
    const bytes = Buffer.from(`${i + 1} 0 obj\n${object}\nendobj\n`, "ascii");
    chunks.push(bytes);
    length += bytes.length;
  }
  chunks.push(
    Buffer.from(
      `xref\n0 8\n0000000000 65535 f \n${offsets.map((n) => String(n).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Root 1 0 R /Size 8 >>\nstartxref\n${length}\n%%EOF\n`,
    ),
  );
  return Buffer.concat(chunks);
}
