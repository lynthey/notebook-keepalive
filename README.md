# notebook-keepalive

Paperspace Free GPU notebook (autosdgen) を idle-shutdown から守るための外部
keepalive。

## 構成

実装は 2 つあり、現状は **Cloudflare Worker (1-min cron)** が主力。GitHub
Actions の `*/5` cron は実測 ~12.5% しか起動しなかったため格下げ。

| 実装 | パス | cron 間隔 | 役割 |
|------|------|-----------|------|
| Cloudflare Worker | `worker/` | 1 min | 主力 |
| GitHub Actions | `.github/workflows/keepalive.yml` | 5 min (best-effort) | 旧実装。CF 検証完了後に撤去予定 |

両方とも Paperspace API で `NOTEBOOK_NAME=AUTOSDGEN` を動的に resolve し、
Jupyter `/api/status` を外部 URL 経由で叩く同じロジック。autosdgen 側の B 対策
(container 内 loopback heartbeat 60s) は Paperspace edge proxy を通らないため、
本リポジトリで「本物の外部トラフィック」を補う。

## Cloudflare Worker セットアップ

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

## GitHub Actions セットアップ (legacy)

1. リポジトリを **public** で push(private だと GH Actions 課金対象)
2. Settings → Secrets and variables → Actions → New repository secret:
   - Name: `PAPERSPACE_API_KEY`
   - Value: Paperspace の API key(autosdgen の `.env` と同じ)
3. Actions タブから `paperspace-keepalive` を `Run workflow` で動作確認

## 既知の制約

- GitHub Actions schedule cron は **best-effort**。`*/5` でも実測 ~38〜45 分の
  沈黙が頻発し、Paperspace の idle threshold(推定 30 分前後)を防げないケースが
  ある(2026-05-06 検証で確認済み)。CF Worker への移行はこの問題が動機。
- 全 keepalive 実装に共通: `/api/status` への 200 応答が「Paperspace edge proxy
  に active として認識される」かは未検証。万一無視される endpoint だった場合は
  `/api/contents` 等の実 endpoint に変える余地あり。
