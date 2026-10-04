export class WorkspaceEventDecoder {
  private buffer = "";
  private readonly decoder = new TextDecoder();
  private cursor: string;
  constructor(cursor = "") {
    this.cursor = cursor;
  }
  feed(bytes: Uint8Array): string[] {
    this.buffer += this.decoder.decode(bytes, { stream: true });
    if (this.buffer.length > 16384) throw new Error("INVALID_WORKSPACE_EVENT");
    const cursors: string[] = [];
    let boundary = this.buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const frame = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);
      const data = frame.split("\n").find((line) => line.startsWith("data: "));
      if (data) {
        const value: unknown = JSON.parse(data.slice(6));
        if (!value || typeof value !== "object" || Array.isArray(value))
          throw new Error("INVALID_WORKSPACE_EVENT");
        const row = value as Record<string, unknown>;
        if (
          Object.keys(row).length !== 1 ||
          typeof row.cursor !== "string" ||
          row.cursor.length > 96 ||
          !/^[a-f0-9]{32}:\d+$/.test(row.cursor)
        )
          throw new Error("INVALID_WORKSPACE_EVENT");
        if (row.cursor !== this.cursor) {
          this.cursor = row.cursor;
          cursors.push(row.cursor);
        }
      }
      boundary = this.buffer.indexOf("\n\n");
    }
    return cursors;
  }
}
