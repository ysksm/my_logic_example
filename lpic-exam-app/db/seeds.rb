# 問題データの投入。
#
#   bin/rails db:seed
#
# db/seeds/exams.yml と db/seeds/questions/*.yml を読み込む。
# code をキーにした upsert なので、何度実行しても解答履歴は壊れない。
# 実処理は lib/seed_loader.rb にある。
SeedLoader.call(dir: Rails.root.join("db/seeds"))
