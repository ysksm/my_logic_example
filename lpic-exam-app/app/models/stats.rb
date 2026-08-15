# 解答履歴（QuizItem）から正解率などの集計値を取り出すクエリオブジェクト。
module Stats
  module_function

  # 全体の解答数・正解数・正解率
  def overall
    answered = QuizItem.answered
    total = answered.count
    correct = answered.where(correct: true).count

    {
      answered: total,
      correct: correct,
      wrong: total - correct,
      accuracy: total.zero? ? nil : correct.to_f / total
    }
  end

  # 章ごとの成績。1問あたり「最新の解答」ベースの正解率も返す。
  def by_chapter(exam: nil)
    chapters = Chapter.ordered.includes(:exam)
    chapters = chapters.where(exam: exam) if exam

    question_counts = Question.active.group(:chapter_id).count
    totals = counts_for(QuizItem.answered)
    corrects = counts_for(QuizItem.answered.where(correct: true))
    latest_totals = counts_for(QuizItem.latest_per_question)
    latest_corrects = counts_for(QuizItem.latest_per_question.where(correct: true))

    chapters.map do |chapter|
      answered = totals[chapter.id].to_i
      correct = corrects[chapter.id].to_i
      latest_answered = latest_totals[chapter.id].to_i
      latest_correct = latest_corrects[chapter.id].to_i

      {
        chapter: chapter,
        question_count: question_counts[chapter.id].to_i,
        attempted_questions: latest_answered,
        answered: answered,
        correct: correct,
        accuracy: answered.zero? ? nil : correct.to_f / answered,
        latest_accuracy: latest_answered.zero? ? nil : latest_correct.to_f / latest_answered
      }
    end
  end

  def by_exam
    Exam.ordered.map do |exam|
      rows = by_chapter(exam: exam)
      answered = rows.sum { |r| r[:answered] }
      correct = rows.sum { |r| r[:correct] }

      {
        exam: exam,
        question_count: rows.sum { |r| r[:question_count] },
        attempted_questions: rows.sum { |r| r[:attempted_questions] },
        answered: answered,
        correct: correct,
        accuracy: answered.zero? ? nil : correct.to_f / answered
      }
    end
  end

  # 正解率の低い順に並べた「苦手な章」（最低 min_answers 回解答したものだけ）
  def weak_chapters(limit: 5, min_answers: 3, exam: nil)
    by_chapter(exam: exam)
      .select { |row| row[:answered] >= min_answers && row[:accuracy] }
      .sort_by { |row| row[:accuracy] }
      .first(limit)
  end

  # 直近の解答が不正解の問題数（＝復習キューの長さ）
  def wrong_question_counts
    {
      last: Question.active.last_answer_wrong.count,
      ever: Question.active.ever_wrong.count,
      unattempted: Question.active.unattempted.count
    }
  end

  # 日別の解答数と正解率（学習ペースの可視化用）
  def daily(days: 14)
    since = days.days.ago.beginning_of_day
    rows = QuizItem.answered.where(answered_at: since..)
                   .group("date(quiz_items.answered_at)")
                   .pluck(Arel.sql("date(quiz_items.answered_at)"),
                          Arel.sql("COUNT(*)"),
                          Arel.sql("SUM(CASE WHEN correct THEN 1 ELSE 0 END)"))

    rows.map do |date, count, correct|
      { date: date.to_s, answered: count, correct: correct.to_i,
        accuracy: count.zero? ? nil : correct.to_i.to_f / count }
    end.sort_by { |row| row[:date] }
  end

  def counts_for(relation)
    relation.joins(:question).group("questions.chapter_id").count
  end
end
