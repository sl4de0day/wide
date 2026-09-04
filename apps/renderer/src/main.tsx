import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { ensureLanguageLoaded } from "./lib/i18n";
import "./styles/index.css";

const host = document.getElementById("root");
if (!host) throw new Error("#root is missing from index.html");

void ensureLanguageLoaded().finally(() => {
  createRoot(host).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
