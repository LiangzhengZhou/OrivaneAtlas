export function DiffViewer({
  before,
  after,
}: {
  before: string;
  after: string;
}) {
  const left = before.split("\n");
  const right = after.split("\n");
  return (
    <pre className="document-diff">
      {Array.from(
        { length: Math.max(left.length, right.length) },
        (_, index) =>
          left[index] === right[index] ? (
            <div key={index}>
              {"  "}
              {left[index]}
            </div>
          ) : (
            <div key={index}>
              {left[index] !== undefined && (
                <div className="diff-removed">− {left[index]}</div>
              )}
              {right[index] !== undefined && (
                <div className="diff-added">+ {right[index]}</div>
              )}
            </div>
          ),
      )}
    </pre>
  );
}
