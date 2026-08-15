class CreateExams < ActiveRecord::Migration[8.0]
  def change
    create_table :exams do |t|
      t.string :code, null: false
      t.string :name, null: false
      t.text :description
      t.integer :position, null: false, default: 0

      t.timestamps
    end

    add_index :exams, :code, unique: true
  end
end
