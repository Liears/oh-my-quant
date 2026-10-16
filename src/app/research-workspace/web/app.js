const $ = (id) => document.getElementById(id);
let token,
  run,
  events,
  selected = "conclusion",
  startedAt,
  elapsed,
  inspection,
  submitting = false,
  currentProjectId = null,
  activeStudyId = null;
const collapsedProjects = new Set();
function getCustomProjects() {
  try {
    const raw = localStorage.getItem("whyj_projects_v1");
    if (raw) return JSON.parse(raw);
  } catch {}
  return [
    { id: "002048.SZ", name: "002048.SZ 结构跟踪", symbol: "002048.SZ", benchmark: "000300.SH" }
  ];
}
function saveCustomProjects(list) {
  try {
    localStorage.setItem("whyj_projects_v1", JSON.stringify(list));
  } catch {}
}
const date = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Shanghai",
}).format(new Date());
$("end").value = date;
$("end").max = date;
$("start").value = `${date.slice(0, 4)}-01-01`;
const el = (tag, text, cls) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (cls) node.className = cls;
  return node;
};
const num = (n) =>
  n === null || n === undefined ? "证据不足" : Number(n).toFixed(2);
async function api(path, body) {
  const response = await fetch(
    path,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Workspace-Token": token,
          },
          body: JSON.stringify(body),
        },
  );
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "请求失败");
  return value;
}
function error(e) {
  $("alert").textContent = e.message;
}
function follow(value) {
  run = value;
  activeStudyId = run.id;
  $("symbol").value = run.scope.symbol;
  $("benchmark").value = run.scope.benchmark;
  $("start").value = run.scope.start;
  $("end").value = run.scope.end;
  inspection = null;
  events?.close();
  startedAt = Date.parse(
    run.events.findLast((e) => e.kind === "continue")?.at ?? run.createdAt,
  );
  clearInterval(elapsed);
  updateBreadcrumb(null, run);
  render();
  updateActiveStudyUi();
  if (run.status === "running") {
    const watchedId = run.id;
    events = new EventSource(`/api/runs/${run.id}/events`);
    events.onmessage = (e) => {
      const value = JSON.parse(e.data);
      if (run?.id !== watchedId || value.id !== watchedId) return;
      run = value;
      render();
      if (run.status !== "running") {
        events.close();
        clearInterval(elapsed);
      }
    };
    events.onerror = () => {
      $("alert").textContent = "进度连接暂时中断，正在重连；不会停止后台研究。";
    };
    elapsed = setInterval(renderProgress, 1000);
  }
}
function updateBreadcrumb(project, currentRun) {
  if (!project && currentRun) {
    const projects = getCustomProjects();
    project = projects.find((p) => p.symbol === currentRun.scope.symbol);
  }
  if (project) {
    if ($("bc-project")) $("bc-project").textContent = "📁 " + project.name;
    currentProjectId = project.id;
  } else {
    if ($("bc-project")) $("bc-project").textContent = "全部项目";
  }
  if (currentRun) {
    const q = currentRun.question.replace(/\s+/g, " ");
    if ($("bc-study"))
      $("bc-study").textContent = "📄 " + (q.length > 20 ? q.slice(0, 20) + "…" : q);
  } else {
    if ($("bc-study")) $("bc-study").textContent = "＋ 新建研究";
  }
}
function updateActiveStudyUi() {
  document.querySelectorAll(".study-item").forEach((btn) => {
    const isAct =
      run &&
      (btn.dataset.studyId === run.id ||
        btn.dataset.studyId === run.conversationId ||
        activeStudyId === btn.dataset.studyId);
    btn.classList.toggle("active-study", Boolean(isAct));
  });
  document.querySelectorAll(".project-folder").forEach((f) => {
    const isAct = f.dataset.projectId === currentProjectId;
    f.classList.toggle("active-project", Boolean(isAct));
  });
}
function startNewResearchInProject(project) {
  if (run?.status === "running") {
    error(new Error("当前研究仍在运行，请先停止或等待完成。"));
    return;
  }
  events?.close();
  run = null;
  inspection = null;
  activeStudyId = null;
  currentProjectId = project.id;
  collapsedProjects.delete(project.id);

  $("question").value = "";
  $("composer-label").textContent = `在「${project.name}」项目中发起研究`;
  $("question").placeholder = `针对 ${project.symbol} 提出研究问题（如回撤结构、量比或均线）…`;
  $("composer-hint").textContent = "Enter 发送 · Shift+Enter 换行";

  for (const id of ["symbol", "benchmark", "start", "end"])
    $(id).disabled = false;
  $("symbol").value = project.symbol;
  if (project.benchmark) $("benchmark").value = project.benchmark;
  $("end").value = date;

  document.body.classList.remove("has-run");
  $("answer").replaceChildren();
  $("progress").replaceChildren();
  $("alert").textContent = "";
  for (const id of ["save", "review", "cancel", "continue"])
    $(id).hidden = true;
  $("submit").disabled = false;

  updateBreadcrumb(project, null);
  studies();
  renderInspect();
  $("question").focus();
}
async function studies() {
  const values = await api("/api/studies");
  $("studies").replaceChildren();
  const latest = new Map();
  for (const value of values)
    if (!latest.has(value.conversationId ?? value.id))
      latest.set(value.conversationId ?? value.id, value);
  const allStudies = Array.from(latest.values());

  const projects = getCustomProjects();
  for (const s of allStudies) {
    const sym = s.scope.symbol;
    if (!projects.some((p) => p.symbol === sym)) {
      projects.push({
        id: sym,
        name: `${sym} 专题跟踪`,
        symbol: sym,
        benchmark: s.scope.benchmark || "000300.SH",
      });
    }
  }
  saveCustomProjects(projects);
  if ($("projects-count"))
    $("projects-count").textContent = String(projects.length);

  for (const project of projects) {
    const projectStudies = allStudies.filter(
      (s) => s.scope.symbol === project.symbol,
    );
    const folder = el("div", undefined, "project-folder");
    folder.dataset.projectId = project.id;
    if (collapsedProjects.has(project.id)) {
      folder.classList.add("collapsed");
    }
    if (currentProjectId === project.id) {
      folder.classList.add("active-project");
    }

    const header = el("div", undefined, "project-header");
    const titleGroup = el("div", undefined, "project-title-group");
    const chevron = el("span", "▾", "project-chevron");
    const icon = el(
      "span",
      collapsedProjects.has(project.id) ? "📁" : "📂",
      "project-icon",
    );
    const name = el("span", project.name, "project-name");
    name.title = `${project.name} (${project.symbol})`;
    titleGroup.append(chevron, icon, name);

    const actions = el("div", undefined, "project-actions");
    const count = el("span", String(projectStudies.length), "folder-count");
    const addBtn = el("button", "＋", "btn-add-study");
    addBtn.title = `在「${project.name}」中发起新研究`;
    addBtn.onclick = (e) => {
      e.stopPropagation();
      startNewResearchInProject(project);
    };
    actions.append(count, addBtn);
    header.append(titleGroup, actions);

    header.onclick = () => {
      if (collapsedProjects.has(project.id)) {
        collapsedProjects.delete(project.id);
        folder.classList.remove("collapsed");
        icon.textContent = "📂";
      } else {
        collapsedProjects.add(project.id);
        folder.classList.add("collapsed");
        icon.textContent = "📁";
      }
    };

    const studiesContainer = el("div", undefined, "project-studies");
    if (projectStudies.length === 0) {
      const empty = el("div", "暂无研究 · 点击 ＋ 启动", "empty-project-hint");
      empty.onclick = () => startNewResearchInProject(project);
      empty.style.cursor = "pointer";
      studiesContainer.append(empty);
    } else {
      for (const study of projectStudies) {
        const isActive =
          activeStudyId === study.id ||
          (run && (run.id === study.id || run.conversationId === study.id));
        const item = el(
          "button",
          undefined,
          `study-item ${isActive ? "active-study" : ""}`,
        );
        item.dataset.studyId = study.id;
        const titleText = study.question.replace(/\s+/g, " ");
        const title = el("div", titleText, "study-title");
        const meta = el("div", undefined, "study-meta");
        const turns = el("span", `${study.turns ?? 1} 轮对话`);
        const dateStr = new Date(study.createdAt).toLocaleDateString("zh-CN", {
          month: "numeric",
          day: "numeric",
        });
        const time = el("span", dateStr);
        meta.append(turns, time);
        item.append(title, meta);

        item.onclick = (e) => {
          e.stopPropagation();
          currentProjectId = project.id;
          activeStudyId = study.id;
          api(`/api/runs/${study.id}/latest`)
            .then((loaded) => {
              $("question").value = "";
              follow(loaded);
              updateBreadcrumb(project, loaded);
              updateActiveStudyUi();
            })
            .catch(error);
        };
        studiesContainer.append(item);
      }
    }
    folder.append(header, studiesContainer);
    $("studies").append(folder);
  }
}
function renderProgress() {
  if (!run) return;
  $("progress").replaceChildren();
  const state = el(
    "div",
    `${{ running: "研究进行中", complete: `${run.answer ? "研究完成" : "回复完成"}${run.saved ? " · 已保存" : ""}`, cancelled: "研究已停止", failed: "研究未完成", needs_input: "需要澄清" }[run.status]}${run.status === "running" ? ` · 已等待 ${Math.floor((Date.now() - startedAt) / 1000)} 秒` : ""}`,
    "current",
  );
  $("progress").append(state);
  for (const e of run.events.slice(-5))
    $("progress").append(
      el("div", `${new Date(e.at).toLocaleTimeString()} · ${e.text}`),
    );
}
function render() {
  if (!run) return;
  document.body.classList.add("has-run");
  const thread = $("thread");
  const nearBottom =
    thread.scrollHeight - thread.scrollTop - thread.clientHeight < 90;
  renderProgress();
  $("alert").textContent = run.error || "";
  $("submit").disabled =
    submitting ||
    run.status === "running" ||
    ["cancelled", "failed"].includes(run.status);
  $("new").disabled = run.status === "running";
  $("composer-label").textContent = "继续追问 · 沿用当前研究上下文";
  $("composer-hint").textContent =
    `证据截至 ${run.evidence.find((e) => e.result)?.result.end ?? run.scope.end} · Enter 发送`;
  $("question").placeholder = "追问依据、补充条件，或请我解释某条结论…";
  for (const id of ["symbol", "benchmark", "start", "end"])
    $(id).disabled = true;
  document.querySelectorAll("#studies button").forEach((b) => {
    b.disabled = run.status === "running";
  });
  $("cancel").hidden = run.status !== "running";
  $("continue").hidden = !["cancelled", "failed"].includes(run.status);
  $("save").hidden = run.status !== "complete" || run.saved;
  $("review").hidden = !run.saved;
  $("answer").replaceChildren();
  const turns = [...(run.history ?? []), run];
  turns.forEach((turn, index) => {
    const user = el("article", undefined, "message user-message");
    user.append(
      el("div", `你 · 第 ${index + 1} 轮`, "message-role"),
      el("p", turn.question),
    );
    const assistant = el("article", undefined, "message assistant-message");
    assistant.append(el("div", "▥ WhyJ", "message-role"));
    if (turn.answer) {
      assistant.append(el("p", turn.answer.summary, "reply-summary"));
      const detail = el("details"),
        list = el("ol");
      detail.append(
        el("summary", `展开 ${turn.answer.claims.length} 条论据与引用`),
      );
      for (const claim of turn.answer.claims) {
        const li = el("li", claim.text);
        for (const id of claim.evidence) {
          const button = el("button", id, "citation");
          button.onclick = () => {
            inspection = { ...run, ...turn };
            selected = "evidence";
            renderInspect(id);
            showInspector();
          };
          li.append(button);
        }
        list.append(li);
      }
      detail.append(list);
      assistant.append(detail);
      const inspect = el("button", "查看本轮研究 →", "inspect-turn");
      inspect.onclick = () => {
        inspection = { ...run, ...turn };
        selected = "conclusion";
        renderInspect();
        showInspector();
      };
      assistant.append(
        inspect,
        el("p", "模型解释 · 引用存在性已检查，语义未经独立核验。", "small"),
      );
    } else if (turn.reply) {
      assistant.append(
        el("p", turn.reply, "reply-summary"),
        el("p", "对话解释 · 沿用原证据，未发布新的研究结论。", "small"),
      );
    } else
      assistant.append(
        el(
          "p",
          turn.clarification ||
            turn.error ||
            (turn.status === "running"
              ? "正在思考与回复，可以先在下面写好下一条问题。"
              : "本轮已停止，已取得的证据仍保留。"),
        ),
      );
    if (turn.events.length && turn.id !== run.id) {
      const progress = el("details");
      progress.append(el("summary", "本轮过程"));
      for (const event of turn.events)
        progress.append(el("p", event.text, "small"));
      assistant.append(progress);
    }
    $("answer").append(user, assistant);
  });
  renderInspect();
  if (nearBottom)
    requestAnimationFrame(() => {
      thread.scrollTop = thread.scrollHeight;
    });
}
function showInspector() {
  if (matchMedia("(max-width: 900px)").matches) {
    document.querySelector(".workspace").classList.add("inspector-open");
    $("toggle-inspector").textContent = "回到对话";
    $("toggle-inspector").setAttribute("aria-expanded", "true");
  }
}
function card(title, text) {
  const c = el("div", undefined, "card");
  c.append(el("h3", title), el("p", text));
  return c;
}
function renderInspect(focus) {
  let viewed = inspection ?? run;
  if (!inspection && viewed && !viewed.answer) {
    const research = viewed.history?.findLast((turn) => turn.answer);
    if (research) viewed = { ...viewed, ...research };
  }
  $("inspection-context").textContent = viewed
    ? `${viewed.scope.symbol} · ${viewed.scope.benchmark} · ${viewed.scope.start} — ${viewed.scope.end}。本轮：${viewed.question.slice(0, 80)}`
    : "与对话关联的研究结果";
  document
    .querySelectorAll("[data-tab]")
    .forEach((b) =>
      b.setAttribute("aria-selected", String(b.dataset.tab === selected)),
    );
  const root = $("inspect");
  root.replaceChildren();
  if (!viewed) {
    root.append(el("h2", "研究将从这里展开"));
    return;
  }
  const calc = viewed.evidence.find((e) => e.result)?.result;
  if (selected === "conclusion") {
    root.append(el("h2", "判断与边界"));
    if (!viewed.answer) {
      root.append(
        el(
          "p",
          "Agent 正在收集证据。完成后，这里将呈现结构判断、下一步观察条件和证据缺口。",
        ),
      );
      return;
    }
    root.append(
      card(
        `${viewed.answer.signal} · ${viewed.answer.classification}`,
        viewed.answer.summary,
      ),
    );
    root.append(el("h3", "下一步观察"));
    for (const next of viewed.answer.next) root.append(el("p", next));
    root.append(el("h3", "证据边界"));
    for (const note of viewed.answer.limitations)
      root.append(el("p", note, "small disclosure"));
  }
  if (selected === "chart") {
    root.append(el("h2", "价格结构与相对表现"));
    const data = viewed.evidence.find((e) => e.symbol === viewed.scope.symbol);
    if (!data) {
      root.append(el("p", "等待真实日线证据。"));
      return;
    }
    root.append(
      el(
        "p",
        `${data.bars[0].date} — ${data.bars.at(-1).date} · 前复权收盘价`,
        "small",
      ),
    );
    const bars = data.bars,
      prices = bars.map((b) => b.close),
      lo = Math.min(...prices),
      hi = Math.max(...prices);
    const ns = "http://www.w3.org/2000/svg",
      svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 600 240");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `${viewed.scope.symbol} 历史收盘价曲线`);
    const p = document.createElementNS(ns, "polyline");
    p.setAttribute(
      "points",
      prices
        .map(
          (v, i) =>
            `${20 + (i * 560) / Math.max(1, prices.length - 1)},${220 - ((v - lo) * 190) / (hi - lo || 1)}`,
        )
        .join(" "),
    );
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", "#d4af37");
    p.setAttribute("stroke-width", "2");
    svg.append(p);
    for (const [y, value] of [
      [20, hi],
      [220, lo],
    ]) {
      const t = document.createElementNS(ns, "text");
      t.setAttribute("x", "20");
      t.setAttribute("y", String(y));
      t.setAttribute("fill", "#aaa");
      t.textContent = num(value);
      svg.append(t);
    }
    root.append(svg);
    if (calc) {
      const stats = el("div", undefined, "stats");
      for (const [label, value] of [
        ["最新收盘", num(calc.close)],
        ["区间收益", `${num(calc.returnPct)}%`],
        ["最大回撤", `${num(calc.drawdownPct)}%`],
        ["相对基准收益差", `${num(calc.relativeReturnPp)} 个百分点`],
        ["MA20 / MA60", `${num(calc.ma20)} / ${num(calc.ma60)}`],
        ["前20日中位量比", num(calc.volumeRatio)],
      ]) {
        const c = el("div", undefined, "stat");
        c.append(el("span", label), el("strong", value));
        stats.append(c);
      }
      root.append(
        stats,
        el(
          "p",
          "收益差使用股票与基准共同日期的首尾收盘价；量比不含当日。",
          "small",
        ),
      );
    }
  }
  if (selected === "evidence") {
    root.append(el("h2", "可追溯、可复算的证据"));
    for (const evidence of viewed.evidence) {
      const c = card(
        `${evidence.id} · ${evidence.symbol || "确定性计算"}`,
        `${evidence.source} · 获取于 ${new Date(evidence.fetchedAt).toLocaleString()}`,
      );
      c.id = evidence.id;
      c.append(el("code", `SHA-256 ${evidence.contentHash}`));
      if (evidence.result)
        c.append(
          el("pre", JSON.stringify(evidence.result, null, 2), "scroll small"),
        );
      if (evidence.bars) {
        const d = el("details"),
          summary = el(
            "summary",
            `查看 ${evidence.bars.length} 条原始日线 · ${evidence.adjustment}`,
          ),
          wrap = el("div", undefined, "scroll"),
          table = el("table"),
          head = el("tr");
        for (const h of ["日期", "开", "高", "低", "收", "量"])
          head.append(el("th", h));
        table.append(head);
        for (const b of evidence.bars) {
          const tr = el("tr");
          for (const v of [b.date, b.open, b.high, b.low, b.close, b.volume])
            tr.append(el("td", String(v)));
          table.append(tr);
        }
        wrap.append(table);
        d.append(summary, wrap);
        c.append(d);
      }
      root.append(c);
    }
    root.append(
      el(
        "p",
        "哈希用于检测快照变化，不证明来源本身真实；数据与模型语义仍有独立边界。",
        "small",
      ),
    );
    if (focus)
      requestAnimationFrame(() =>
        $(focus)?.scrollIntoView({ behavior: "smooth", block: "center" }),
      );
  }
  if (selected === "review") {
    root.append(el("h2", "保存判断，复核变化"));
    const label = el("label", "复核截至日期");
    const cutoff = el("input");
    cutoff.id = "review-end";
    cutoff.type = "date";
    cutoff.value = date;
    cutoff.max = date;
    cutoff.min = viewed.scope.end;
    label.append(cutoff);
    root.append(label);
    root.append(
      card(
        viewed.id !== run.id
          ? "历史研究轮次"
          : viewed.saved
            ? "本版本已保存"
            : "本版本尚未保存",
        `研究 ID ${viewed.id}。${viewed.parentId ? `关联原版本 ${viewed.parentId}；原版本保持不变。` : "首次研究，尚无历史版本对照。"}`,
      ),
    );
    if (calc) {
      root.append(
        card(
          "当前观察边界",
          `${calc.structuralLow.date} 的近20日低点 ${num(calc.structuralLow.price)}，只是观察参考。`,
        ),
      );
      if (calc.comparison)
        root.append(
          card(
            "证据变化",
            `${calc.comparison.previousEnd ?? "无前一版本"} → ${calc.comparison.newEnd}。${calc.comparison.advanced ? "覆盖日期已推进。" : "没有新日线加入。"}${calc.comparison.previousEnd && !calc.comparison.comparable ? "历史覆盖或复权口径不一致，不能直接比较旧边界。" : ""}`,
          ),
        );
      if (calc.previousBoundary)
        root.append(
          card(
            "原版本边界",
            `${calc.previousBoundary.date} · ${num(calc.previousBoundary.price)}；历史修订 ${calc.historicalRevisions.length} 日。`,
          ),
        );
    }
    root.append(
      el(
        "p",
        "保存后可重新取证复核。若新旧覆盖日期相同，会明确显示证据未推进；不制造新进展。",
      ),
    );
  }
}
$("research").onsubmit = async (event) => {
  event.preventDefault();
  if (submitting || run?.status === "running") return;
  const question = $("question").value;
  if (!question.trim()) return;
  $("alert").textContent = "";
  submitting = true;
  $("submit").disabled = true;
  try {
    const value = run
      ? await api(`/api/runs/${run.id}/followup`, { question })
      : await api("/api/runs", {
          question,
          scope: {
            symbol: $("symbol").value,
            benchmark: $("benchmark").value,
            start: $("start").value,
            end: $("end").value,
          },
        });
    if ($("question").value === question) $("question").value = "";
    follow(value);
    $("thread").scrollTop = $("thread").scrollHeight;
  } catch (e) {
    error(e);
  } finally {
    submitting = false;
    $("submit").disabled =
      run?.status === "running" ||
      ["cancelled", "failed"].includes(run?.status);
  }
};
$("question").addEventListener("keydown", (event) => {
  if (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.isComposing &&
    event.keyCode !== 229
  ) {
    event.preventDefault();
    $("research").requestSubmit();
  }
});
$("toggle-inspector").onclick = () => {
  const open = document
    .querySelector(".workspace")
    .classList.toggle("inspector-open");
  $("toggle-inspector").textContent = open ? "回到对话" : "研究面板";
  $("toggle-inspector").setAttribute("aria-expanded", String(open));
};
for (const action of ["cancel", "continue", "save", "review"])
  $(action).onclick = async () => {
    try {
      follow(
        await api(
          `/api/runs/${run.id}/${action}`,
          action === "review" ? { end: $("review-end")?.value ?? date } : {},
        ),
      );
      if (action === "save") await studies();
    } catch (e) {
      error(e);
    }
  };
