class StatsController < ApplicationController
  def show
    @exam = Exam.find_by(code: params[:exam_code])
    @overall = Stats.overall
    @exam_rows = Stats.by_exam
    @chapter_rows = Stats.by_chapter(exam: @exam)
    @weak_chapters = Stats.weak_chapters(limit: 8, exam: @exam)
    @daily = Stats.daily(days: 14)
    @exams = Exam.ordered
  end
end
