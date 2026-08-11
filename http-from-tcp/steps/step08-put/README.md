# step08: PUT

## step07からの差分

**HTTPコアは変更ありません。**

- メモリ上のリソース置き場（`Map`）
- `POST /items` … 新規作成（**冪等でない**）
- `PUT /items/:id` … 丸ごと置き換え（**冪等**）
- `201 Created` と `Location` ヘッダー

## POST と PUT の決定的な違い

```
POST /items          「このコレクションに追加して」
                      → idはサーバが決める
                      → 2回送れば2件できる      ← 冪等でない

PUT /items/99        「この場所の中身をこれにして」
                      → idはクライアントが指定する
                      → 何回送っても1件のまま    ← 冪等
```

**冪等（idempotent）** とは「1回でも100回でも、最終的なサーバの状態が同じ」という性質です。

なぜ大事か: 通信は失敗します。応答が返ってこなかったとき、
- 冪等なら**安心して再送できる**
- 冪等でないと再送してよいかわからない（二重注文になるかもしれない）

## 起動

```sh
node server.js
```

ブラウザで `http://localhost:8080/` を開くとボタンで試せます。

## 実験1 — POSTは押すたび増える

```sh
curl -i -X POST -H 'Content-Type: application/json' \
     -d '{"name":"ぶどう","price":300}' http://localhost:8080/items
```

2回実行してください。

```
1回目: HTTP/1.1 201 Created   Location: /items/3
2回目: HTTP/1.1 201 Created   Location: /items/4
```

`curl http://localhost:8080/items` で確認すると**2件増えています**。

## 実験2 — PUTは何回でも同じ

```sh
curl -i -X PUT -H 'Content-Type: application/json' \
     -d '{"name":"メロン","price":3000}' http://localhost:8080/items/99
```

2回実行してください。

```
1回目: HTTP/1.1 201 Created   Location: /items/99
2回目: HTTP/1.1 200 OK
```

**ステータスコードは変わりますが、サーバの状態は同じ1件です。**
「冪等 = 毎回同じ応答」ではなく「冪等 = 毎回同じ状態になる」ことに注意してください。

## 201 Created と Location

新しくリソースを作ったときは:

- ステータスは `201 Created`（`200 OK` ではなく）
- `Location` ヘッダーで**どこに作られたか**を伝える

```
HTTP/1.1 201 Created
Location: /items/99
```

クライアントは次からそのURLを叩けばよい、とわかります。

## 実験3 — PUTは「部分更新」ではない

```sh
curl -X PUT -H 'Content-Type: application/json' \
     -d '{"name":"メロン","price":3000}' http://localhost:8080/items/99
curl -X PUT -H 'Content-Type: application/json' \
     -d '{"name":"メロン"}' http://localhost:8080/items/99
curl http://localhost:8080/items/99
```

`price` が**消えています**。PUTは丸ごと置き換えだからです。

一部だけ更新したい場合のメソッドが `PATCH` です（この教材では扱いません）。

## 実験4 — 冪等性を体で確かめる

```sh
# POSTを5回
for i in 1 2 3 4 5; do
  curl -s -o /dev/null -X POST -H 'Content-Type: application/json' \
       -d '{"name":"POST産"}' http://localhost:8080/items
done

# PUTを5回
for i in 1 2 3 4 5; do
  curl -s -o /dev/null -X PUT -H 'Content-Type: application/json' \
       -d '{"name":"PUT産"}' http://localhost:8080/items/777
done

curl -s http://localhost:8080/items
```

POST産が5件、PUT産が1件。これが冪等性の違いです。

## 確認

- ネットワークがタイムアウトしたとき、安心して再送できるのはどちらですか？
- `PUT /items/99` で `id` をボディに書いた場合、URLとボディのどちらを正とすべきでしょう？
- `201` を返すのは PUT と POST のどちらでもありえますか？
