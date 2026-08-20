import { config } from "../config.js";

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
  <title>${esc(title)} · ${esc(config.productName)}</title>
  <style>
    :root {
      --bg: #f5f5f7;
      --surface: #ffffff;
      --text: #1d1d1f;
      --muted: #86868b;
      --accent: #1d1d1f;
      --accent-soft: #424245;
      --border: #d2d2d7;
      --border-soft: #e8e8ed;
      --fill: #fbfbfd;
      --fill-hover: #f0f0f2;
      --danger: #6e6e73;
      --ok: #6e6e73;
      --shadow: 0 2px 16px rgba(0, 0, 0, 0.06);
      --radius: 12px;
      --font: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display",
        "Helvetica Neue", Helvetica, Arial, sans-serif;
      --mono: "SF Mono", ui-monospace, Menlo, Monaco, Consolas, monospace;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: var(--font);
      background: var(--bg);
      color: var(--text);
      line-height: 1.47;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    a { color: var(--accent-soft); text-decoration: none; }
    a:hover { color: var(--text); text-decoration: underline; text-underline-offset: 3px; }
    .wrap { max-width: 860px; margin: 0 auto; padding: 2.5rem 1.25rem 5rem; }
    header.app {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 1rem;
      margin-bottom: 2rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid var(--border-soft);
    }
    header.app h1 {
      font-size: 1.35rem;
      font-weight: 600;
      margin: 0;
      letter-spacing: -0.03em;
    }
    header.app nav {
      display: flex;
      gap: 1.25rem;
      font-size: 0.9375rem;
      color: var(--muted);
    }
    header.app nav a.active { color: var(--text); font-weight: 500; }
    h2 {
      font-size: 1.05rem;
      font-weight: 600;
      margin: 1.5rem 0 0.85rem;
      letter-spacing: -0.02em;
    }
    h2:first-child { margin-top: 0; }
    .flash, .error {
      background: var(--surface);
      border: 1px solid var(--border-soft);
      border-radius: var(--radius);
      padding: 0.85rem 1rem;
      margin-bottom: 1.25rem;
      box-shadow: var(--shadow);
      font-size: 0.9375rem;
    }
    .error { color: var(--text); }
    .panel {
      background: var(--surface);
      border: 1px solid var(--border-soft);
      border-radius: var(--radius);
      padding: 1.25rem 1.35rem;
      box-shadow: var(--shadow);
    }
    .narrow { max-width: 420px; margin: 0 auto; }
    .stack { display: flex; flex-direction: column; gap: 0.85rem; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.85rem; }
    @media (max-width: 640px) { .row { grid-template-columns: 1fr; } }
    label { display: flex; flex-direction: column; gap: 0.35rem; font-size: 0.8125rem; font-weight: 500; color: var(--muted); }
    input, select, textarea {
      font: inherit;
      font-size: 1rem;
      font-weight: 400;
      color: var(--text);
      background: var(--fill);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 0.65rem 0.75rem;
    }
    input:focus, select:focus, textarea:focus {
      outline: none;
      border-color: var(--accent-soft);
      background: var(--surface);
    }
    input[readonly] { color: var(--muted); background: var(--fill-hover); }
    .actions { display: flex; flex-wrap: wrap; gap: 0.65rem; align-items: center; margin-top: 0.5rem; }
    button, .btn {
      appearance: none;
      font: inherit;
      font-size: 0.9375rem;
      font-weight: 500;
      border-radius: 980px;
      padding: 0.55rem 1.15rem;
      border: none;
      cursor: pointer;
      background: var(--accent);
      color: #fff;
      text-decoration: none;
      display: inline-block;
    }
    button:hover, .btn:hover { background: var(--accent-soft); text-decoration: none; color: #fff; }
    button.secondary, .btn.secondary, button.danger {
      background: var(--fill-hover);
      color: var(--text);
    }
    button.secondary:hover, .btn.secondary:hover, button.danger:hover {
      background: var(--border-soft);
      color: var(--text);
    }
    table { width: 100%; border-collapse: collapse; font-size: 0.9375rem; }
    th, td { text-align: left; padding: 0.75rem 0.5rem; border-bottom: 1px solid var(--border-soft); vertical-align: top; }
    th { color: var(--muted); font-weight: 500; font-size: 0.8125rem; }
    .mono { font-family: var(--mono); font-size: 0.875rem; }
    .muted { color: var(--muted); }
    .badge {
      display: inline-block;
      font-size: 0.6875rem;
      font-weight: 500;
      padding: 0.15rem 0.5rem;
      border-radius: 980px;
      background: var(--fill-hover);
      color: var(--accent-soft);
      border: none;
      vertical-align: middle;
    }
    .inline-form { display: inline; }
    label.with-tip { position: relative; }
    label.with-tip::after {
      content: " ⓘ";
      color: var(--muted);
      font-weight: 400;
      font-size: 0.85em;
    }
    label.with-tip:hover::before,
    label.with-tip:focus-within::before {
      content: attr(data-tip);
      position: absolute;
      left: 0;
      top: calc(100% + 6px);
      z-index: 20;
      width: min(320px, 80vw);
      padding: 0.75rem 0.9rem;
      background: #1d1d1f;
      color: #f5f5f7;
      font-size: 0.8125rem;
      font-weight: 400;
      line-height: 1.4;
      border-radius: 10px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.18);
      pointer-events: none;
    }
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

export function adminHeader(active: "home" | "accounts" | "profile"): string {
  const homeLabel = config.isWhatsapp ? "Estado" : "Contas";
  const homeActive = active === "home" || active === "accounts";
  return `<header class="app">
    <h1>${esc(config.productName)}</h1>
    <nav>
      <a href="/admin" class="${homeActive ? "active" : ""}">${esc(homeLabel)}</a>
      <a href="/admin/profile" class="${active === "profile" ? "active" : ""}">Perfil</a>
      <a href="/admin/logout">Sair</a>
    </nav>
  </header>`;
}

export { esc };
