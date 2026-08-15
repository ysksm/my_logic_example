class Question < ApplicationRecord
  KINDS = %w[single multiple].freeze
  DIFFICULTY_LABELS = { 1 => "易", 2 => "普通", 3 => "難" }.freeze

  belongs_to :chapter, inverse_of: :questions
  has_one :exam, through: :chapter
  has_many :choices, -> { ordered }, dependent: :destroy, inverse_of: :question
  has_many :quiz_items, dependent: :destroy

  validates :code, presence: true, uniqueness: true
  validates :body, presence: true
  validates :kind, inclusion: { in: KINDS }
  validates :difficulty, inclusion: { in: DIFFICULTY_LABELS.keys }

  scope :active, -> { where(active: true) }
  scope :in_chapters, ->(chapter_ids) { where(chapter_id: chapter_ids) }

  # 一度でも解答したことがある問題
  scope :attempted, -> { where(id: QuizItem.answered.select(:question_id)) }
  # 一度も解答したことがない問題
  scope :unattempted, -> { where.not(id: QuizItem.answered.select(:question_id)) }
  # 一度でも間違えたことがある問題
  scope :ever_wrong, -> { where(id: QuizItem.answered.where(correct: false).select(:question_id)) }
  # 直近の解答が不正解だった問題（＝いま現在の苦手問題）
  scope :last_answer_wrong, lambda {
    where(id: QuizItem.latest_per_question.where(correct: false).select(:question_id))
  }

  def multiple?
    kind == "multiple"
  end

  def correct_choice_ids
    choices.select(&:correct).map(&:id).sort
  end

  def correct?(selected_choice_ids)
    Array(selected_choice_ids).map(&:to_i).uniq.sort == correct_choice_ids
  end

  def difficulty_label
    DIFFICULTY_LABELS.fetch(difficulty, "普通")
  end
end
