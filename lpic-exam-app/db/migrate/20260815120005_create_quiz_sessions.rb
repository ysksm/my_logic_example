class CreateQuizSessions < ActiveRecord::Migration[8.0]
  def change
    create_table :quiz_sessions do |t|
      t.string :title, null: false
      t.string :mode, null: false
      t.string :status, null: false, default: "in_progress"
      t.json :filters, null: false, default: {}
      t.references :source_quiz_session, foreign_key: { to_table: :quiz_sessions }
      t.datetime :started_at
      t.datetime :finished_at

      t.timestamps
    end

    add_index :quiz_sessions, :status
  end
end
