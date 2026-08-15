class QuizItemsController < ApplicationController
  before_action :set_item

  # 未解答なら解答フォーム、解答済みなら正誤＋解説を表示する。
  def show
  end

  # 解答を採点する。採点後は同じ画面に戻り、フィードバックを表示する。
  def update
    if @item.grade!(params[:choice_ids])
      @quiz_session.finish_if_complete!
      redirect_to quiz_session_quiz_item_path(@quiz_session, @item)
    else
      redirect_to quiz_session_quiz_item_path(@quiz_session, @item),
                  alert: @item.answered? ? nil : "選択肢を選んでください。"
    end
  end

  private

  def set_item
    @quiz_session = QuizSession.includes(quiz_items: :question).find(params[:quiz_session_id])
    @item = @quiz_session.quiz_items.find(params[:id])
    @question = @item.question
    @next_item = @quiz_session.quiz_items.detect { |i| i.position > @item.position && !i.answered? } ||
                 @quiz_session.current_item
  end
end
