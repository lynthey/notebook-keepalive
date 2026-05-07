# notebook-keepalive

Paperspace Free GPU notebook (autosdgen) を idle-shutdown から守るための外部
keepalive。**Cloudflare Worker (1-min cron)** で実装。

## 仕組み

`worker/` の Cloudflare Worker が 1 分おきに:

1. Paperspace API (`/v1/notebooks`) で `NOTEBOOK_NAME=AUTOSDGEN` を resolve
2. 詳細 API で現在の `fqdn` と Jupyter `token` を取得(再起動で変わるため動的解決)
3. `https://{fqdn}/api/contents/?content=0` を外部 URL 経由で叩く(ヘッダのみ)

autosdgen 側の B 対策(container 内 loopback heartbeat 60s 間隔)は Paperspace
edge proxy を通らないため、本リポジトリで「本物の外部トラフィック」を補う。

## セットアップ

前提: Cloudflare アカウント(無料プランで OK。1-min cron 公式サポート)。

```bash
cd worker
npm install
npx wrangler login                            # ブラウザで OAuth
npx wrangler secret put PAPERSPACE_API_KEY    # autosdgen .env と同じ値を貼る
npx wrangler deploy
```

確認:

```bash
npx wrangler tail --format=pretty   # 1 分ごとにログが流れる想定
```

手動発火 (cron を待たずテスト):

```bash
curl https://paperspace-keepalive.<your-cf-subdomain>.workers.dev/
```

設定:
- `wrangler.toml` の `[triggers].crons` で間隔変更
- `wrangler.toml` の `[vars].NOTEBOOK_NAME` で対象 notebook 変更
- secret `PAPERSPACE_API_KEY` のみ別管理(`wrangler secret put`)
- `[observability].enabled = true` で dashboard から 7 日分のログ検索可

## 経緯と既知の制約

- 当初 GitHub Actions schedule (`*/5` cron) で実装したが、実測 ~12.5% しか
  起動せず(13:03Z 以降 45 分沈黙等が頻発)Paperspace の idle threshold
  (推定 30 分前後)を防げなかった。GH Actions schedule は best-effort 仕様で
  保証されないため、1-min 公式サポートの Cloudflare Workers Cron Triggers に
  全面移行(2026-05-06)。
- 当初は `/api/status` を叩いていたが、1-min ping 配備済みでも 1h37m で
  inactivity 落ちした(2026-05-06 boot 22:08 JST → 死亡 23:46 JST)。仮説:
  Paperspace edge は `/api/status` のような health check 系 endpoint を
  「ユーザー活性 traffic」とみなさない(そうでないと idle 検知が無意味になる)。
  対策として `/api/contents/?content=0`(実 I/O = ディレクトリ listing)に
  swap。ヘッダのみ取得で転送量数百バイト。
