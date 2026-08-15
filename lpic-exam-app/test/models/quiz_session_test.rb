require "test_helper"

class QuizSessionTest < ActiveSupport::TestCase
  setup do
    @session = QuizSession.create!(title: "テスト", mode: "chapter", started_at: Time.current)
    @item1 = @session.quiz_items.create!(question: questions(:lspci), position: 1)
    @item2 = @session.quiz_items.create!(question: questions(:journal), position: 2)
  end

  test "未解答のうちは正解率が nil で、解答が進むと集計される" do
    assert_nil @session.accuracy
    assert_equal 0.0, @session.progress_ratio

    @item1.grade!([ choices(:lspci_ok).id ])
    @session.reload

    assert_equal 1.0, @session.accuracy
    assert_in_delta 0.5, @session.progress_ratio, 0.001
  end

  test "正解率は解答済みの問題だけを分母にする" do
    @item1.grade!([ choices(:lspci_ok).id ])
    @item2.grade!([ choices(:journal_ng).id ])
    @session.reload

    assert_equal 2, @session.answered_count
    assert_equal 1, @session.correct_count
    assert_equal 1, @session.wrong_count
    assert_in_delta 0.5, @session.accuracy, 0.001
  end

  test "current_item は最初の未解答問題を返す" do
    assert_equal @item1, @session.current_item

    @item1.grade!([ choices(:lspci_ok).id ])

    assert_equal @item2, @session.reload.current_item
  end

  test "全問解答すると finish_if_complete! で完了になる" do
    assert_not @session.finish_if_complete!

    @item1.grade!([ choices(:lspci_ok).id ])
    @item2.grade!([ choices(:journal_ok).id ])
    @session.reload

    assert @session.finish_if_complete!
    assert @session.finished?
    assert_not_nil @session.finished_at
  end

  test "解答済みの問題は再採点されない" do
    @item1.grade!([ choices(:lspci_ok).id ])
    answered_at = @item1.answered_at

    assert_not @item1.grade!([ choices(:lspci_ng).id ])
    assert @item1.reload.correct
    assert_equal answered_at.to_i, @item1.answered_at.to_i
  end

  test "選択肢が空の解答は採点されない" do
    assert_not @item1.grade!([])
    assert_not @item1.answered?
  end

  test "wrong_questions は間違えた問題だけを返す" do
    @item1.grade!([ choices(:lspci_ng).id ])
    @item2.grade!([ choices(:journal_ok).id ])

    assert_equal [ questions(:lspci) ], @session.reload.wrong_questions
  end
end
