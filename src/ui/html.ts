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
      --bg: #0f1419;
      --surface: #1a222c;
      --text: #e8eef4;
      --muted: #8b9aab;
      --accent: #3d8bfd;
      --danger: #e35d5d;
      --ok: #3cbc8d;
      --border: #2a3542;
      --font: "IBM Plex Sans", "Segoe UI", sans-serif;
      --mono: "IBM Plex Mono", ui-monospace, monospace;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100vh;
      font-family: var(--font);
      background:
        radial-gradient(1200px 600px at 10% -10%, #1c2a3d 0%, transparent 55%),
        radial-gradient(900px 500px at 100% 0%, #18241f 0%, transparent 50%),
        var(--bg);
      color: var(--text);
      line-height: 1.45;
    }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .wrap { max-width: 920px; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
    header.app {
      display: flex; justify-content: space-between; align-items: baseline;
      gap: 1rem; margin-bottom: 2rem; border-bottom: 1px solid var(--border); padding-bottom: 1rem;
    }
    header.app h1 { font-size: 1.25rem; margin: 0; letter-spacing: -0.02em; }
    header.app nav { display: flex; gap: 1rem; font-size: 0.95rem; color: var(--muted); }
    h2 { font-size: 1.1rem; margin: 0 0 1rem; }
    .flash { background: #163528; color: #b7f0d5; padding: 0.75rem 1rem; margin-bottom: 1rem; border-left: 3px solid var(--ok); }
    .error { background: #3a1c1c; color: #ffc9c9; padding: 0.75rem 1rem; margin-bottom: 1rem; border-left: 3px solid var(--danger); }
    form.stack { display: grid; gap: 0.85rem; }
    label { display: grid; gap: 0.35rem; font-size: 0.85rem; color: var(--muted); }
    input, select, textarea {
      font: inherit; color: var(--text); background: var(--surface);
      border: 1px solid var(--border); padding: 0.65rem 0.75rem; border-radius: 0;
    }
    input:focus, select:focus, textarea:focus { outline: 2px solid var(--accent); outline-offset: 0; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.85rem; }
    @media (max-width: 640px) { .row { grid-template-columns: 1fr; } }
    .actions { display: flex; gap: 0.75rem; flex-wrap: wrap; margin-top: 0.5rem; }
    button, .btn {
      font: inherit; cursor: pointer; border: 1px solid var(--accent);
      background: var(--accent); color: #041018; padding: 0.55rem 1rem;
    }
    button.secondary, .btn.secondary { background: transparent; color: var(--text); border-color: var(--border); }
    button.danger { background: transparent; color: var(--danger); border-color: var(--danger); }
    table { width: 100%; border-collapse: collapse; font-size: 0.95rem; }
    th, td { text-align: left; padding: 0.7rem 0.5rem; border-bottom: 1px solid var(--border); vertical-align: top; }
    th { color: var(--muted); font-weight: 500; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; }
    .mono { font-family: var(--mono); font-size: 0.85rem; }
    .muted { color: var(--muted); }
    .panel { background: color-mix(in srgb, var(--surface) 88%, transparent); border: 1px solid var(--border); padding: 1.25rem; }
    .narrow { max-width: 420px; margin: 10vh auto; }
    .badge { display: inline-block; font-size: 0.75rem; padding: 0.15rem 0.45rem; border: 1px solid var(--ok); color: var(--ok); }
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
    <h1>MCP Mail · Admin</h1>
    <nav>
      <a href="/admin"${active === "accounts" ? ' style="color:var(--text)"' : ""}>Contas</a>
      <a href="/admin/profile"${active === "profile" ? ' style="color:var(--text)"' : ""}>Perfil</a>
      <a href="/admin/logout">Sair</a>
    </nav>
  </header>`;
}

export { esc };
