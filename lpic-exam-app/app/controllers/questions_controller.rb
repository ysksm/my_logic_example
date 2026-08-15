class QuestionsController < ApplicationController
  # 問題バンクの閲覧（解説つき）。章・キーワード・状態で絞り込める。
  def index
    @exams = Exam.ordered
    @exam = Exam.find_by(code: params[:exam_code])
    @chapter = Chapter.find_by(code: params[:chapter_code])
    @status = params[:status].presence_in(%w[all wrong unattempted]) || "all"
    @keyword = params[:q].to_s.strip

    scope = Question.active.includes(:chapter, :choices)
    scope = scope.where(chapter: @chapter) if @chapter
    scope = scope.where(chapter_id: @exam.chapters.select(:id)) if @exam && @chapter.nil?
    scope = scope.where("questions.body LIKE ?", "%#{@keyword}%") if @keyword.present?
    scope = scope.last_answer_wrong if @status == "wrong"
    scope = scope.unattempted if @status == "unattempted"

    @questions = scope.joins(:chapter).order("chapters.code", "questions.code").limit(200)
    @latest_results = QuizItem.latest_per_question.where(question: @questions).index_by(&:question_id)
  end

  def show
    @question = Question.includes(:chapter, :choices).find(params[:id])
    @history = QuizItem.answered.where(question: @question).order(answered_at: :desc).limit(10)
  end
end
