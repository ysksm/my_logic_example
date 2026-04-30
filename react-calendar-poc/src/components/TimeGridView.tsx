import { useMemo } from "react";
import type { CalendarEvent } from "../types";
import {
  DAY_LABELS,
  HOURS,
  HOUR_HEIGHT,
  SLOT_HEIGHT,
  SLOT_MINUTES,
  durationToHeight,
  eventsOnDay,
  getEventHours,
  isSameDay,
  startOfDay,
  timeToOffset,
  totalHoursOnDay,
} from "../utils/dateUtils";

interface Props {
  days: Date[];
  events: CalendarEvent[];
  onCreateAt: (start: Date) => void;
  onSelectEvent: (event: CalendarEvent) => void;
}

export function TimeGridView({ days, events, onCreateAt, onSelectEvent }: Props) {
  const today = useMemo(() => new Date(), []);
  const totalSlots = (60 / SLOT_MINUTES) * 24;

  const handleSlotClick = (day: Date, slot: number) => {
    const start = startOfDay(day);
    start.setMinutes(slot * SLOT_MINUTES);
    onCreateAt(start);
  };

  return (
    <div className="time-grid">
      <div
        className="time-grid__header"
        style={{
          gridTemplateColumns: `64px repeat(${days.length}, 1fr)`,
        }}
      >
        <div className="time-grid__corner" />
        {days.map((d) => {
          const isToday = isSameDay(d, today);
          const total = totalHoursOnDay(events, d);
          return (
            <div
              key={d.toISOString()}
              className={`time-grid__day-head${isToday ? " is-today" : ""}`}
            >
              <div className="time-grid__weekday">
                {DAY_LABELS[d.getDay()]}
              </div>
              <div className="time-grid__date">
                {d.getMonth() + 1}/{d.getDate()}
              </div>
              <div className="time-grid__total" title="この日の合計工数">
                合計 {total.toFixed(1)}h
              </div>
            </div>
          );
        })}
      </div>

      <div
        className="time-grid__body"
        style={{
          gridTemplateColumns: `64px repeat(${days.length}, 1fr)`,
        }}
      >
        <div className="time-grid__hours">
          {HOURS.map((h) => (
            <div
              key={h}
              className="time-grid__hour-label"
              style={{ height: HOUR_HEIGHT }}
            >
              {String(h).padStart(2, "0")}:00
            </div>
          ))}
        </div>

        {days.map((day) => {
          const dayEvents = eventsOnDay(events, day);
          const dayStart = startOfDay(day);
          const isToday = isSameDay(day, today);
          return (
            <div
              key={day.toISOString()}
              className={`time-grid__col${isToday ? " is-today" : ""}`}
              style={{ height: HOUR_HEIGHT * 24 }}
            >
              {Array.from({ length: totalSlots }, (_, slot) => (
                <button
                  type="button"
                  key={slot}
                  className={`time-grid__slot${
                    slot % 2 === 0 ? " time-grid__slot--hour" : ""
                  }`}
                  style={{ height: SLOT_HEIGHT }}
                  onClick={() => handleSlotClick(day, slot)}
                  aria-label="この時間帯に予定を追加"
                />
              ))}

              {dayEvents.map((ev) => {
                const evStart = new Date(ev.start);
                const evEnd = new Date(ev.end);
                // クリップ: 1日内に収まる範囲で描画
                const dayEnd = new Date(dayStart);
                dayEnd.setDate(dayEnd.getDate() + 1);
                const renderStart = evStart < dayStart ? dayStart : evStart;
                const renderEnd = evEnd > dayEnd ? dayEnd : evEnd;
                const top = timeToOffset(renderStart);
                const height = durationToHeight(renderStart, renderEnd);
                const hours = getEventHours(ev);
                return (
                  <button
                    type="button"
                    key={ev.id}
                    className="event-block"
                    style={{
                      top,
                      height,
                      backgroundColor: ev.color ?? "#1a73e8",
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectEvent(ev);
                    }}
                  >
                    <div className="event-block__title">{ev.title}</div>
                    <div className="event-block__meta">
                      {evStart.getHours().toString().padStart(2, "0")}:
                      {evStart.getMinutes().toString().padStart(2, "0")} -
                      {" "}
                      {evEnd.getHours().toString().padStart(2, "0")}:
                      {evEnd.getMinutes().toString().padStart(2, "0")}
                      {" "}・ {hours.toFixed(1)}h
                    </div>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
