require "test_helper"

class PagesTest < ActionDispatch::IntegrationTest
  test "主要な画面が表示できる" do
    [
      root_path,
      exams_path,
      exam_path(exams(:one)),
      chapter_path(chapters(:hardware)),
      questions_path,
      question_path(questions(:lspci)),
      quiz_sessions_path,
      new_quiz_session_path,
      stats_path
    ].each do |path|
      get path
      assert_response :success, "#{path} が表示できません"
    end
  end

  test "問題バンクを章と状態で絞り込める" do
    get questions_path(chapter_code: chapters(:hardware).code)
    assert_response :success
    assert_select "tbody tr", 2

    get questions_path(status: "unattempted")
    assert_response :success
    assert_select "tbody tr", Question.count
  end

  test "問題バンクをキーワードで絞り込める" do
    get questions_path(q: "PCI")
    assert_response :success
    assert_select "tbody tr", 1
  end

  test "解答後は直近の正誤がダッシュボードと成績に反映される" do
    session = QuizBuilder.new(mode: "chapter", chapter_ids: [ chapters(:boot).id ], limit: 1).build!
    item = session.quiz_items.first
    item.grade!([ choices(:journal_ng).id ])

    get root_path
    assert_response :success
    assert_select "body", /0\.0%/

    get stats_path(exam_code: exams(:one).code)
    assert_response :success
  end

  test "存在しない章コードは 404 になる" do
    get "/chapters/999.9"
    assert_response :not_found
  end
end
