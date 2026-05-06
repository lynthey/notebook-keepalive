# notebook-keepalive

Paperspace Free GPU notebook (autosdgen) を idle-shutdown から守るための外部
keepalive workflow。public repo にすることで GH Actions の private 課金を回避。

## 仕組み

`.github/workflows/keepalive.yml` が 5 分おきに:

1. Paperspace API (`/v1/notebooks`) で `NOTEBOOK_NAME=AUTOSDGEN` を resolve
2. 詳細 API で現在の `fqdn` と Jupyter `token` を取得(再起動で変わるため動的解決)
3. `https://{fqdn}/api/status` を外部 URL 経由で叩く

autosdgen 側の B 対策(container 内 loopback heartbeat 60s 間隔)はプロキシ層を
通らないため、本 workflow で「本物の外部トラフィック」を補う。

## セットアップ

1. このリポジトリを **public** で GitHub に push(private だと GH Actions 課金対象)
2. リポジトリの Settings → Secrets and variables → Actions → New repository secret:
   - Name: `PAPERSPACE_API_KEY`
   - Value: Paperspace の API key(autosdgen の `.env` と同じもの)
3. Actions タブから `paperspace-keepalive` を選んで `Run workflow` で動作確認
