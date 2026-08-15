class Choice < ApplicationRecord
  belongs_to :question, inverse_of: :choices

  validates :body, presence: true

  scope :ordered, -> { order(:position, :id) }
end
