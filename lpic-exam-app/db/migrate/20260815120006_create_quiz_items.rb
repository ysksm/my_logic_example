class CreateQuizItems < ActiveRecord::Migration[8.0]
  def change
    create_table :quiz_items do |t|
      t.references :quiz_session, null: false, foreign_key: true
      t.references :question, null: false, foreign_key: true
      t.integer :position, null: false
      t.json :selected_choice_ids, null: false, default: []
      t.boolean :correct
      t.datetime :answered_at

      t.timestamps
    end

    add_index :quiz_items, [ :quiz_session_id, :position ], unique: true
    add_index :quiz_items, [ :question_id, :answered_at ]
  end
end
