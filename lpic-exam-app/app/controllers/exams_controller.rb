class ExamsController < ApplicationController
  def index
    @exams = Exam.ordered
    @exam_rows = Stats.by_exam
  end

  def show
    @exam = Exam.find_by!(code: params[:code])
    @chapter_rows = Stats.by_chapter(exam: @exam)
    @topics = @chapter_rows.group_by { |row| row[:chapter].topic_code }
  end
end
