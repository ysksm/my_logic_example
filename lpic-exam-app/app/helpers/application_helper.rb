module ApplicationHelper
  # 正解率を "83.3%" 形式に。未解答なら "—"。
  def accuracy_text(ratio)
    return "—" if ratio.nil?

    "#{(ratio * 100).round(1)}%"
  end

  # 正解率に応じた色クラス（80%以上=good / 60%以上=warn / 未満=bad）
  def accuracy_level(ratio)
    return "muted" if ratio.nil?
    return "good" if ratio >= 0.8
    return "warn" if ratio >= 0.6

    "bad"
  end

  def accuracy_badge(ratio)
    tag.span accuracy_text(ratio), class: "badge badge-#{accuracy_level(ratio)}"
  end

  def progress_bar(ratio, level: nil)
    percent = ((ratio || 0) * 100).round(1)
    tag.div(class: "bar") do
      tag.div("", class: "bar-fill bar-#{level || accuracy_level(ratio)}", style: "width: #{percent}%")
    end
  end

  def duration_text(seconds)
    return "—" if seconds.nil?

    seconds = seconds.round
    minutes, sec = seconds.divmod(60)
    minutes.positive? ? "#{minutes}分#{sec}秒" : "#{sec}秒"
  end

  def status_label(quiz_session)
    if quiz_session.finished?
      tag.span "完了", class: "badge badge-muted"
    else
      tag.span "進行中", class: "badge badge-info"
    end
  end
end
