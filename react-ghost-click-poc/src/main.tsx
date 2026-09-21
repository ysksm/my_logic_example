import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// NOTE: StrictMode は意図的に外しています。
// 開発時の effect 二重実行で <dialog>.showModal() / close() が二重に走り、
// 再現条件（「イベント直後に同期的にダイアログが開く」）が分かりにくくなるためです。
createRoot(document.getElementById("root")!).render(<App />);
