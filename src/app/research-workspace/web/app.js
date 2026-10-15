const $ = (id) => document.getElementById(id);
let token,
  run,
  events,
  selected = "conclusion",
  startedAt,
  elapsed;
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
  $("symbol").value = run.scope.symbol;
  $("benchmark").value = run.scope.benchmark;
  $("start").value = run.scope.start;
  $("question").value = run.question;
  events?.close();
  startedAt = Date.parse(
    run.events.findLast((e) => e.kind === "continue")?.at ?? run.createdAt,
  );
  clearInterval(elapsed);
  render();
  if (run.status === "running") {
    events = new EventSource(`/api/runs/${run.id}/events`);
    events.onmessage = (e) => {
      run = JSON.parse(e.data);
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
async function studies() {
  const values = await api("/api/studies");
  $("studies").replaceChildren();
  for (const value of values) {
    const b = el(
      "button",
      `${value.scope.symbol} · ${value.scope.end}\n${value.parentId ? "复核版本" : "初次研究"}`,
    );
    b.onclick = () => api(`/api/runs/${value.id}`).then(follow).catch(error);
    $("studies").append(b);
  }
}
function renderProgress() {
  if (!run) return;
  $("progress").replaceChildren();
  const state = el(
    "div",
    `${{ running: "研究进行中", complete: "研究完成", cancelled: "研究已停止", failed: "研究未完成", needs_input: "需要澄清" }[run.status]}${run.status === "running" ? ` · 已等待 ${Math.floor((Date.now() - startedAt) / 1000)} 秒` : ""}`,
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
  renderProgress();
  $("alert").textContent = run.error || run.clarification || "";
  $("submit").disabled = run.status === "running";
  $("new").disabled = run.status === "running";
  document.querySelectorAll("#studies button").forEach((b) => {
    b.disabled = run.status === "running";
  });
  $("cancel").hidden = run.status !== "running";
  $("continue").hidden = !["cancelled", "failed"].includes(run.status);
  $("save").hidden = run.status !== "complete" || run.saved;
  $("review").hidden = !run.saved;
  $("answer").replaceChildren();
  if (run.answer) {
    $("answer").append(
      el(
        "p",
        `${run.scope.symbol} · ${run.scope.start} — ${run.scope.end} · ${run.model}`,
        "small",
      ),
      el("h2", run.answer.summary),
      el("p", `${run.answer.signal} · ${run.answer.classification}`, "status"),
    );
    const list = el("ol");
    for (const claim of run.answer.claims) {
      const li = el("li", claim.text);
      for (const id of claim.evidence) {
        const b = el("button", id, "citation");
        b.onclick = () => {
          selected = "evidence";
          renderInspect(id);
        };
        li.append(b);
      }
      list.append(li);
    }
    $("answer").append(
      list,
      el(
        "p",
        "模型解释 · 引用存在性已检查；不代表结论经过独立语义核验。",
        "small",
      ),
    );
  }
  renderInspect();
}
function card(title, text) {
  const c = el("div", undefined, "card");
  c.append(el("h3", title), el("p", text));
  return c;
}
function renderInspect(focus) {
  document
    .querySelectorAll("[data-tab]")
    .forEach((b) =>
      b.setAttribute("aria-selected", String(b.dataset.tab === selected)),
    );
  const root = $("inspect");
  root.replaceChildren();
  if (!run) {
    root.append(el("h2", "研究将从这里展开"));
    return;
  }
  const calc = run.evidence.find((e) => e.result)?.result;
  if (selected === "conclusion") {
    root.append(el("h2", "判断与边界"));
    if (!run.answer) {
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
        `${run.answer.signal} · ${run.answer.classification}`,
        run.answer.summary,
      ),
    );
    root.append(el("h3", "下一步观察"));
    for (const next of run.answer.next) root.append(el("p", next));
    root.append(el("h3", "证据边界"));
    for (const note of run.answer.limitations)
      root.append(el("p", note, "small disclosure"));
  }
  if (selected === "chart") {
    root.append(el("h2", "价格结构与相对表现"));
    const data = run.evidence.find((e) => e.symbol === run.scope.symbol);
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
    svg.setAttribute("aria-label", `${run.scope.symbol} 历史收盘价曲线`);
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
    for (const evidence of run.evidence) {
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
    root.append(
      card(
        run.saved ? "本版本已保存" : "本版本尚未保存",
        `研究 ID ${run.id}。${run.parentId ? `关联原版本 ${run.parentId}；原版本保持不变。` : "首次研究，尚无历史版本对照。"}`,
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
$("research").onsubmit = async (e) => {
  e.preventDefault();
  $("alert").textContent = "";
  try {
    follow(
      await api("/api/runs", {
        question: $("question").value,
        scope: {
          symbol: $("symbol").value,
          benchmark: $("benchmark").value,
          start: $("start").value,
          end: $("end").value,
        },
      }),
    );
  } catch (e) {
    error(e);
  }
};
for (const action of ["cancel", "continue", "save", "review"])
  $(action).onclick = async () => {
    try {
      follow(
        await api(
          `/api/runs/${run.id}/${action}`,
          action === "review" ? { end: $("end").value } : {},
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
  $("answer").replaceChildren();
  $("progress").replaceChildren();
  $("alert").textContent = "";
  for (const id of ["save", "review", "cancel", "continue"])
    $(id).hidden = true;
  $("submit").disabled = false;
  renderInspect();
  $("question").focus();
};
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === "g" && run?.status === "running") {
    e.preventDefault();
    $("cancel").click();
  }
});
try {
  const status = await api("/api/status");
  token = status.token;
  await studies();
  if (status.current) follow(await api(`/api/runs/${status.current}`));
} catch (e) {
  error(e);
}
