class QuizSessionsController < ApplicationController
  before_action :set_quiz_session, only: [ :show, :result, :review, :finish, :destroy ]

  def index
    @quiz_sessions = QuizSession.recent.includes(quiz_items: :question).limit(50)
  end

  def new
    @exams = Exam.ordered.includes(:chapters)
    @exam = Exam.find_by(code: params[:exam_code]) || @exams.first
    @selected_chapter_ids = Array(params[:chapter_ids]).map(&:to_i)
    if params[:chapter_code].present?
      chapter = Chapter.find_by(code: params[:chapter_code])
      if chapter
        @exam = chapter.exam
        @selected_chapter_ids = [ chapter.id ]
      end
    end
    @mode = params[:mode].presence_in(QuizSession::MODES.keys) || "chapter"
    @wrong_counts = Stats.wrong_question_counts
  end

  def create
    builder = QuizBuilder.new(
      mode: params[:mode],
      exam: Exam.find_by(id: params[:exam_id]),
      chapter_ids: params[:chapter_ids],
      limit: params[:limit].presence || QuizBuilder::DEFAULT_LIMIT,
      order: params[:order],
      wrong_scope: params[:wrong_scope],
      source_session: QuizSession.find_by(id: params[:source_quiz_session_id])
    )

    session = builder.build!
    redirect_to quiz_session_path(session)
  rescue QuizBuilder::NoQuestionsError => e
    redirect_back fallback_location: new_quiz_session_path, alert: e.message
  end

  # 進行中なら次の未解答問題へ、全問終わっていれば結果画面へ。
  def show
    if (item = @quiz_session.current_item)
      redirect_to quiz_session_quiz_item_path(@quiz_session, item)
    else
      @quiz_session.finish_if_complete!
      redirect_to result_quiz_session_path(@quiz_session)
    end
  end

  def result
    @quiz_session.finish_if_complete!
    @breakdown = @quiz_session.chapter_breakdown
    @items = @quiz_session.quiz_items.includes(question: [ :chapter, :choices ])
    @wrong_items = @items.select { |item| item.answered? && !item.correct }
  end

  # 「間違えた問題だけもう一度」
  def review
    session = QuizBuilder.new(
      mode: "review_session",
      source_session: @quiz_session,
      limit: QuizBuilder::MAX_LIMIT,
      order: params[:order].presence || "sequential"
    ).build!

    redirect_to quiz_session_path(session)
  rescue QuizBuilder::NoQuestionsError
    redirect_to result_quiz_session_path(@quiz_session), notice: "間違えた問題はありません。全問正解です！"
  end

  # 途中で切り上げる（未解答分は集計対象外のまま残る）
  def finish
    @quiz_session.update!(status: "finished", finished_at: Time.current)
    redirect_to result_quiz_session_path(@quiz_session)
  end

  def destroy
    @quiz_session.destroy!
    redirect_to quiz_sessions_path, notice: "セッションを削除しました。"
  end

  private

  def set_quiz_session
    @quiz_session = QuizSession.includes(quiz_items: :question).find(params[:id])
  end
end
