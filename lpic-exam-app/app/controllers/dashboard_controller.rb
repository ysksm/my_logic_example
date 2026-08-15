class DashboardController < ApplicationController
  def show
    @overall = Stats.overall
    @exam_rows = Stats.by_exam
    @weak_chapters = Stats.weak_chapters(limit: 5)
    @wrong_counts = Stats.wrong_question_counts
    @in_progress = QuizSession.in_progress.recent.limit(3)
    @recent_sessions = QuizSession.finished.recent.limit(5)
    @exams = Exam.ordered
  end
end
