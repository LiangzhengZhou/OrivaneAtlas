import type { AgentRun, ModelEventPage } from "@arclattice/application";
import type { Runtime } from "../../bootstrap";

/** SSE first, cursor-only fallback. Never reloads the full Atlas run collection. */
export function observeAtlasRun(
  runtime: Pick<Runtime, "streamAiEvents" | "aiEvents" | "agentRun">,
  id: string,
  onDelta: (text: string) => void,
  onComplete: (run: AgentRun) => void,
  onError: (error: unknown) => void,
) {
  const controller = new AbortController();
  let cursor = 0,
    delay = 1000,
    timer: ReturnType<typeof setTimeout> | undefined;
  const append = (page: ModelEventPage) => {
    if (controller.signal.aborted || page.cursor <= cursor) return;
    const overlap = Math.max(0, cursor - (page.cursor - page.events.length));
    const delta = page.events
      .slice(overlap)
      .flatMap((event) => (event.type === "text-delta" ? [event.text] : []))
      .join("");
    cursor = page.cursor;
    if (delta) onDelta(delta);
  };
  const complete = async () => {
    if (controller.signal.aborted) return;
    const run = await runtime.agentRun(id);
    if (!controller.signal.aborted) onComplete(run);
  };
  const poll = async () => {
    if (controller.signal.aborted) return;
    try {
      const page = await runtime.aiEvents(id, cursor);
      append(page);
      if (page.done) {
        await complete();
        return;
      }
    } catch (error) {
      if (!controller.signal.aborted) onError(error);
    }
    delay = Math.min(4000, delay * 2);
    if (!controller.signal.aborted)
      timer = setTimeout(() => void poll(), delay);
  };
  void runtime
    .streamAiEvents(id, controller.signal, append)
    .then(complete)
    .catch(() => {
      if (!controller.signal.aborted)
        timer = setTimeout(() => void poll(), delay);
    });
  return () => {
    controller.abort();
    clearTimeout(timer);
  };
}
