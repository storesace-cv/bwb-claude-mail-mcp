/** Inline script: wait modal with live job logs (no fake percentage). */
export const waitModalScript = `(function () {
  var PRESETS = {
    mail: {
      lead: "A ler as caixas de correio. A percentagem sobe quando cada conta ou pasta acaba — não inventa tempo.",
      steps: [
        { key: "sync", label: "Ler mensagens novas" },
        { key: "rules", label: "Aplicar regras de pastas" }
      ]
    },
    triage: {
      lead: "A organizar a INBOX. Os passos avançam quando cada conta termina essa fase.",
      steps: [
        { key: "unread", label: "Listar não lidos" },
        { key: "helpdesk", label: "Arquivar helpdesk" },
        { key: "promo", label: "Newsletters e marketing" }
      ]
    },
    wa: {
      lead: "A ler as conversas com vigia.",
      steps: [{ key: "sync", label: "Ler mensagens das vigias" }]
    },
    agt: {
      lead: "A actualizar a base de conhecimento a partir das vigias.",
      steps: [
        { key: "chats", label: "Percorrer conversas" },
        { key: "kb", label: "Escrever na base de conhecimento" }
      ]
    }
  };

  var currentStepKeys = [];
  var lastLogs = "";
  var lastErrs = "";
  var finished = false;

  function $(id) { return document.getElementById(id); }

  function setSteps(activeKey) {
    var el = $("bwb-wait-steps");
    if (!el || !currentStepKeys.length) return;
    var idx = currentStepKeys.indexOf(activeKey);
    el.querySelectorAll("li").forEach(function (li) {
      var ki = currentStepKeys.indexOf(li.getAttribute("data-step"));
      li.classList.remove("active", "done");
      if (idx < 0) return;
      if (ki < idx) li.classList.add("done");
      else if (ki === idx) li.classList.add("active");
    });
  }

  function markAllDone() {
    var el = $("bwb-wait-steps");
    if (!el) return;
    el.querySelectorAll("li").forEach(function (li) {
      li.classList.remove("active");
      li.classList.add("done");
    });
  }

  function render(pct, label, stepKey) {
    var p = Math.min(100, Math.max(0, Math.round(Number(pct) || 0)));
    var b = $("bwb-wait-progress-bar");
    if (b) b.style.width = p + "%";
    var pe = $("bwb-wait-progress-pct");
    if (pe) pe.textContent = p + "%";
    var le = $("bwb-wait-progress-label");
    if (le && label) le.textContent = label;
    if (stepKey) setSteps(stepKey);
  }

  function fillPre(id, lines, emptyText) {
    var el = $(id);
    if (!el) return;
    var text = (lines && lines.length) ? lines.join("\\n") : emptyText;
    if (el.textContent !== text) {
      el.textContent = text;
      el.scrollTop = el.scrollHeight;
    }
    return text;
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function () {});
      return;
    }
    var ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    ta.remove();
  }

  function open(opts) {
    opts = opts || {};
    var bd = $("bwb-wait-modal");
    if (!bd) return;
    var preset = PRESETS[opts.kind] || PRESETS.mail;
    var titleEl = $("bwb-wait-modal-title");
    var leadEl = $("bwb-wait-modal-lead");
    if (titleEl) titleEl.textContent = opts.title || "A processar";
    if (leadEl) leadEl.textContent = preset.lead;
    var el = $("bwb-wait-steps");
    currentStepKeys = [];
    if (el) {
      el.innerHTML = "";
      el.hidden = false;
      el.classList.remove("bwb-wait-steps--hidden");
      preset.steps.forEach(function (s) {
        var li = document.createElement("li");
        li.setAttribute("data-step", s.key);
        li.textContent = s.label;
        el.appendChild(li);
        currentStepKeys.push(s.key);
      });
    }
    bd.classList.add("open");
    bd.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    render(0, "A iniciar…", preset.steps[0] ? preset.steps[0].key : null);
    var copyLog = $("bwb-wait-copy-log");
    var copyErr = $("bwb-wait-copy-err");
    if (copyLog) copyLog.onclick = function () { copyText(lastLogs || ""); };
    if (copyErr) copyErr.onclick = function () { copyText(lastErrs || ""); };
  }

  function poll(id) {
    function tick() {
      if (finished) return;
      fetch("/admin/jobs/run/" + encodeURIComponent(id) + "/status", { credentials: "same-origin", cache: "no-store" })
        .then(function (res) { return res.json().then(function (j) { return { ok: res.ok, j: j }; }); })
        .then(function (pair) {
          var j = pair.j || {};
          if (!pair.ok || j.status === "missing") {
            fillPre("bwb-wait-err", ["Esta corrida já não está na memória (serviço reiniciou ou o processo caiu)."], "");
            lastErrs = "Esta corrida já não está na memória.";
            showDone("/admin/jobs");
            return;
          }
          render(j.pct || 0, j.stepLabel || "A trabalhar…", j.step);
          lastLogs = fillPre("bwb-wait-log", j.logs, "Ainda sem linhas de actividade.");
          var stall = "";
          if (j.status === "running" && j.lastEventAt) {
            var silent = Math.round((Date.now() - Number(j.lastEventAt)) / 1000);
            var beat = $("bwb-wait-beat");
            if (beat) {
              beat.textContent = silent <= 2
                ? "Servidor a responder."
                : "Último sinal há " + silent + " s. Se isto crescer sem linhas novas, o IMAP pode estar lento ou preso.";
            }
            if (silent >= 20) {
              stall = "Sem novas linhas há " + silent + " s. O passo actual ainda não acabou (IMAP lento) ou a ligação ficou presa.";
            }
          }
          var errLines = (j.errors && j.errors.length) ? j.errors.slice() : [];
          if (stall) errLines.push(stall);
          lastErrs = fillPre("bwb-wait-err", errLines, "Sem erros até agora.");
          if (j.status === "running") {
            setTimeout(tick, 1000);
            return;
          }
          if (j.status === "error") {
            render(j.pct || 0, "Falhou.", j.step);
            showDone(location.href);
            return;
          }
          render(100, "Concluído.", j.step);
          markAllDone();
          showDone(location.href);
        })
        .catch(function () { setTimeout(tick, 1500); });
    }
    tick();
  }

  function showDone(href) {
    finished = true;
    var actions = $("bwb-wait-actions");
    var link = $("bwb-wait-done");
    if (actions) actions.hidden = false;
    if (link) link.setAttribute("href", href);
  }

  var root = document.body;
  if (root && root.getAttribute("data-wait-id")) {
    open({
      kind: root.getAttribute("data-wait-kind") || "mail",
      title: root.getAttribute("data-wait-title") || "A processar"
    });
    poll(root.getAttribute("data-wait-id"));
  }
})();
`;
