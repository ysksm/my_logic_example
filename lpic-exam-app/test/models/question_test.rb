require "test_helper"

class QuestionTest < ActiveSupport::TestCase
  test "単一選択問題は正解の選択肢だけを選んだときに正解となる" do
    question = questions(:lspci)

    assert question.correct?([ choices(:lspci_ok).id ])
    assert_not question.correct?([ choices(:lspci_ng).id ])
  end

  test "複数選択問題は正解の選択肢を過不足なく選んだときだけ正解となる" do
    question = questions(:procfs)
    proc_id = choices(:procfs_proc).id
    sys_id = choices(:procfs_sys).id
    dev_id = choices(:procfs_dev).id

    assert question.correct?([ proc_id, sys_id ])
    assert question.correct?([ sys_id, proc_id ]), "選択の順序は結果に影響しない"
    assert_not question.correct?([ proc_id ]), "足りない場合は不正解"
    assert_not question.correct?([ proc_id, sys_id, dev_id ]), "余分に選んだ場合は不正解"
  end

  test "文字列で渡された選択肢 ID も採点できる" do
    question = questions(:lspci)

    assert question.correct?([ choices(:lspci_ok).id.to_s ])
  end

  test "unattempted は一度も解答していない問題を返す" do
    assert_equal Question.count, Question.unattempted.count

    answer!(questions(:lspci), correct: true)

    assert_not_includes Question.unattempted, questions(:lspci)
    assert_includes Question.attempted, questions(:lspci)
  end

  test "last_answer_wrong は最後の解答が不正解の問題だけを返す" do
    answer!(questions(:lspci), correct: false)
    answer!(questions(:journal), correct: false)
    answer!(questions(:journal), correct: true) # 2回目で正解したので苦手から外れる

    assert_includes Question.last_answer_wrong, questions(:lspci)
    assert_not_includes Question.last_answer_wrong, questions(:journal)
  end

  test "ever_wrong は一度でも間違えた問題を返す" do
    answer!(questions(:journal), correct: false)
    answer!(questions(:journal), correct: true)

    assert_includes Question.ever_wrong, questions(:journal)
    assert_not_includes Question.ever_wrong, questions(:lspci)
  end

  private

  def answer!(question, correct:)
    session = QuizSession.create!(title: "テスト", mode: "chapter", started_at: Time.current)
    item = session.quiz_items.create!(question: question, position: 1)
    choice_ids = correct ? question.correct_choice_ids : question.choices.reject(&:correct).map(&:id).first(1)
    item.grade!(choice_ids)
    item
  end
end
