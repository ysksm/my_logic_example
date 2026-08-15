# 出題条件から QuizSession と QuizItem を組み立てるファクトリ。
#
# mode ごとに「対象となる問題の集合」を決め、順序（ランダム / 章順）と
# 出題数を適用して QuizItem を作る。
class QuizBuilder
  DEFAULT_LIMIT = 10
  MAX_LIMIT = 200
  ORDERS = %w[random sequential].freeze

  class Error < StandardError; end
  class NoQuestionsError < Error; end
  class MissingExamError < Error; end

  attr_reader :mode, :exam, :chapter_ids, :limit, :order, :source_session, :wrong_scope

  def initialize(mode:, exam: nil, chapter_ids: [], limit: DEFAULT_LIMIT, order: "random",
                 source_session: nil, wrong_scope: "last")
    @mode = mode.presence_in(QuizSession::MODES.keys) || "chapter"
    @exam = exam
    @chapter_ids = Array(chapter_ids).reject(&:blank?).map(&:to_i)
    @limit = limit.to_i.clamp(1, MAX_LIMIT)
    @order = order.presence_in(ORDERS) || "random"
    @source_session = source_session
    @wrong_scope = wrong_scope.presence_in(%w[last ever]) || "last"
  end

  def build!
    # 模擬試験は「1つの試験を通しで解く」ためのモードなので、
    # 試験が未指定のまま全試験を混ぜて出題することはしない。
    raise MissingExamError, "模擬試験では試験を選択してください" if mode == "exam" && exam.nil?

    questions = pick_questions
    raise NoQuestionsError, "条件に合う問題がありません" if questions.empty?

    QuizSession.transaction do
      session = QuizSession.create!(
        title: title,
        mode: mode,
        status: "in_progress",
        started_at: Time.current,
        source_quiz_session: source_session,
        filters: {
          "exam_id" => exam&.id,
          "chapter_ids" => chapter_ids,
          "limit" => limit,
          "order" => order,
          "wrong_scope" => wrong_scope
        }
      )

      questions.each_with_index do |question, index|
        session.quiz_items.create!(question: question, position: index + 1)
      end

      session
    end
  end

  private

  def pick_questions
    scope = base_scope.includes(:chapter)
    ordered = order == "random" ? scope.to_a.shuffle : scope.to_a.sort_by { |q| [ q.chapter.code, q.code ] }
    ordered.first(limit)
  end

  def base_scope
    case mode
    when "chapter"
      Question.active.in_chapters(effective_chapter_ids)
    when "exam"
      Question.active.in_chapters(exam_chapter_ids)
    when "review_wrong"
      scope = wrong_scope == "ever" ? Question.active.ever_wrong : Question.active.last_answer_wrong
      narrow(scope)
    when "review_session"
      ids = source_session ? source_session.quiz_items.wrong.pluck(:question_id) : []
      Question.active.where(id: ids)
    when "unattempted"
      narrow(Question.active.unattempted)
    else
      Question.active.none
    end
  end

  # 章が選ばれていればその章に、なければ試験全体に絞る。
  def narrow(scope)
    if chapter_ids.any?
      scope.in_chapters(chapter_ids)
    elsif exam
      scope.in_chapters(exam_chapter_ids)
    else
      scope
    end
  end

  def effective_chapter_ids
    chapter_ids.any? ? chapter_ids : exam_chapter_ids
  end

  def exam_chapter_ids
    exam ? exam.chapters.pluck(:id) : Chapter.pluck(:id)
  end

  def title
    case mode
    when "chapter"
      chapters = Chapter.where(id: effective_chapter_ids).ordered
      names = chapters.limit(2).map(&:code).join(", ")
      suffix = chapters.size > 2 ? " ほか#{chapters.size - 2}章" : ""
      "章別演習 #{names}#{suffix}"
    when "exam"
      "模擬試験 #{exam&.name}"
    when "review_wrong"
      label = wrong_scope == "ever" ? "一度でも間違えた問題" : "直近で間違えた問題"
      "復習 #{label}"
    when "review_session"
      "復習 ##{source_session&.id} の間違い#{source_session ? "（#{source_session.title}）" : ""}"
    when "unattempted"
      "未挑戦の問題#{exam ? "（#{exam.name}）" : ""}"
    else
      "演習"
    end
  end
end
