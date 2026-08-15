require "test_helper"

class QuizFlowTest < ActionDispatch::IntegrationTest
  test "章を指定して演習を作成し、解答して結果を見て、間違いだけを復習できる" do
    # 1. 章を指定してセッションを作成
    post quiz_sessions_path, params: {
      mode: "chapter",
      exam_id: exams(:one).id,
      chapter_ids: [ chapters(:hardware).id ],
      limit: 10,
      order: "sequential"
    }
    session = QuizSession.order(:id).last
    assert_redirected_to quiz_session_path(session)
    assert_equal 2, session.total_count

    # 2. セッションを開くと最初の未解答問題へ飛ぶ
    get quiz_session_path(session)
    first_item = session.quiz_items.first
    assert_redirected_to quiz_session_quiz_item_path(session, first_item)

    get quiz_session_quiz_item_path(session, first_item)
    assert_response :success
    assert_select ".question-body"

    # 3. 1問目は間違え、2問目は正解する
    wrong_choice = first_item.question.choices.reject(&:correct).first
    patch quiz_session_quiz_item_path(session, first_item), params: { choice_ids: [ wrong_choice.id ] }
    assert_redirected_to quiz_session_quiz_item_path(session, first_item)

    get quiz_session_quiz_item_path(session, first_item)
    assert_response :success
    assert_select ".verdict-wrong"

    second_item = session.quiz_items.second
    patch quiz_session_quiz_item_path(session, second_item),
          params: { choice_ids: second_item.question.correct_choice_ids }

    # 4. 全問解答したのでセッションは完了になり、正解率は 50%
    session.reload
    assert session.finished?
    assert_in_delta 0.5, session.accuracy, 0.001

    get result_quiz_session_path(session)
    assert_response :success
    assert_select "body", /50\.0%/

    # 5. 間違えた問題だけを復習セッションにする
    post review_quiz_session_path(session)
    review = QuizSession.order(:id).last
    assert_redirected_to quiz_session_path(review)
    assert_equal [ first_item.question ], review.questions.to_a
    assert_equal session, review.source_quiz_session
  end

  test "選択肢を選ばずに送信すると採点されずエラーが表示される" do
    session = QuizBuilder.new(mode: "chapter", chapter_ids: [ chapters(:boot).id ], limit: 1).build!
    item = session.quiz_items.first

    patch quiz_session_quiz_item_path(session, item), params: { choice_ids: [] }

    assert_not item.reload.answered?
    follow_redirect!
    assert_select ".flash-alert"
  end

  test "解答済みの問題に再送信しても結果は変わらない" do
    session = QuizBuilder.new(mode: "chapter", chapter_ids: [ chapters(:boot).id ], limit: 1).build!
    item = session.quiz_items.first
    correct_ids = item.question.correct_choice_ids

    patch quiz_session_quiz_item_path(session, item), params: { choice_ids: correct_ids }
    assert item.reload.correct

    wrong_choice = item.question.choices.reject(&:correct).first
    patch quiz_session_quiz_item_path(session, item), params: { choice_ids: [ wrong_choice.id ] }

    assert item.reload.correct, "二重送信で正解が上書きされない"
  end

  test "条件に合う問題が無い場合はエラーメッセージを出す" do
    post quiz_sessions_path, params: { mode: "review_wrong", wrong_scope: "last", limit: 10 }

    follow_redirect!
    assert_select ".flash-alert"
  end

  test "模擬試験で試験を選ばなかった場合はエラーメッセージを出す" do
    post quiz_sessions_path, params: { mode: "exam", limit: 30 }

    assert_equal 0, QuizSession.count
    follow_redirect!
    assert_select ".flash-alert", /試験を選択してください/
  end

  test "途中で終了してから再開できる" do
    session = QuizBuilder.new(mode: "chapter", chapter_ids: [ chapters(:hardware).id ], limit: 2).build!

    post finish_quiz_session_path(session)
    assert_redirected_to result_quiz_session_path(session)
    assert session.reload.finished?

    get quiz_session_path(session)
    assert_redirected_to quiz_session_quiz_item_path(session, session.quiz_items.first)
  end
end
