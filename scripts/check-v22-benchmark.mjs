import { readFileSync } from "node:fs";

const budgets = [
  ["Now→Scheduled", 50, "scriptMs"],
  ["List→Board", 100, "taskMs"],
  ["Project filter", 75, "taskMs"],
  ["Task picker open", 50, "taskMs"],
  ["Task picker drill-down", 30, "taskMs"],
  ["Calendar month switch", 50, "taskMs"],
  ["Dependency local graph", 75, "taskMs"],
  ["Knowledge local graph", 100, "taskMs"],
  ["50KB typing", 16, "p95TaskMs"],
  ["100KB typing", 32, "p95TaskMs"],
];
for (const configuration of ["desktop-en", "desktop-zh"]) {
  const evidence = JSON.parse(
    readFileSync(
      new URL(
        "../docs/performance/v2.2/" + configuration + ".json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  for (const [operation, limit, metric] of budgets) {
    const value = evidence[operation]?.[metric];
    if (!Number.isFinite(value) || value >= limit)
      throw new Error(
        configuration +
          ": " +
          operation +
          " exceeds " +
          limit +
          "ms (" +
          value +
          ")",
      );
  }
  if (
    evidence.liveListRows >= 100 ||
    evidence.liveBoardRows >= 100 ||
    evidence.fixture.tasks !== 1500 ||
    evidence.fixture.documents !== 2000 ||
    evidence.fixture.sessions !== 100 ||
    evidence.fixture.messagesPerSession !== 1000 ||
    evidence.sessionSummaryBytes >= 40000
  )
    throw new Error(configuration + ": fixture/DOM/summary budget failed");
  console.log(
    configuration +
      ": release CPU, editor, DOM and session-summary budgets passed",
  );
}
