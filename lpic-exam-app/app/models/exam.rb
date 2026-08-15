class Exam < ApplicationRecord
  has_many :chapters, -> { order(:position, :code) }, dependent: :destroy, inverse_of: :exam
  has_many :questions, through: :chapters

  validates :code, presence: true, uniqueness: true
  validates :name, presence: true

  scope :ordered, -> { order(:position, :code) }

  def to_param
    code
  end
end
