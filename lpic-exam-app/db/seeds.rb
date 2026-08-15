# 問題データの投入。
#
#   bin/rails db:seed
#
# db/seeds/exams.yml と db/seeds/questions/*.yml を読み込む。
# code をキーにした upsert なので、何度実行しても解答履歴は壊れない。
require "yaml"

SEED_DIR = Rails.root.join("db/seeds")

def load_yaml(path)
  YAML.safe_load_file(path, permitted_classes: [], aliases: true)
end

exams = load_yaml(SEED_DIR.join("exams.yml")).fetch("exams")
exams.each do |attrs|
  exam = Exam.find_or_initialize_by(code: attrs.fetch("code"))
  exam.update!(attrs.slice("name", "description", "position"))
end
puts "exams: #{Exam.count}"

Dir[SEED_DIR.join("questions/*.yml")].sort.each do |path|
  data = load_yaml(path)
  exam = Exam.find_by!(code: data.fetch("exam_code"))

  data.fetch("chapters").each do |chapter_attrs|
    chapter = Chapter.find_or_initialize_by(code: chapter_attrs.fetch("code"))
    chapter.exam = exam
    chapter.assign_attributes(chapter_attrs.slice("name", "description", "position"))
    chapter.save!

    Array(chapter_attrs["questions"]).each do |question_attrs|
      question = Question.find_or_initialize_by(code: question_attrs.fetch("code"))
      question.chapter = chapter
      question.assign_attributes(
        body: question_attrs.fetch("body").strip,
        kind: question_attrs.fetch("kind", "single"),
        difficulty: question_attrs.fetch("difficulty", 2),
        explanation: question_attrs["explanation"]&.strip,
        reference: question_attrs["reference"],
        active: true
      )
      question.save!

      # 選択肢は毎回作り直す（並び順や文言の修正を確実に反映させるため）
      question.choices.destroy_all
      question_attrs.fetch("choices").each_with_index do |choice_attrs, index|
        question.choices.create!(
          body: choice_attrs.fetch("body").to_s.strip,
          correct: choice_attrs.fetch("correct", false),
          position: index + 1
        )
      end

      unless question.choices.any?(&:correct)
        raise "正解の選択肢がありません: #{question.code}"
      end
    end
  end

  puts "#{File.basename(path)}: chapters=#{data.fetch("chapters").size}"
end

puts "chapters: #{Chapter.count}, questions: #{Question.count}, choices: #{Choice.count}"
