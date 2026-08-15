class Chapter < ApplicationRecord
  belongs_to :exam, inverse_of: :chapters
  has_many :questions, -> { order(:code) }, dependent: :destroy, inverse_of: :chapter

  validates :code, presence: true, uniqueness: true
  validates :name, presence: true

  scope :ordered, -> { order(:position, :code) }

  def to_param
    code
  end

  def label
    "#{code} #{name}"
  end

  # 「101.1」→「101」。主題（トピック）単位のグルーピングに使う。
  def topic_code
    code.split(".").first
  end
end
