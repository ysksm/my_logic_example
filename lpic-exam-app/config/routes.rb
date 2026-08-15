Rails.application.routes.draw do
  root "dashboard#show"

  resource :dashboard, only: :show
  resource :stats, only: :show

  # 章コードは "101.1" のようにドットを含むため、拡張子として解釈させない。
  resources :exams, only: [ :index, :show ], param: :code, constraints: { code: %r{[^/]+} } do
    resources :chapters, only: :show, param: :code, shallow: true, constraints: { code: %r{[^/]+} }
  end

  resources :questions, only: [ :index, :show ]

  resources :quiz_sessions, only: [ :index, :new, :create, :show, :destroy ] do
    member do
      get :result
      post :review
      post :finish
    end

    resources :quiz_items, only: [ :show, :update ], path: "q"
  end

  get "up" => "rails/health#show", as: :rails_health_check
end
