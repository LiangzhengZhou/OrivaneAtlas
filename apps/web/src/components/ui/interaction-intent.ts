export type SurfaceIntent = "NAVIGATE" | "SELECT" | "INSPECT";
export type SurfaceInput = "CLICK" | "DOUBLE_CLICK" | "ENTER" | "SPACE";

/** Navigation and exploration are different product operations. */
export function surfaceAction(
  intent: SurfaceIntent,
  input: SurfaceInput,
): "OPEN" | "SELECT" | null {
  if (intent === "NAVIGATE")
    return input === "CLICK" || input === "ENTER" || input === "SPACE"
      ? "OPEN"
      : null;
  return input === "ENTER" || input === "DOUBLE_CLICK" ? "OPEN" : "SELECT";
}
