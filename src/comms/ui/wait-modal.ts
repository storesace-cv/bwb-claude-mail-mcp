/** Inline script: wait modal with steps + progress (BwbWait pattern). */
export const waitModalScript = `(function () {
  var backdrop = function () { return document.getElementById("bwb-wait-modal"); };
  var bar = function () { return document.getElementById("bwb-wait-progress-bar"); };
  var pctEl = function () { return document.getElementById("bwb-wait-progress-pct"); };
  var labelEl = function () { return document.getElementById("bwb-wait-progress-label"); };
  var titleEl = function () { return document.getElementById("bwb-wait-modal-title"); };
  var leadEl = function () { return document.getElementById("bwb-wait-modal-lead"); };
  var stepsEl = function () { return document.getElementById("bwb-wait-steps"); };
  var timer = null;
  var startedAt = 0;
  var simPhaseLabels = [];
  var currentStepKeys = [];

  var PRESETS = {
    mail: {
      lead: "A ler as caixas de correio. Pode demorar uns minutos — a app continua a trabalhar.",
      steps: [
        { key: "sync", label: "Ler mensagens novas" },
        { key: "rules", label: "Aplicar regras de pastas" },
        { key: "finish", label: "Finalizar" }
      ],
      phases: [
        { max: 45, label: "A ler as caixas…", step: "sync" },
        { max: 82, label: "A aplicar regras de pastas…", step: "rules" },
        { max: 92, label: "A finalizar…", step: "finish" }
      ]
    },
    triage: {
      lead: "A organizar a INBOX. Pode demorar — não feche esta janela.",
      steps: [
        { key: "unread", label: "Listar não lidos" },
        { key: "helpdesk", label: "Arquivar helpdesk" },
        { key: "promo", label: "Newsletters e marketing" },
        { key: "finish", label: "Finalizar" }
      ],
      phases: [
        { max: 28, label: "A listar não lidos…", step: "unread" },
        { max: 58, label: "A arquivar helpdesk…", step: "helpdesk" },
        { max: 82, label: "A tratar newsletters…", step: "promo" },
        { max: 92, label: "A finalizar…", step: "finish" }
      ]
    },
    wa: {
      lead: "A ler as conversas com vigia. Aguarde.",
      steps: [
        { key: "sync", label: "Ler mensagens das vigias" },
        { key: "finish", label: "Finalizar" }
      ],
      phases: [
        { max: 75, label: "A ler o WhatsApp…", step: "sync" },
        { max: 92, label: "A finalizar…", step: "finish" }
      ]
    },
    agt: {
      lead: "A actualizar a base de conhecimento a partir das vigias. Pode demorar.",
      steps: [
        { key: "chats", label: "Percorrer conversas" },
        { key: "kb", label: "Escrever na base de conhecimento" },
        { key: "finish", label: "Finalizar" }
      ],
      phases: [
        { max: 40, label: "A percorrer conversas…", step: "chats" },
        { max: 82, label: "A actualizar a KB…", step: "kb" },
        { max: 92, label: "A finalizar…", step: "finish" }
      ]
    }
  };

  function setSteps(activeKey) {
    var el = stepsEl();
    if (!el || !currentStepKeys.length) return;
    var idx = currentStepKeys.indexOf(activeKey);
    el.querySelectorAll("li").forEach(function (li) {
      var ki = currentStepKeys.indexOf(li.getAttribute("data-step"));
      li.classList.remove("active", "done");
      if (ki < idx) li.classList.add("done");
      else if (ki === idx) li.classList.add("active");
    });
  }

  function render(pct, label, stepKey) {
    var p = Math.min(100, Math.max(0, Math.round(pct)));
    var b = bar();
    if (b) b.style.width = p + "%";
    var pe = pctEl();
    if (pe) pe.textContent = p + "%";
    if (labelEl() && label) labelEl().textContent = label;
    if (stepKey) setSteps(stepKey);
  }

  function tickSimulated() {
    var elapsed = Date.now() - startedAt;
    var target = 12 + elapsed / 45;
    if (elapsed > 4000) target = 55 + (elapsed - 4000) / 120;
    if (elapsed > 12000) target = 78 + (elapsed - 12000) / 200;
    target = Math.min(92, target);
    var phase = simPhaseLabels.find(function (ph) { return target <= ph.max; }) || simPhaseLabels[simPhaseLabels.length - 1];
    if (phase) render(target, phase.label, phase.step);
  }

  function buildStepsList(steps) {
    var el = stepsEl();
    currentStepKeys = [];
    if (!el) return;
    el.innerHTML = "";
    if (!steps || !steps.length) {
      el.hidden = true;
      el.classList.add("bwb-wait-steps--hidden");
      return;
    }
    el.hidden = false;
    el.classList.remove("bwb-wait-steps--hidden");
    steps.forEach(function (s) {
      var li = document.createElement("li");
      li.setAttribute("data-step", s.key);
      li.textContent = s.label;
      el.appendChild(li);
      currentStepKeys.push(s.key);
    });
  }

  function open(opts) {
    opts = opts || {};
    var bd = backdrop();
    if (!bd) return;
    var preset = PRESETS[opts.kind] || PRESETS.mail;
    if (titleEl()) titleEl().textContent = opts.title || "A processar";
    if (leadEl()) leadEl().textContent = opts.lead || preset.lead;
    simPhaseLabels = preset.phases;
    buildStepsList(preset.steps);
    startedAt = Date.now();
    bd.classList.add("open");
    bd.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    var first = simPhaseLabels[0];
    render(0, first ? first.label : "A iniciar…", first ? first.step : null);
    if (timer) clearInterval(timer);
    timer = setInterval(tickSimulated, 120);
  }

  function complete(label) {
    if (timer) { clearInterval(timer); timer = null; }
    var last = currentStepKeys.length ? currentStepKeys[currentStepKeys.length - 1] : null;
    render(100, label || "Concluído.", last);
  }

  function poll(id) {
    function tick() {
      fetch("/admin/jobs/run/" + encodeURIComponent(id) + "/status", { credentials: "same-origin", cache: "no-store" })
        .then(function (res) { return res.json().then(function (j) { return { ok: res.ok, j: j }; }); })
        .then(function (pair) {
          if (!pair.ok || pair.j.status === "missing") {
            complete("Esta corrida já não está disponível.");
            setTimeout(function () { location.href = "/admin/jobs"; }, 800);
            return;
          }
          if (pair.j.status === "running") {
            setTimeout(tick, 1500);
            return;
          }
          complete(pair.j.status === "error" ? "Falhou." : "Concluído.");
          setTimeout(function () { location.reload(); }, 600);
        })
        .catch(function () { setTimeout(tick, 2000); });
    }
    tick();
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
