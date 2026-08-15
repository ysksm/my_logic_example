require "yaml"

# db/seeds/ の YAML から試験・章・問題・選択肢を投入する。
#
# code をキーにした upsert で、既存レコードの id を維持することを最優先にしている。
# Choice の id が変わると QuizItem#selected_choice_ids が参照先を失い、
# 過去の解答が「どれを選んだか分からない」状態になるため、
# 選択肢は position をキーに更新し、余った分だけを削除する。
class SeedLoader
  class InvalidSeedError < StandardError; end

  def self.call(dir: Rails.root.join("db/seeds"), io: $stdout)
    new(dir: dir, io: io).call
  end

  def initialize(dir:, io: $stdout)
    @dir = Pathname.new(dir)
    @io = io
  end

  def call
    load_exams
    question_files.each { |path| load_question_file(path) }

    log "chapters: #{Chapter.count}, questions: #{Question.count}, choices: #{Choice.count}"
    self
  end

  private

  attr_reader :dir, :io

  def question_files
    Dir[dir.join("questions/*.yml")].sort
  end

  def read_yaml(path)
    YAML.safe_load_file(path, permitted_classes: [], aliases: true)
  end

  def load_exams
    read_yaml(dir.join("exams.yml")).fetch("exams").each do |attrs|
      exam = Exam.find_or_initialize_by(code: attrs.fetch("code"))
      exam.update!(attrs.slice("name", "description", "position"))
    end

    log "exams: #{Exam.count}"
  end

  def load_question_file(path)
    data = read_yaml(path)
    exam = Exam.find_by!(code: data.fetch("exam_code"))

    data.fetch("chapters").each do |chapter_attrs|
      chapter = upsert_chapter(exam, chapter_attrs)
      Array(chapter_attrs["questions"]).each { |attrs| upsert_question(chapter, attrs) }
    end

    log "#{File.basename(path)}: chapters=#{data.fetch("chapters").size}"
  end

  def upsert_chapter(exam, attrs)
    chapter = Chapter.find_or_initialize_by(code: attrs.fetch("code"))
    chapter.exam = exam
    chapter.assign_attributes(attrs.slice("name", "description", "position"))
    chapter.save!
    chapter
  end

  def upsert_question(chapter, attrs)
    question = Question.find_or_initialize_by(code: attrs.fetch("code"))
    question.chapter = chapter
    question.assign_attributes(
      body: attrs.fetch("body").strip,
      kind: attrs.fetch("kind", "single"),
      difficulty: attrs.fetch("difficulty", 2),
      explanation: attrs["explanation"]&.strip,
      reference: attrs["reference"],
      active: true
    )
    question.save!

    upsert_choices(question, attrs.fetch("choices"))
    question
  end

  # position をキーに更新するので、選択肢の文言を直しても Choice の id は変わらない。
  def upsert_choices(question, choices_attrs)
    choices_attrs.each_with_index do |attrs, index|
      choice = Choice.find_or_initialize_by(question_id: question.id, position: index + 1)
      choice.assign_attributes(
        body: attrs.fetch("body").to_s.strip,
        correct: attrs.fetch("correct", false)
      )
      choice.save!
    end

    # 選択肢を減らした場合は、余った分だけを削除する
    Choice.where(question_id: question.id).where(position: (choices_attrs.size + 1)..).destroy_all
    question.choices.reset

    return if question.choices.any?(&:correct)

    raise InvalidSeedError, "正解の選択肢がありません: #{question.code}"
  end

  def log(message)
    io&.puts(message)
  end
end
