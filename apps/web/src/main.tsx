import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { App } from "./App";
import { bootstrap } from "./bootstrap";
import "./styles.css";
import "./workspace.css";

const root = document.getElementById("root");
if (!root) throw new Error("Root element missing");
const runtime = await bootstrap();
createRoot(root).render(
  <StrictMode>
    <I18nextProvider i18n={runtime.i18n}>
      <App runtime={runtime} />
    </I18nextProvider>
  </StrictMode>,
);
