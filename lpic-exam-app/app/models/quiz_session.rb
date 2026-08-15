class QuizSession < ApplicationRecord
  MODES = {
    "chapter" => "章別演習",
    "exam" => "模擬試験",
    "review_wrong" => "苦手問題の復習",
    "review_session" => "セッションの復習",
    "unattempted" => "未挑戦の問題"
  }.freeze

  STATUSES = %w[in_progress finished].freeze

  belongs_to :source_quiz_session, class_name: "QuizSession", optional: true
  has_many :derived_quiz_sessions, class_name: "QuizSession",
           foreign_key: :source_quiz_session_id, dependent: :nullify, inverse_of: :source_quiz_session
  has_many :quiz_items, -> { ordered }, dependent: :destroy, inverse_of: :quiz_session
  has_many :questions, through: :quiz_items

  validates :title, presence: true
  validates :mode, inclusion: { in: MODES.keys }
  validates :status, inclusion: { in: STATUSES }

  scope :recent, -> { order(created_at: :desc) }
  scope :finished, -> { where(status: "finished") }
  scope :in_progress, -> { where(status: "in_progress") }

  def mode_label
    MODES.fetch(mode, mode)
  end

  def finished?
    status == "finished"
  end

  def total_count
    quiz_items.size
  end

  def answered_count
    quiz_items.count(&:answered?)
  end

  def correct_count
    quiz_items.count { |item| item.correct }
  end

  def wrong_count
    quiz_items.count { |item| item.answered? && !item.correct }
  end

  def accuracy
    return nil if answered_count.zero?

    correct_count.to_f / answered_count
  end

  def progress_ratio
    return 0.0 if total_count.zero?

    answered_count.to_f / total_count
  end

  def current_item
    quiz_items.detect { |item| !item.answered? }
  end

  def duration
    return nil unless started_at && finished_at

    finished_at - started_at
  end

  # 全問解答済みになったら自動的に終了扱いにする。
  def finish_if_complete!
    return false unless current_item.nil?
    return false if finished?

    update!(status: "finished", finished_at: Time.current)
  end

  def wrong_questions
    quiz_items.select { |item| item.answered? && !item.correct }.map(&:question)
  end

  # 章ごとの成績（結果画面の内訳表示用）
  def chapter_breakdown
    quiz_items.includes(question: :chapter).group_by { |item| item.question.chapter }
              .map do |chapter, items|
                answered = items.select(&:answered?)
                {
                  chapter: chapter,
                  total: items.size,
                  answered: answered.size,
                  correct: answered.count(&:correct),
                  accuracy: answered.empty? ? nil : answered.count(&:correct).to_f / answered.size
                }
              end
              .sort_by { |row| row[:chapter].code }
  end
end
