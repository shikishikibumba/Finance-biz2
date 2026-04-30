import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import App from "@/App";

// Suppress benign ResizeObserver warning triggered by Recharts/Radix on rapid resize
const RESIZE_OBSERVER_ERRORS = [
  "ResizeObserver loop completed with undelivered notifications.",
  "ResizeObserver loop limit exceeded",
];
window.addEventListener("error", (e) => {
  if (RESIZE_OBSERVER_ERRORS.some((msg) => e.message?.includes(msg))) {
    e.stopImmediatePropagation();
    e.preventDefault();
  }
});

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
