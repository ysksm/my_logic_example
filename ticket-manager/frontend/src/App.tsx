import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { useEffect, useState } from "react";
import { api } from "@/infrastructure/api/client";
import TicketsPage from "@/presentation/pages/TicketsPage";
import CalendarPage from "@/presentation/pages/CalendarPage";
import TimeEntriesPage from "@/presentation/pages/TimeEntriesPage";
import RepositoriesPage from "@/presentation/pages/RepositoriesPage";
import SprintsPage from "@/presentation/pages/SprintsPage";
import MaintenancePage from "@/presentation/pages/MaintenancePage";

export default function App() {
  const [maintenance, setMaintenance] = useState(false);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const h = await api.health();
        if (alive) setMaintenance(h.maintenance);
      } catch {
        /* ignore */
      }
    };
    tick();
    const t = setInterval(tick, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return (
    <div className="layout">
      <aside className="sidebar">
        <h2>Ticket Manager</h2>
        <nav>
          <NavLink to="/tickets" className={({ isActive }) => (isActive ? "active" : "")}>チケット</NavLink>
          <NavLink to="/sprints" className={({ isActive }) => (isActive ? "active" : "")}>スプリント / バックログ</NavLink>
          <NavLink to="/calendar" className={({ isActive }) => (isActive ? "active" : "")}>カレンダー</NavLink>
          <NavLink to="/time" className={({ isActive }) => (isActive ? "active" : "")}>工数</NavLink>
          <NavLink to="/repositories" className={({ isActive }) => (isActive ? "active" : "")}>リポジトリ</NavLink>
          <NavLink to="/maintenance" className={({ isActive }) => (isActive ? "active" : "")}>メンテナンス</NavLink>
        </nav>
      </aside>
      <main className="main">
        {maintenance && (
          <div className="maintenance-banner">
            メンテナンスモードが有効です。直接 DB の参照・更新が可能になっています。
          </div>
        )}
        <Routes>
          <Route path="/" element={<Navigate to="/tickets" replace />} />
          <Route path="/tickets" element={<TicketsPage />} />
          <Route path="/tickets/:id" element={<TicketsPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/time" element={<TimeEntriesPage />} />
          <Route path="/sprints" element={<SprintsPage />} />
          <Route path="/repositories" element={<RepositoriesPage />} />
          <Route path="/maintenance" element={<MaintenancePage />} />
        </Routes>
      </main>
    </div>
  );
}
