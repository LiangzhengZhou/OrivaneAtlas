export function coalescedRefresh(load: (showError: boolean) => Promise<void>) {
  let pending: Promise<void> | null = null;
  let requested = false;
  let reportErrors = false;
  return (showError: boolean): Promise<void> => {
    requested = true;
    reportErrors ||= showError;
    if (pending) return pending;
    pending = Promise.resolve().then(async () => {
      try {
        do {
          requested = false;
          const report = reportErrors;
          reportErrors = false;
          await load(report);
        } while (requested);
      } finally {
        pending = null;
      }
    });
    return pending;
  };
}
