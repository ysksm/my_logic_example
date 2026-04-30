import { useEffect, useMemo, useState } from "react";
import type { CalendarEvent } from "../types";
import { EVENT_COLORS } from "../types";
import {
  formatDateInput,
  formatTimeInput,
  parseDateTime,
} from "../utils/dateUtils";

interface Props {
  /** 編集対象のイベント。新規時は undefined */
  event?: CalendarEvent;
  /** 新規作成時の初期開始時刻 */
  initialStart?: Date;
  onClose: () => void;
  onSave: (event: CalendarEvent) => void;
  onDelete?: (id: string) => void;
}

interface FormState {
  title: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  workHours: string;
  autoCalcHours: boolean;
  color: string;
  description: string;
}

function buildInitialState(
  event: CalendarEvent | undefined,
  initialStart: Date | undefined
): FormState {
  if (event) {
    const s = new Date(event.start);
    const e = new Date(event.end);
    const autoHours =
      typeof event.workHours !== "number" ||
      Math.abs(
        event.workHours - (e.getTime() - s.getTime()) / 3600000
      ) < 0.01;
    return {
      title: event.title,
      startDate: formatDateInput(s),
      startTime: formatTimeInput(s),
      endDate: formatDateInput(e),
      endTime: formatTimeInput(e),
      workHours:
        typeof event.workHours === "number"
          ? event.workHours.toString()
          : ((e.getTime() - s.getTime()) / 3600000).toFixed(2),
      autoCalcHours: autoHours,
      color: event.color ?? EVENT_COLORS[0].value,
      description: event.description ?? "",
    };
  }
  const start = initialStart ?? new Date();
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return {
    title: "",
    startDate: formatDateInput(start),
    startTime: formatTimeInput(start),
    endDate: formatDateInput(end),
    endTime: formatTimeInput(end),
    workHours: "1",
    autoCalcHours: true,
    color: EVENT_COLORS[0].value,
    description: "",
  };
}

export function EventModal({
  event,
  initialStart,
  onClose,
  onSave,
  onDelete,
}: Props) {
  const [form, setForm] = useState<FormState>(() =>
    buildInitialState(event, initialStart)
  );

  useEffect(() => {
    setForm(buildInitialState(event, initialStart));
  }, [event, initialStart]);

  const computedHours = useMemo(() => {
    try {
      const s = parseDateTime(form.startDate, form.startTime);
      const e = parseDateTime(form.endDate, form.endTime);
      const diff = (e.getTime() - s.getTime()) / 3600000;
      return diff;
    } catch {
      return 0;
    }
  }, [form.startDate, form.startTime, form.endDate, form.endTime]);

  useEffect(() => {
    if (form.autoCalcHours) {
      setForm((prev) => ({
        ...prev,
        workHours: Number.isFinite(computedHours)
          ? Math.max(0, computedHours).toFixed(2)
          : "0",
      }));
    }
  }, [computedHours, form.autoCalcHours]);

  const updateField = <K extends keyof FormState>(
    key: K,
    value: FormState[K]
  ) => setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    const start = parseDateTime(form.startDate, form.startTime);
    const end = parseDateTime(form.endDate, form.endTime);
    if (end.getTime() <= start.getTime()) {
      alert("終了時刻は開始時刻より後にしてください");
      return;
    }
    const wh = Number(form.workHours);
    onSave({
      id: event?.id ?? "",
      title: form.title.trim(),
      start: start.toISOString(),
      end: end.toISOString(),
      workHours: Number.isFinite(wh) ? wh : undefined,
      color: form.color,
      description: form.description.trim() || undefined,
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal__head">
          <h2>{event ? "予定の編集" : "予定の追加"}</h2>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="閉じる"
          >
            ✕
          </button>
        </div>
        <form className="modal__body" onSubmit={handleSubmit}>
          <label className="field">
            <span>タイトル</span>
            <input
              type="text"
              value={form.title}
              onChange={(e) => updateField("title", e.target.value)}
              placeholder="例: 設計レビュー"
              autoFocus
              required
            />
          </label>

          <div className="field-row">
            <label className="field">
              <span>開始</span>
              <div className="dt-row">
                <input
                  type="date"
                  value={form.startDate}
                  onChange={(e) => updateField("startDate", e.target.value)}
                  required
                />
                <input
                  type="time"
                  value={form.startTime}
                  onChange={(e) => updateField("startTime", e.target.value)}
                  step={60 * 15}
                  required
                />
              </div>
            </label>
            <label className="field">
              <span>終了</span>
              <div className="dt-row">
                <input
                  type="date"
                  value={form.endDate}
                  onChange={(e) => updateField("endDate", e.target.value)}
                  required
                />
                <input
                  type="time"
                  value={form.endTime}
                  onChange={(e) => updateField("endTime", e.target.value)}
                  step={60 * 15}
                  required
                />
              </div>
            </label>
          </div>

          <div className="field-row">
            <label className="field">
              <span>
                工数 (h)
                <small className="hint">
                  {form.autoCalcHours
                    ? "(自動計算中)"
                    : "(手動入力)"}
                </small>
              </span>
              <div className="dt-row">
                <input
                  type="number"
                  min={0}
                  step={0.25}
                  value={form.workHours}
                  onChange={(e) => updateField("workHours", e.target.value)}
                  disabled={form.autoCalcHours}
                />
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={form.autoCalcHours}
                    onChange={(e) =>
                      updateField("autoCalcHours", e.target.checked)
                    }
                  />
                  <span>時間から自動計算</span>
                </label>
              </div>
            </label>
            <label className="field">
              <span>色</span>
              <div className="color-row">
                {EVENT_COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    className={`color-swatch${
                      form.color === c.value ? " is-active" : ""
                    }`}
                    style={{ backgroundColor: c.value }}
                    onClick={() => updateField("color", c.value)}
                    aria-label={c.label}
                    title={c.label}
                  />
                ))}
              </div>
            </label>
          </div>

          <label className="field">
            <span>メモ</span>
            <textarea
              value={form.description}
              onChange={(e) => updateField("description", e.target.value)}
              rows={3}
              placeholder="補足説明があれば入力"
            />
          </label>

          <div className="modal__actions">
            {event && onDelete && (
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  if (confirm("この予定を削除しますか？")) {
                    onDelete(event.id);
                  }
                }}
              >
                削除
              </button>
            )}
            <div className="spacer" />
            <button type="button" className="btn" onClick={onClose}>
              キャンセル
            </button>
            <button type="submit" className="btn btn-primary">
              保存
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
