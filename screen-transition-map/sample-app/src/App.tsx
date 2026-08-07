import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { HomePage } from "./pages/HomePage";
import { ItemDetailPage } from "./pages/ItemDetailPage";
import { LoginPage } from "./pages/LoginPage";
import { SettingsPage } from "./pages/SettingsPage";

const TITLES: Record<string, string> = {
  "/login": "ログイン",
  "/": "ホーム",
  "/items/1": "商品詳細",
  "/settings": "設定",
};

export default function App() {
  const location = useLocation();

  // collector が document.title を画面名として採用するため、ルートごとに設定する
  useEffect(() => {
    const title = TITLES[location.pathname];
    document.title = title ? `${title} | サンプルショップ` : "サンプルショップ";
  }, [location.pathname]);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<HomePage />} />
      <Route path="/items/1" element={<ItemDetailPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
