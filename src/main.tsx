import window from 'global';
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// 🚀 终极绝招：如果浏览器在任何地方找不到 React，直接在全局窗口上硬塞一个给他！
if (typeof window !== "undefined") {
  (window as any).React = React;
}

createRoot(document.getElementById("root")!).render(<App />);
