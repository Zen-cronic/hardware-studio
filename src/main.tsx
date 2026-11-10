import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/ibm-plex-mono/latin-400.css";
import App from "./App";
import "./fonts.css";
import "@fontsource/source-sans-3/latin-400.css";
import "@fontsource/source-sans-3/latin-500.css";
import "@fontsource/source-sans-3/latin-600.css";
import "./styles.css";
import "./workbench.css";
import "./interface.css";
import "./theme.css";
import "./studio-shell.css";
import "./pages.css";
import "./polish.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
