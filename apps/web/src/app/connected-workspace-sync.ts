export interface ConnectedWorkspaceSyncPorts {
  sync(): Promise<{ cursor: number } | null>;
  stream?:
    | ((
        cursor: string,
        signal: AbortSignal,
        changed: (cursor: string) => void,
        connected: () => void,
      ) => Promise<void>)
    | undefined;
  schedule(callback: () => void, delay: number): () => void;
  visible(): boolean;
  onOffline(value: boolean): void;
}

/** Only the runtime may authorize a durable binding. Stream events merely wake a pull. */
export function connectedWorkspaceSync(ports: ConnectedWorkspaceSyncPorts) {
  let stopped = false,
    running = false,
    requested = false,
    failures = 0;
  let cancelTimer: (() => void) | undefined;
  let stream: AbortController | undefined;
  let eventCursor = "";
  let streamFailures = 0;
  const schedule = (delay: number) => {
    cancelTimer?.();
    cancelTimer = ports.schedule(wake, delay);
  };
  async function cycle() {
    if (stopped || running || !ports.visible()) return;
    running = true;
    try {
      do {
        requested = false;
        const result = await ports.sync();
        if (stopped) return;
        failures = 0;
        ports.onOffline(false);
        if (!result && stream) {
          stream.abort();
          stream = undefined;
          eventCursor = "";
        }
        if (result && ports.stream && !stream) {
          const controller = new AbortController();
          stream = controller;
          void ports
            .stream(
              eventCursor,
              controller.signal,
              (cursor) => {
                if (stopped || controller.signal.aborted) return;
                eventCursor = cursor;
                wake();
              },
              () => {
                if (!stopped && !controller.signal.aborted) streamFailures = 0;
              },
            )
            .catch(() => {
              if (!stopped && !controller.signal.aborted) ports.onOffline(true);
            })
            .finally(() => {
              if (stream === controller) stream = undefined;
              if (!stopped && !controller.signal.aborted)
                schedule(
                  Math.min(30000, 1000 * 2 ** Math.min(streamFailures++, 5)),
                );
            });
        }
      } while (requested && !stopped && ports.visible());
      schedule(30000);
    } catch {
      if (!stopped) {
        ports.onOffline(true);
        schedule(Math.min(30000, 1000 * 2 ** Math.min(failures++, 5)));
      }
    } finally {
      running = false;
    }
  }
  function wake() {
    if (stopped) return;
    requested = true;
    cancelTimer?.();
    void cycle();
  }
  schedule(0);
  return {
    wake,
    stop() {
      stopped = true;
      cancelTimer?.();
      stream?.abort();
    },
  };
}
