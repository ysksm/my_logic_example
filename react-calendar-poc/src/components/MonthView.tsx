import type { CalendarEvent } from "../types";
import {
  DAY_LABELS,
  eventsOnDay,
  getEventHours,
  isSameDay,
  isSameMonth,
  totalHoursOnDay,
} from "../utils/dateUtils";

interface Props {
  /** 6 週 x 7 日 = 42 セル */
  days: Date[];
  /** 月の基準日（このカレンダーが表しているのは何月か） */
  baseDate: Date;
  events: CalendarEvent[];
  onCreateAt: (start: Date) => void;
  onSelectEvent: (event: CalendarEvent) => void;
}

const MAX_VISIBLE_EVENTS = 3;

export function MonthView({
  days,
  baseDate,
  events,
  onCreateAt,
  onSelectEvent,
}: Props) {
  const today = new Date();
  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  const handleDayClick = (day: Date) => {
    const start = new Date(day);
    start.setHours(9, 0, 0, 0);
    onCreateAt(start);
  };

  return (
    <div className="month-view">
      <div className="month-view__weekdays">
        {DAY_LABELS.map((d, i) => (
          <div
            key={d}
            className={`month-view__weekday${
              i === 0 ? " is-sun" : i === 6 ? " is-sat" : ""
            }`}
          >
            {d}
          </div>
        ))}
      </div>
      <div className="month-view__grid">
        {weeks.map((week, wi) => (
          <div key={wi} className="month-view__row">
            {week.map((day) => {
              const dayEvents = eventsOnDay(events, day);
              const visible = dayEvents.slice(0, MAX_VISIBLE_EVENTS);
              const hidden = dayEvents.length - visible.length;
              const isCurrentMonth = isSameMonth(day, baseDate);
              const isToday = isSameDay(day, today);
              const total = totalHoursOnDay(events, day);
              return (
                <div
                  key={day.toISOString()}
                  className={`month-view__cell${
                    isCurrentMonth ? "" : " is-out"
                  }${isToday ? " is-today" : ""}`}
                  onClick={() => handleDayClick(day)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleDayClick(day);
                    }
                  }}
                >
                  <div className="month-view__cell-head">
                    <span
                      className={`month-view__date${
                        day.getDay() === 0
                          ? " is-sun"
                          : day.getDay() === 6
                          ? " is-sat"
                          : ""
                      }`}
                    >
                      {day.getDate()}
                    </span>
                    {total > 0 && (
                      <span
                        className="month-view__total"
                        title="合計工数"
                      >
                        {total.toFixed(1)}h
                      </span>
                    )}
                  </div>
                  <ul className="month-view__events">
                    {visible.map((ev) => {
                      const s = new Date(ev.start);
                      return (
                        <li key={ev.id}>
                          <button
                            type="button"
                            className="month-event"
                            style={{
                              backgroundColor: ev.color ?? "#1a73e8",
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectEvent(ev);
                            }}
                            title={`${ev.title} / ${getEventHours(ev).toFixed(
                              1
                            )}h`}
                          >
                            <span className="month-event__time">
                              {String(s.getHours()).padStart(2, "0")}:
                              {String(s.getMinutes()).padStart(2, "0")}
                            </span>
                            <span className="month-event__title">
                              {ev.title}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                    {hidden > 0 && (
                      <li className="month-view__more">他 {hidden} 件</li>
                    )}
                  </ul>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
