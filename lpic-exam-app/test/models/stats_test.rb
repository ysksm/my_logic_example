require "test_helper"

class StatsTest < ActiveSupport::TestCase
  test "解答が無いときは正解率が nil になる" do
    assert_nil Stats.overall[:accuracy]
    assert_equal 0, Stats.overall[:answered]
  end

  test "overall は解答数・正解数・正解率を集計する" do
    answer!(questions(:lspci), correct: true)
    answer!(questions(:journal), correct: false)

    overall = Stats.overall

    assert_equal 2, overall[:answered]
    assert_equal 1, overall[:correct]
    assert_equal 1, overall[:wrong]
    assert_in_delta 0.5, overall[:accuracy], 0.001
  end

  test "by_chapter は章ごとの問題数と正解率を返す" do
    answer!(questions(:lspci), correct: true)
    answer!(questions(:procfs), correct: false)

    row = Stats.by_chapter(exam: exams(:one)).detect { |r| r[:chapter] == chapters(:hardware) }

    assert_equal 2, row[:question_count]
    assert_equal 2, row[:answered]
    assert_equal 1, row[:correct]
    assert_in_delta 0.5, row[:accuracy], 0.001
  end

  test "latest_accuracy は問題ごとの最新解答だけで計算される" do
    answer!(questions(:lspci), correct: false)
    answer!(questions(:lspci), correct: true)

    row = Stats.by_chapter(exam: exams(:one)).detect { |r| r[:chapter] == chapters(:hardware) }

    assert_equal 2, row[:answered], "通算では2回解答している"
    assert_in_delta 0.5, row[:accuracy], 0.001
    assert_equal 1, row[:attempted_questions]
    assert_in_delta 1.0, row[:latest_accuracy], 0.001, "最新解答ベースでは正解率100%"
  end

  test "wrong_question_counts は復習対象の件数を返す" do
    answer!(questions(:lspci), correct: false)
    answer!(questions(:journal), correct: false)
    answer!(questions(:journal), correct: true)

    counts = Stats.wrong_question_counts

    assert_equal 1, counts[:last]
    assert_equal 2, counts[:ever]
    assert_equal Question.count - 2, counts[:unattempted]
  end

  test "weak_chapters は解答数のしきい値を満たす章だけを正解率の低い順に返す" do
    3.times { answer!(questions(:lspci), correct: false) }
    answer!(questions(:profile), correct: false)

    weak = Stats.weak_chapters(limit: 5, min_answers: 3)

    assert_equal [ chapters(:hardware) ], weak.map { |row| row[:chapter] }
  end

  private

  def answer!(question, correct:)
    session = QuizSession.create!(title: "テスト", mode: "chapter", started_at: Time.current)
    item = session.quiz_items.create!(question: question, position: 1)
    ids = correct ? question.correct_choice_ids : question.choices.reject(&:correct).map(&:id).first(1)
    item.grade!(ids)
  end
end
