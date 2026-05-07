// Cloudflare Worker: Paperspace notebook keepalive.
//
// 1 分おきに Paperspace API → 動的に fqdn/token を解決 → Jupyter /api/contents/
// を外部 URL 経由で叩く。autosdgen の B 対策(container 内 loopback heartbeat)が
// Paperspace edge proxy を通らない問題を補う。
//
// endpoint が /api/status から /api/contents/ になった経緯: 2026-05-06 の
// 試走で 1-min ping 配備済みにも関わらず boot 1h37m で inactivity 落ちした。
// jupyter は /api/status の 200 応答を log に残さないので Worker 側の到達確認は
// 取れないが、Paperspace edge が「自分自身の health check に使える endpoint を
// 活性 traffic と数えるはずがない」前提で /api/contents/ (実 I/O = ディレクトリ
// listing) に切り替え。?content=0 で本文は読まずヘッダだけにして軽く保つ。
//
// GitHub Actions の `*/5` cron が実測 ~12.5% 起動率しかなかったため、Workers Cron
// Triggers (1-min・公式 SLA) に置き換えた経緯あり。

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(keepalive(env, "cron"));
  },
  // 手動 ping 用。`curl https://<worker>.<acct>.workers.dev/` で発火可能。
  // 認証ゲートなし(成功で notebook を生かすだけなので濫用リスク低)。
  async fetch(request, env, ctx) {
    const result = await keepalive(env, "fetch");
    return new Response(result.message + "\n", {
      status: result.ok ? 200 : 502,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  },
};

async function keepalive(env, source) {
  const apiKey = env.PAPERSPACE_API_KEY;
  const notebookName = env.NOTEBOOK_NAME || "AUTOSDGEN";
  const ts = new Date().toISOString();

  if (!apiKey) {
    const m = `${ts} [${source}] ERROR: PAPERSPACE_API_KEY not set`;
    console.error(m);
    return { ok: false, message: m };
  }

  let listing;
  try {
    const r = await fetch("https://api.paperspace.com/v1/notebooks?limit=100", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!r.ok) {
      const m = `${ts} [${source}] list notebooks failed: HTTP ${r.status}`;
      console.error(m);
      return { ok: false, message: m };
    }
    listing = await r.json();
  } catch (e) {
    const m = `${ts} [${source}] list notebooks threw: ${e}`;
    console.error(m);
    return { ok: false, message: m };
  }

  const matches = (listing.items || [])
    .filter((n) => n.name === notebookName)
    .sort((a, b) => new Date(b.dtModified) - new Date(a.dtModified));
  if (matches.length === 0) {
    const m = `${ts} [${source}] no notebook named '${notebookName}' — skip`;
    console.log(m);
    return { ok: true, message: m };
  }
  const nid = matches[0].id;

  let detail;
  try {
    const r = await fetch(`https://api.paperspace.com/v1/notebooks/${nid}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!r.ok) {
      const m = `${ts} [${source}] detail failed: HTTP ${r.status} (nid=${nid})`;
      console.error(m);
      return { ok: false, message: m };
    }
    detail = await r.json();
  } catch (e) {
    const m = `${ts} [${source}] detail threw: ${e}`;
    console.error(m);
    return { ok: false, message: m };
  }

  const state = (detail.state || "").toLowerCase();
  const fqdn = detail.fqdn || "";
  const token = detail.token || "";

  if (state !== "running") {
    const m = `${ts} [${source}] state=${state} — skip ping`;
    console.log(m);
    return { ok: true, message: m };
  }
  if (!fqdn || !token) {
    const m = `${ts} [${source}] missing fqdn/token (state=${state}) — skip`;
    console.log(m);
    return { ok: true, message: m };
  }

  // /api/contents/?content=0: ルートディレクトリの listing をヘッダのみ取得。
  // ?content=0 で entry の中身を返さないため転送量は数百バイト。Paperspace edge
  // から見れば「ユーザーがファイルツリーを開いた」相当の I/O traffic に見える。
  const path = "/api/contents/?content=0";
  let code;
  try {
    const r = await fetch(`https://${fqdn}${path}`, {
      headers: { Authorization: `token ${token}` },
      cf: { cacheTtl: 0, cacheEverything: false },
    });
    code = r.status;
  } catch (e) {
    const m = `${ts} [${source}] ping threw: ${e}`;
    console.error(m);
    return { ok: false, message: m };
  }

  const m = `${ts} [${source}] GET https://${fqdn}${path} -> ${code}`;
  if (code === 200) {
    console.log(m);
    return { ok: true, message: m };
  } else {
    console.warn(m);
    return { ok: false, message: m };
  }
}
