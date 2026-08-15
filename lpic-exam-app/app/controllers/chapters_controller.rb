class ChaptersController < ApplicationController
  def show
    @chapter = Chapter.includes(:exam).find_by!(code: params[:code])
    @exam = @chapter.exam
    @stats = Stats.by_chapter(exam: @exam).detect { |row| row[:chapter].id == @chapter.id }
    @questions = @chapter.questions.active.includes(:choices)
    @latest_results = QuizItem.latest_per_question.where(question: @questions)
                              .index_by(&:question_id)
  end
end
