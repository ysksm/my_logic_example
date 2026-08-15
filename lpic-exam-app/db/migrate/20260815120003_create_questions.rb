class CreateQuestions < ActiveRecord::Migration[8.0]
  def change
    create_table :questions do |t|
      t.references :chapter, null: false, foreign_key: true
      t.string :code, null: false
      t.text :body, null: false
      t.string :kind, null: false, default: "single"
      t.text :explanation
      t.integer :difficulty, null: false, default: 2
      t.string :reference
      t.boolean :active, null: false, default: true

      t.timestamps
    end

    add_index :questions, :code, unique: true
  end
end
