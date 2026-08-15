# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.
#
# This file is the source Rails uses to define your schema when running `bin/rails
# db:schema:load`. When creating a new database, `bin/rails db:schema:load` tends to
# be faster and is potentially less error prone than running all of your
# migrations from scratch. Old migrations may fail to apply correctly if those
# migrations use external dependencies or application code.
#
# It's strongly recommended that you check this file into your version control system.

ActiveRecord::Schema[8.0].define(version: 2026_08_15_120006) do
  create_table "chapters", force: :cascade do |t|
    t.integer "exam_id", null: false
    t.string "code", null: false
    t.string "name", null: false
    t.text "description"
    t.integer "position", default: 0, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["code"], name: "index_chapters_on_code", unique: true
    t.index ["exam_id"], name: "index_chapters_on_exam_id"
  end

  create_table "choices", force: :cascade do |t|
    t.integer "question_id", null: false
    t.text "body", null: false
    t.boolean "correct", default: false, null: false
    t.integer "position", default: 0, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["question_id"], name: "index_choices_on_question_id"
  end

  create_table "exams", force: :cascade do |t|
    t.string "code", null: false
    t.string "name", null: false
    t.text "description"
    t.integer "position", default: 0, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["code"], name: "index_exams_on_code", unique: true
  end

  create_table "questions", force: :cascade do |t|
    t.integer "chapter_id", null: false
    t.string "code", null: false
    t.text "body", null: false
    t.string "kind", default: "single", null: false
    t.text "explanation"
    t.integer "difficulty", default: 2, null: false
    t.string "reference"
    t.boolean "active", default: true, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["chapter_id"], name: "index_questions_on_chapter_id"
    t.index ["code"], name: "index_questions_on_code", unique: true
  end

  create_table "quiz_items", force: :cascade do |t|
    t.integer "quiz_session_id", null: false
    t.integer "question_id", null: false
    t.integer "position", null: false
    t.json "selected_choice_ids", default: [], null: false
    t.boolean "correct"
    t.datetime "answered_at"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["question_id", "answered_at"], name: "index_quiz_items_on_question_id_and_answered_at"
    t.index ["question_id"], name: "index_quiz_items_on_question_id"
    t.index ["quiz_session_id", "position"], name: "index_quiz_items_on_quiz_session_id_and_position", unique: true
    t.index ["quiz_session_id"], name: "index_quiz_items_on_quiz_session_id"
  end

  create_table "quiz_sessions", force: :cascade do |t|
    t.string "title", null: false
    t.string "mode", null: false
    t.string "status", default: "in_progress", null: false
    t.json "filters", default: {}, null: false
    t.integer "source_quiz_session_id"
    t.datetime "started_at"
    t.datetime "finished_at"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["source_quiz_session_id"], name: "index_quiz_sessions_on_source_quiz_session_id"
    t.index ["status"], name: "index_quiz_sessions_on_status"
  end

  add_foreign_key "chapters", "exams"
  add_foreign_key "choices", "questions"
  add_foreign_key "questions", "chapters"
  add_foreign_key "quiz_items", "questions"
  add_foreign_key "quiz_items", "quiz_sessions"
  add_foreign_key "quiz_sessions", "quiz_sessions", column: "source_quiz_session_id"
end
