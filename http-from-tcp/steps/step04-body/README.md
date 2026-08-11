# step04: ボディを読む

## step03からの差分

- `Content-Length` の値を読む
- **その数だけバイトが届くまで待つ**

## このステップの一番大事な考え方

```
ヘッダー部分            空行        ボディ
┌────────────────────┐ ┌──────┐ ┌───────────────┐
POST /json HTTP/1.1\r\n
Content-Length: 21\r\n
                        \r\n\r\n   {"name":"太郎"}
                                    ↑ここから21バイト
```

- ヘッダーの終わりは `\r\n\r\n` という**印がある**
- ボディの終わりを示す**印は存在しない**

TCPは「ここでメッセージが終わり」を教えてくれません（バイト列を流し続けるだけ）。
接続も次のリクエストのために開いたままかもしれません。

だから**送信側が先に `Content-Length` で長さを宣言し、受信側はその数だけ数えて読む**。
これがHTTP/1.1の基本ルールです。

## 起動

```sh
node server.js
```

## 実験1 — フォーム形式のPOST

```sh
curl -v -X POST -d 'name=taro&age=20' http://localhost:8080/form
```

curl が自動で付けているものに注目してください:

```
Content-Length: 16
Content-Type: application/x-www-form-urlencoded
```

`-d` を使うと curl は勝手にこの2つを付けます。

## 実験2 — JSONのPOST

```sh
curl -v -X POST -H 'Content-Type: application/json' \
     -d '{"name":"太郎"}' http://localhost:8080/json
```

`Content-Length: 21` になります。「太郎」はUTF-8で3バイト×2文字だからです。

**わかること:** `Content-Length` は**文字数ではなくバイト数**。
だから `Buffer.byteLength` や `Buffer` の長さで数える必要があります。

## 実験3 — ボディが分割して届く様子

```sh
{ printf 'POST /slow HTTP/1.1\r\nHost: localhost\r\nContent-Length: 10\r\n\r\n';
  sleep 1; printf 'abcde';
  sleep 1; printf 'fghij'; } | nc localhost 8080
```

サーバに

```
▶ ボディが足りません: 5 / 10 バイト。続きを待ちます
```

と出てから、全部揃って処理されます。

## 実験4 — 嘘のContent-Lengthを送る

```sh
printf 'POST /lie HTTP/1.1\r\nHost: localhost\r\nContent-Length: 100\r\n\r\nshort' | nc localhost 8080
```

サーバは「あと95バイト来るはず」と待ち続け、`nc` を Ctrl+C するまで応答しません。

**わかること:** `Content-Length` が信用できないとHTTPは成立しません。
（この食い違いを悪用する攻撃を **HTTPリクエストスマグリング** と呼びます。
実務のサーバが `Content-Length` と `Transfer-Encoding` の整合性に神経質なのはこのためです。）

## 補足：Content-Length を使わない方法

長さが事前にわからない場合（動的生成やストリーミング）のために
`Transfer-Encoding: chunked` という仕組みがあります。
この教材では扱いませんが、「長さを先に言えないなら、小分けにして毎回長さを言う」
という発想です。

## 確認

- `Content-Length` は文字数とバイト数のどちらですか？
- ボディの終わりをサーバはどうやって知りますか？
- `Content-Length` を実際より小さく宣言したら、余ったバイトはどうなると思いますか？（次のステップの伏線です）
