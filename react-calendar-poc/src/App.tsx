import { useCallback, useEffect, useMemo, useState } from "react";
import type { CalendarEvent, ViewMode } from "./types";
import { CalendarHeader } from "./components/CalendarHeader";
import { TimeGridView } from "./components/TimeGridView";
import { MonthView } from "./components/MonthView";
import { EventModal } from "./components/EventModal";
import {
  generateId,
  getDaysForView,
  navigate,
  startOfMonth,
} from "./utils/dateUtils";

const STORAGE_KEY = "react-calendar-poc:events:v1";
const VIEW_KEY = "react-calendar-poc:view:v1";

function loadEvents(): CalendarEvent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedEvents();
    const parsed = JSON.parse(raw) as CalendarEvent[];
    if (!Array.isArray(parsed)) return seedEvents();
    return parsed;
  } catch {
    return seedEvents();
  }
}

function loadView(): ViewMode {
  const v = localStorage.getItem(VIEW_KEY) as ViewMode | null;
  if (v === "day" || v === "5day" || v === "week" || v === "month") return v;
  return "week";
}

function seedEvents(): CalendarEvent[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const make = (
    offsetDays: number,
    startH: number,
    endH: number,
    title: string,
    color: string,
    workHours?: number
  ): CalendarEvent => {
    const s = new Date(today);
    s.setDate(s.getDate() + offsetDays);
    s.setHours(startH, 0, 0, 0);
    const e = new Date(s);
    e.setHours(endH, 0, 0, 0);
    return {
      id: generateId(),
      title,
      start: s.toISOString(),
      end: e.toISOString(),
      color,
      workHours,
    };
  };
  return [
    make(0, 10, 11, "朝会", "#33b679", 1),
    make(0, 14, 16, "設計レビュー", "#1a73e8", 2),
    make(1, 9, 12, "実装作業", "#f4511e", 3),
    make(2, 13, 17, "顧客打ち合わせ", "#8e24aa", 4),
    make(-1, 15, 16, "1on1", "#e67c73", 1),
  ];
}

export default function App() {
  const [view, setView] = useState<ViewMode>(() => loadView());
  const [date, setDate] = useState<Date>(() => new Date());
  const [events, setEvents] = useState<CalendarEvent[]>(() => loadEvents());
  const [modal, setModal] = useState<
    | { mode: "create"; initialStart: Date }
    | { mode: "edit"; event: CalendarEvent }
    | null
  >(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  }, [events]);

  useEffect(() => {
    localStorage.setItem(VIEW_KEY, view);
  }, [view]);

  const days = useMemo(() => getDaysForView(date, view), [date, view]);
  const monthBase = useMemo(() => startOfMonth(date), [date]);

  const handleCreateAt = useCallback((start: Date) => {
    setModal({ mode: "create", initialStart: start });
  }, []);

  const handleSelectEvent = useCallback((event: CalendarEvent) => {
    setModal({ mode: "edit", event });
  }, []);

  const handleSave = useCallback((draft: CalendarEvent) => {
    setEvents((prev) => {
      if (!draft.id) {
        return [...prev, { ...draft, id: generateId() }];
      }
      return prev.map((e) => (e.id === draft.id ? draft : e));
    });
    setModal(null);
  }, []);

  const handleDelete = useCallback((id: string) => {
    setEvents((prev) => prev.filter((e) => e.id !== id));
    setModal(null);
  }, []);

  const handleCreateNow = useCallback(() => {
    const start = new Date();
    start.setMinutes(0, 0, 0);
    setModal({ mode: "create", initialStart: start });
  }, []);

  return (
    <div className="app">
      <CalendarHeader
        date={date}
        view={view}
        onChangeView={setView}
        onPrev={() => setDate((d) => navigate(d, view, -1))}
        onNext={() => setDate((d) => navigate(d, view, 1))}
        onToday={() => setDate(new Date())}
        onCreate={handleCreateNow}
      />

      <main className="app__main">
        {view === "month" ? (
          <MonthView
            days={days}
            baseDate={monthBase}
            events={events}
            onCreateAt={handleCreateAt}
            onSelectEvent={handleSelectEvent}
          />
        ) : (
          <TimeGridView
            days={days}
            events={events}
            onCreateAt={handleCreateAt}
            onSelectEvent={handleSelectEvent}
          />
        )}
      </main>

      {modal && (
        <EventModal
          event={modal.mode === "edit" ? modal.event : undefined}
          initialStart={
            modal.mode === "create" ? modal.initialStart : undefined
          }
          onClose={() => setModal(null)}
          onSave={handleSave}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}
