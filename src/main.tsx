import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// 🚀 安全的全局挂载方式（不需要任何外部 import）
if (typeof window !== "undefined") {
  (window as any).React = React;
}

createRoot(document.getElementById("root")!).render(<App />);
