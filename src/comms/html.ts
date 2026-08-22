function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function layout(title: string, body: string, opts?: { flash?: string; error?: string }): string {
  return `<!DOCTYPE html>
<html lang="pt">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)} · BWB Comms</title>
  <style>
    :root {
      --bg: #f5f5f7; --surface: #fff; --text: #1d1d1f; --muted: #86868b;
      --accent: #1d1d1f; --accent-soft: #424245; --border: #d2d2d7;
      --border-soft: #e8e8ed; --fill: #fbfbfd; --fill-hover: #f0f0f2;
      --shadow: 0 2px 16px rgba(0,0,0,.06); --radius: 12px;
      --font: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif;
      --mono: "SF Mono", ui-monospace, Menlo, Monaco, Consolas, monospace;
    }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; font-family: var(--font); background: var(--bg); color: var(--text); line-height: 1.47; }
    a { color: var(--accent-soft); text-decoration: none; }
    a:hover { text-decoration: underline; text-underline-offset: 3px; color: var(--text); }
    .wrap { max-width: 1100px; margin: 0 auto; padding: 2rem 1.25rem 5rem; }
    header.app { display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid var(--border-soft); flex-wrap: wrap; }
    header.app h1 { font-size: 1.25rem; font-weight: 600; margin: 0; letter-spacing: -.03em; }
    header.app nav { display: flex; gap: 1rem; font-size: .9rem; color: var(--muted); flex-wrap: wrap; }
    header.app nav a.active { color: var(--text); font-weight: 500; }
    h2 { font-size: 1.05rem; font-weight: 600; margin: 1.25rem 0 .75rem; }
    .flash, .error { background: var(--surface); border: 1px solid var(--border-soft); border-radius: var(--radius); padding: .85rem 1rem; margin-bottom: 1rem; box-shadow: var(--shadow); }
    .panel { background: var(--surface); border: 1px solid var(--border-soft); border-radius: var(--radius); padding: 1.15rem 1.25rem; box-shadow: var(--shadow); margin-bottom: 1rem; }
    .narrow { max-width: 420px; margin: 0 auto; }
    .stack { display: flex; flex-direction: column; gap: .85rem; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: .85rem; }
    @media (max-width: 640px) { .row { grid-template-columns: 1fr; } }
    label { display: flex; flex-direction: column; gap: .35rem; font-size: .8125rem; font-weight: 500; color: var(--muted); }
    input, select, textarea { font: inherit; font-size: 1rem; color: var(--text); background: var(--fill); border: 1px solid var(--border); border-radius: 10px; padding: .65rem .75rem; }
    textarea { min-height: 6rem; }
    .actions { display: flex; flex-wrap: wrap; gap: .65rem; align-items: center; margin-top: .5rem; }
    button, .btn { appearance: none; font: inherit; font-size: .9375rem; font-weight: 500; border-radius: 980px; padding: .55rem 1.15rem; border: none; cursor: pointer; background: var(--accent); color: #fff; text-decoration: none; display: inline-block; }
    button.secondary, .btn.secondary { background: var(--fill-hover); color: var(--text); }
    table { width: 100%; border-collapse: collapse; font-size: .875rem; }
    th, td { text-align: left; padding: .65rem .4rem; border-bottom: 1px solid var(--border-soft); vertical-align: top; }
    th { color: var(--muted); font-weight: 500; font-size: .75rem; }
    .mono { font-family: var(--mono); font-size: .8rem; }
    .muted { color: var(--muted); }
    .badge { display: inline-block; font-size: .6875rem; padding: .15rem .5rem; border-radius: 980px; background: var(--fill-hover); }
  </style>
</head>
<body>
  <div class="wrap">
    ${opts?.flash ? `<div class="flash">${esc(opts.flash)}</div>` : ""}
    ${opts?.error ? `<div class="error">${esc(opts.error)}</div>` : ""}
    ${body}
  </div>
</body>
</html>`;
}

export type Nav =
  | "unanswered"
  | "invoices"
  | "whatsapp"
  | "kb"
  | "rules"
  | "jobs";

export function header(active: Nav): string {
  const item = (href: string, id: Nav, label: string) =>
    `<a href="${href}" class="${active === id ? "active" : ""}">${label}</a>`;
  return `<header class="app">
    <h1>BWB Comms</h1>
    <nav>
      ${item("/admin", "unanswered", "Não respondidos")}
      ${item("/admin/invoices", "invoices", "Facturas")}
      ${item("/admin/whatsapp", "whatsapp", "WhatsApp")}
      ${item("/admin/kb", "kb", "KB")}
      ${item("/admin/rules", "rules", "Regras")}
      ${item("/admin/jobs", "jobs", "Jobs")}
      <a href="/admin/pack.md">Pack ChatGPT</a>
      <a href="/admin/logout">Sair</a>
    </nav>
  </header>`;
}

export { esc };
