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
  <title>${esc(title)} · MCP Mail</title>
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
      color: var(--text);
      padding: 0.85rem 1rem;
      margin-bottom: 1.25rem;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      font-size: 0.9375rem;
    }
    .flash { box-shadow: inset 3px 0 0 #86868b; }
    .error { box-shadow: inset 3px 0 0 #1d1d1f; }
    form.stack { display: grid; gap: 1rem; }
    label {
      display: grid;
      gap: 0.4rem;
      font-size: 0.8125rem;
      font-weight: 500;
      color: var(--muted);
      letter-spacing: -0.01em;
    }
    label:has(input[type="checkbox"]) {
      display: flex;
      align-items: center;
      gap: 0.55rem;
      font-size: 0.9375rem;
      color: var(--text);
      font-weight: 400;
    }
    input, select, textarea {
      font: inherit;
      font-size: 1rem;
      color: var(--text);
      background: var(--fill);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 0.7rem 0.85rem;
      transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
    }
    input:hover, select:hover, textarea:hover { background: var(--surface); }
    input:focus, select:focus, textarea:focus {
      outline: none;
      background: var(--surface);
      border-color: #86868b;
      box-shadow: 0 0 0 3px rgba(0, 0, 0, 0.06);
    }
    input[type="checkbox"] {
      width: 1.05rem;
      height: 1.05rem;
      padding: 0;
      accent-color: #1d1d1f;
    }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    @media (max-width: 640px) { .row { grid-template-columns: 1fr; } }
    .actions {
      display: flex;
      gap: 0.65rem;
      flex-wrap: wrap;
      margin-top: 0.35rem;
      align-items: center;
    }
    button, .btn {
      font: inherit;
      font-size: 0.9375rem;
      font-weight: 500;
      cursor: pointer;
      border: 1px solid transparent;
      background: var(--text);
      color: #fff;
      padding: 0.6rem 1.1rem;
      border-radius: 980px;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s ease, opacity 0.15s ease;
    }
    button:hover, .btn:hover { background: #424245; color: #fff; text-decoration: none; }
    button.secondary, .btn.secondary {
      background: transparent;
      color: var(--text);
      border-color: var(--border);
    }
    button.secondary:hover, .btn.secondary:hover { background: var(--fill-hover); color: var(--text); }
    button.danger {
      background: transparent;
      color: var(--muted);
      border-color: var(--border);
    }
    button.danger:hover { background: var(--fill-hover); color: var(--text); }
    table { width: 100%; border-collapse: collapse; font-size: 0.9375rem; }
    th, td {
      text-align: left;
      padding: 0.9rem 0.55rem;
      border-bottom: 1px solid var(--border-soft);
      vertical-align: top;
    }
    th {
      color: var(--muted);
      font-weight: 500;
      font-size: 0.75rem;
      letter-spacing: 0.02em;
      text-transform: none;
    }
    tr:last-child td { border-bottom: none; }
    .mono { font-family: var(--mono); font-size: 0.8125rem; color: var(--accent-soft); }
    .muted { color: var(--muted); }
    .panel {
      background: var(--surface);
      border: 1px solid var(--border-soft);
      border-radius: var(--radius);
      padding: 1.5rem;
      box-shadow: var(--shadow);
    }
    .narrow {
      max-width: 400px;
      margin: 12vh auto;
    }
    .narrow h2 {
      font-size: 1.5rem;
      letter-spacing: -0.03em;
      margin-bottom: 0.35rem;
    }
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

export function adminHeader(active: "accounts" | "profile"): string {
  return `<header class="app">
    <h1>MCP Mail</h1>
    <nav>
      <a href="/admin" class="${active === "accounts" ? "active" : ""}">Contas</a>
      <a href="/admin/profile" class="${active === "profile" ? "active" : ""}">Perfil</a>
      <a href="/admin/logout">Sair</a>
    </nav>
  </header>`;
}

export { esc };
