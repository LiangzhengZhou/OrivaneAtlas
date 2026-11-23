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
  return encodePdf(objects);
}

/** A short reading sample with a different color on each of four pages. */
export function pageJumpPdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R 9 0 R] /Count 4 >>",
  ];
  for (const color of ["1 0 0", "0 1 0", "1 1 0", "0 0 1"]) {
    const content = color + " rg 0 0 100 100 re f";
    objects.push(
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources <<>> /Contents " +
        (objects.length + 2) +
        " 0 R >>",
      "<< /Length " +
        content.length +
        " >>\nstream\n" +
        content +
        "\nendstream",
    );
  }
  return encodePdf(objects);
}

function encodePdf(objects: string[]) {
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
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((n) => String(n).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${length}\n%%EOF\n`,
    ),
  );
  return Buffer.concat(chunks);
}
