require "test_helper"

class QuizBuilderTest < ActiveSupport::TestCase
  test "章を指定すると、その章の問題だけが出題される" do
    session = QuizBuilder.new(mode: "chapter", chapter_ids: [ chapters(:hardware).id ], limit: 10).build!

    assert_equal 2, session.total_count
    assert session.questions.all? { |q| q.chapter == chapters(:hardware) }
    assert_equal "chapter", session.mode
    assert_equal [ 1, 2 ], session.quiz_items.map(&:position)
  end

  test "出題数の指定で問題数が絞られる" do
    session = QuizBuilder.new(mode: "chapter", chapter_ids: [ chapters(:hardware).id ], limit: 1).build!

    assert_equal 1, session.total_count
  end

  test "試験を指定すると、その試験の章からだけ出題される" do
    session = QuizBuilder.new(mode: "exam", exam: exams(:one), limit: 100).build!

    assert_equal 3, session.total_count
    assert session.questions.all? { |q| q.chapter.exam == exams(:one) }
  end

  test "章が未指定なら試験全体から出題される" do
    session = QuizBuilder.new(mode: "chapter", exam: exams(:two), limit: 100).build!

    assert_equal [ questions(:profile) ], session.questions.to_a
  end

  test "sequential 指定では章コード・問題コード順に並ぶ" do
    session = QuizBuilder.new(mode: "exam", exam: exams(:one), limit: 100, order: "sequential").build!

    codes = session.quiz_items.map { |item| item.question.code }
    assert_equal codes.sort, codes
  end

  test "review_session は元セッションで間違えた問題だけを集める" do
    source = QuizBuilder.new(mode: "chapter", chapter_ids: [ chapters(:hardware).id ], limit: 10).build!
    source.quiz_items.each do |item|
      wrong_choice = item.question.choices.reject(&:correct).first
      correct_ids = item.question.correct_choice_ids
      item.grade!(item.question == questions(:lspci) ? [ wrong_choice.id ] : correct_ids)
    end

    review = QuizBuilder.new(mode: "review_session", source_session: source.reload, limit: 100).build!

    assert_equal [ questions(:lspci) ], review.questions.to_a
    assert_equal source, review.source_quiz_session
  end

  test "review_wrong は直近の解答が不正解の問題を集める" do
    session = QuizBuilder.new(mode: "chapter", chapter_ids: [ chapters(:boot).id ], limit: 10).build!
    session.quiz_items.first.grade!([ choices(:journal_ng).id ])

    review = QuizBuilder.new(mode: "review_wrong", wrong_scope: "last", limit: 100).build!

    assert_equal [ questions(:journal) ], review.questions.to_a
  end

  test "対象の問題が無いときは NoQuestionsError を投げる" do
    assert_raises(QuizBuilder::NoQuestionsError) do
      QuizBuilder.new(mode: "review_wrong", limit: 10).build!
    end
  end

  test "非公開(active=false)の問題は出題されない" do
    questions(:lspci).update!(active: false)

    session = QuizBuilder.new(mode: "chapter", chapter_ids: [ chapters(:hardware).id ], limit: 10).build!

    assert_equal [ questions(:procfs) ], session.questions.to_a
  end
end