document.querySelectorAll("[data-tab]").forEach(
  (b) =>
    (b.onclick = () => {
      selected = b.dataset.tab;
      renderInspect();
    }),
);
$("new").onclick = () => {
  if (run?.status === "running") {
    error(new Error("当前研究仍在运行，请先停止或等待完成。"));
    return;
  }
  events?.close();
  run = null;
  inspection = null;
  activeStudyId = null;
  currentProjectId = null;
  $("question").value = "";
  $("composer-label").textContent = "和 WhyJ 聊聊你的研究问题";
  $("question").placeholder = "输入一个明确的投资研究问题…";
  $("composer-hint").textContent = "Enter 发送 · Shift+Enter 换行";
  for (const id of ["symbol", "benchmark", "start", "end"])
    $(id).disabled = false;
  $("symbol").value = "002048.SZ";
  $("benchmark").value = "000300.SH";
  $("end").value = date;
  document.body.classList.remove("has-run");
  $("answer").replaceChildren();
  $("progress").replaceChildren();
  $("alert").textContent = "";
  for (const id of ["save", "review", "cancel", "continue"])
    $(id).hidden = true;
  $("submit").disabled = false;
  updateBreadcrumb(null, null);
  updateActiveStudyUi();
  renderInspect();
  $("question").focus();
};
$("new-project").onclick = () => {
  if (run?.status === "running") {
    error(new Error("当前研究仍在运行，请先停止或等待完成。"));
    return;
  }
  const form = $("project-form");
  form.hidden = !form.hidden;
  if (!form.hidden) {
    $("new-project-symbol").value = "";
    $("new-project-name").value = "";
    $("new-project-symbol").focus();
  }
};
$("cancel-project").onclick = () => {
  $("project-form").hidden = true;
};
$("project-form").onsubmit = (e) => {
  e.preventDefault();
  const rawSymbol = $("new-project-symbol").value.trim().toUpperCase();
  const rawName = $("new-project-name").value.trim();
  const regex = /^(?:00[0-3]|60[0-3]|605)\d{3}\.(?:SH|SZ)$/;
  if (!regex.test(rawSymbol)) {
    error(new Error("标的代码须为沪深主板格式，如 002048.SZ 或 600519.SH"));
    return;
  }
  const projects = getCustomProjects();
  if (projects.some((p) => p.symbol === rawSymbol)) {
    error(new Error(`标的 ${rawSymbol} 的项目已存在`));
    return;
  }
  const newProj = {
    id: rawSymbol,
    name: rawName || `${rawSymbol} 专题跟踪`,
    symbol: rawSymbol,
    benchmark: "000300.SH",
  };
  projects.push(newProj);
  saveCustomProjects(projects);
  $("project-form").hidden = true;
  startNewResearchInProject(newProj);
};
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === "g" && run?.status === "running") {
    e.preventDefault();
    $("cancel").click();
  }
});
function initAsideResizer() {
  const aside = document.querySelector("aside");
  const resizer = $("aside-resizer");
  if (!aside || !resizer) return;

  const savedWidth = localStorage.getItem("whyj_aside_width");
  if (savedWidth) {
    const w = parseInt(savedWidth, 10);
    if (!isNaN(w) && w >= 210 && w <= 500) {
      aside.style.width = `${w}px`;
    }
  }

  let isResizing = false;
  let startX = 0;
  let startWidth = 0;

  resizer.addEventListener("mousedown", (e) => {
    isResizing = true;
    startX = e.clientX;
    startWidth = aside.getBoundingClientRect().width;
    resizer.classList.add("resizing");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMouseMove = (moveEvent) => {
      if (!isResizing) return;
      const dx = moveEvent.clientX - startX;
      let newWidth = startWidth + dx;
      if (newWidth < 210) newWidth = 210;
      if (newWidth > 500) newWidth = 500;
      aside.style.width = `${newWidth}px`;
    };

    const onMouseUp = () => {
      if (!isResizing) return;
      isResizing = false;
      resizer.classList.remove("resizing");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      localStorage.setItem("whyj_aside_width", String(parseInt(aside.style.width, 10)));
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });

  resizer.addEventListener("dblclick", () => {
    aside.style.width = "268px";
    localStorage.setItem("whyj_aside_width", "268px");
  });
}
try {
  const status = await api("/api/status");
  token = status.token;
  initAsideResizer();
  await studies();
  if (status.current) {
    $("question").value = "";
    follow(await api(`/api/runs/${status.current}`));
  }
} catch (e) {
  error(e);
}
