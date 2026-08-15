require "test_helper"
require "tmpdir"

class SeedLoaderTest < ActiveSupport::TestCase
  setup do
    @dir = Pathname.new(Dir.mktmpdir)
    FileUtils.mkdir_p(@dir.join("questions"))
    write_exams
  end

  teardown do
    FileUtils.remove_entry(@dir)
  end

  test "YAML から試験・章・問題・選択肢を投入する" do
    write_questions(choices: [ [ "lspci", true ], [ "lsusb", false ] ])
    load_seeds

    question = Question.find_by!(code: "T101.1-01")

    assert_equal "T-101", question.chapter.exam.code
    assert_equal "T101.1", question.chapter.code
    assert_equal %w[lspci lsusb], question.choices.map(&:body)
    assert_equal [ 1, 2 ], question.choices.map(&:position)
    assert_equal [ true, false ], question.choices.map(&:correct)
  end

  test "再実行しても Choice の id が変わらず、過去の解答の記録が壊れない" do
    write_questions(choices: [ [ "lspci", true ], [ "lsusb", false ] ])
    load_seeds

    question = Question.find_by!(code: "T101.1-01")
    original_ids = question.choices.map(&:id)
    item = answer!(question, [ question.choices.first.id ])

    # 選択肢の文言を修正して再投入する
    write_questions(choices: [ [ "lspci コマンド", true ], [ "lsusb", false ] ])
    load_seeds

    question.reload
    assert_equal original_ids, question.choices.map(&:id), "Choice の id が維持される"
    assert_equal "lspci コマンド", question.choices.first.body, "文言の修正は反映される"

    item.reload
    assert item.selected?(question.choices.first), "過去の解答が「あなたの解答」として残る"
    assert item.correct
  end

  test "再実行しても Question と Chapter の id が変わらない" do
    write_questions(choices: [ [ "lspci", true ], [ "lsusb", false ] ])
    load_seeds
    question = Question.find_by!(code: "T101.1-01")
    ids = [ question.id, question.chapter.id, question.chapter.exam.id ]

    write_questions(choices: [ [ "lspci", true ], [ "lsusb", false ] ], body: "書き換えた問題文")
    load_seeds

    question.reload
    assert_equal ids, [ question.id, question.chapter.id, question.chapter.exam.id ]
    assert_equal "書き換えた問題文", question.body
  end

  test "選択肢を減らすと余った分だけが削除される" do
    write_questions(choices: [ [ "a", true ], [ "b", false ], [ "c", false ] ])
    load_seeds
    question = Question.find_by!(code: "T101.1-01")
    kept_ids = question.choices.first(2).map(&:id)

    write_questions(choices: [ [ "a", true ], [ "b", false ] ])
    load_seeds

    question.reload
    assert_equal 2, question.choices.size
    assert_equal kept_ids, question.choices.map(&:id)
  end

  test "選択肢を増やすと追加される" do
    write_questions(choices: [ [ "a", true ], [ "b", false ] ])
    load_seeds
    question = Question.find_by!(code: "T101.1-01")
    kept_ids = question.choices.map(&:id)

    write_questions(choices: [ [ "a", true ], [ "b", false ], [ "c", false ] ])
    load_seeds

    question.reload
    assert_equal %w[a b c], question.choices.map(&:body)
    assert_equal kept_ids, question.choices.first(2).map(&:id)
  end

  test "正解の選択肢が無い問題があるとエラーになる" do
    write_questions(choices: [ [ "a", false ], [ "b", false ] ])

    error = assert_raises(SeedLoader::InvalidSeedError) { load_seeds }
    assert_match "T101.1-01", error.message
  end

  private

  def load_seeds
    SeedLoader.call(dir: @dir, io: nil)
  end

  def write_exams
    File.write(@dir.join("exams.yml"), {
      "exams" => [ { "code" => "T-101", "name" => "テスト試験", "position" => 1 } ]
    }.to_yaml)
  end

  def write_questions(choices:, body: "PCI デバイスを一覧表示するコマンドはどれか。")
    data = {
      "exam_code" => "T-101",
      "chapters" => [
        {
          "code" => "T101.1",
          "name" => "ハードウェア",
          "position" => 1,
          "questions" => [
            {
              "code" => "T101.1-01",
              "body" => body,
              "kind" => "single",
              "difficulty" => 1,
              "explanation" => "lspci を使う。",
              "choices" => choices.map { |text, correct| { "body" => text, "correct" => correct } }
            }
          ]
        }
      ]
    }
    File.write(@dir.join("questions/t101.yml"), data.to_yaml)
  end

  def answer!(question, choice_ids)
    session = QuizSession.create!(title: "テスト", mode: "chapter", started_at: Time.current)
    item = session.quiz_items.create!(question: question, position: 1)
    item.grade!(choice_ids)
    item
  end
end
