/** Own async setup until it settles, including after a test deadline expires. */
export class FixtureScope {
  private closing = false;
  private pending = new Set<Promise<unknown>>();
  start() {
    if (this.pending.size) throw new Error("Fixture operations still running");
    this.closing = false;
  }
  assertOpen() {
    if (this.closing) throw new Error("Fixture scope closed");
  }
  run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new Error("Fixture scope closed"));
    const result = operation();
    this.pending.add(result);
    void result.then(
      () => this.pending.delete(result),
      () => this.pending.delete(result),
    );
    return result;
  }
  async drain() {
    this.closing = true;
    // Rejections belong to the test's original operation; draining owns lifetime.
    await Promise.allSettled([...this.pending]);
  }
}
