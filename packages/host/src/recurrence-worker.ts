/** Single-flight lifecycle adapter. No browser session, credentials or payload logging. */
export function startRecurrenceWorker(
  tick: () => Promise<void>,
  intervalMs = 60_000,
  failed: () => void = () =>
    console.error("Recurrence scan failed; retrying next tick"),
) {
  let stopped = false;
  let active: Promise<void> | undefined;
  const run = () => {
    if (stopped) return Promise.resolve();
    if (active) return active;
    active = Promise.resolve()
      .then(tick)
      .catch(failed)
      .finally(() => {
        active = undefined;
      });
    return active;
  };
  const timer = setInterval(() => void run(), intervalMs);
  timer.unref();
  void run();
  return {
    run,
    async close() {
      stopped = true;
      clearInterval(timer);
      await active;
    },
  };
}
