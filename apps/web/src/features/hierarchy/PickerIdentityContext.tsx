import { createContext } from "react";
import type { PickerIdentity } from "./recent";
export const PickerIdentityContext = createContext<PickerIdentity | null>(null);
