import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { markOnce } from "./lib/performance";
import "./styles.css";
import "./accessibility.css";

markOnce("cumea:renderer:entry-evaluated");
markOnce("cumea:renderer:render-start");
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
markOnce("cumea:renderer:render-submitted");
