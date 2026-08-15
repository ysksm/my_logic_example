class QuizItem < ApplicationRecord
  belongs_to :quiz_session, inverse_of: :quiz_items
  belongs_to :question

  validates :position, presence: true, uniqueness: { scope: :quiz_session_id }

  scope :ordered, -> { order(:position) }
  scope :answered, -> { where.not(answered_at: nil) }
  scope :unanswered, -> { where(answered_at: nil) }
  scope :wrong, -> { answered.where(correct: false) }
  scope :right, -> { answered.where(correct: true) }

  # 問題ごとに「最後に解答した1件」だけを残す。
  # id は時系列で単調増加するため MAX(id) が最新解答になる。
  scope :latest_per_question, lambda {
    where(id: answered.group(:question_id).select("MAX(quiz_items.id)"))
  }

  def answered?
    answered_at.present?
  end

  # 解答を採点して保存する。すでに解答済みなら何もしない（二重送信対策）。
  def grade!(choice_ids)
    return false if answered?

    ids = Array(choice_ids).reject(&:blank?).map(&:to_i).uniq
    return false if ids.empty?

    update!(
      selected_choice_ids: ids,
      correct: question.correct?(ids),
      answered_at: Time.current
    )
  end

  def selected?(choice)
    selected_choice_ids.map(&:to_i).include?(choice.id)
  end
end
