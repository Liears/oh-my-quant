/**
 * HTML template — dual-column TUI layout:
 *   Header | Conversation (left) | Analytics dock (right) | Status bar
 * ECharts CDN for interactive charts, Chart/Raw toggle, table sorting, theme toggle.
 */

import { artifactThemeCss } from "./theme.ts";

export interface ArtifactTemplateInput {
  title: string; sessionId: string; model?: string; quantModel?: string; messageCount: number;
  createdAt: string; dashboardHtml?: string; bodyHtml: string; dockHtml: string; trajectoryHtml: string; generatedAt: string;
  /** External reference URLs (雪球, 同花顺, etc.) */
  sourceUrls?: { label: string; url: string }[];
}

export function renderArtifactTemplate(input: ArtifactTemplateInput): string {
  const theme = artifactThemeCss();
  const js = artifactScript();

  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="generator" content="WhyJ Quant Artifacts">
<title>${esc(input.title)} — WhyJ Quant</title>
<style>${theme}</style>
<script src="https://cdn.jsdelivr.net/npm/echarts@5.6.0/dist/echarts.min.js"></script>
</head>
<body>
<div class="ambient-grid"></div>
<div class="app">

<header class="app-hdr">
  <div class="brand-lockup"><span class="brand-mark">WJ</span><span><b>WHYJ QUANT</b><small>RESEARCH SYSTEM</small></span></div>
  <span class="hdr-sp"></span>
  <nav class="app-tabs">
    <button class="tab-btn on" data-tab="dash">Dashboard</button>
    <button class="tab-btn" data-tab="traj">Trajectory</button>
  </nav>
  <span class="hdr-sp"></span>
  <span class="market-status"><i></i> REPORT READY</span>
  <button class="thm-btn" onclick="toggleTheme()" aria-label="Toggle theme">◐</button>
</header>

<main class="tab-panel dashboard-shell" id="tab-dash">
  <section class="report-hero">
    <div class="hero-copy">
      <div class="hero-kicker"><span>INVESTMENT INTELLIGENCE</span><span>${esc(input.createdAt.slice(0,10))}</span></div>
      <h1>${esc(input.title)}</h1>
      <p>基于会话证据、量化工具与模型推理生成的可审计研究报告。</p>
      <div class="hero-meta">
        <span><b>${input.messageCount}</b> messages</span>
        <span><b>${esc(input.model || "ai")}</b> model</span>
        <span><b>${esc(input.sessionId.slice(0,8))}</b> session</span>
      </div>
    </div>
    <div class="hero-sigil" aria-hidden="true"><span>WHYJ</span><b>Q</b><small>QUANT RESEARCH</small></div>
  </section>
  <section class="command-center"><div class="section-label"><span>01</span> RESEARCH COMMAND CENTER</div>${input.dashboardHtml ?? ""}</section>
  <div class="app-main">
    <section class="app-conv"><div class="section-label"><span>02</span> RESEARCH NARRATIVE</div><div class="conv-inner">${input.bodyHtml}</div></section>
    <aside class="app-dock"><div class="section-label"><span>03</span> ANALYTICS</div>${input.dockHtml}</aside>
  </div>
</main>

<main class="tab-panel trajectory-shell" id="tab-traj" style="display:none">
  <section class="trajectory-head"><div><span class="eyebrow">EXECUTION AUDIT</span><h2>Research trajectory</h2><p>从请求、工具调用到最终观察的完整证据链。</p></div><span class="session-stamp">${esc(input.sessionId)}</span></section>
  <section class="app-conv app-conv-full"><div class="conv-inner">${input.trajectoryHtml}</div></section>
</main>

<footer class="app-st">
  <span class="st-dot"></span>
  <span>WHYJ / ${esc(input.quantModel || "whyj-quant")}</span>
  <span class="st-sp"></span>
  <span>GENERATED ${esc(input.generatedAt.slice(0,19).replace("T", " "))}</span>
</footer>

</div>
<script>${js}</script>
</body>
</html>`;
}

function artifactScript(): string {
  return `
(function(W,D){
'use strict';
var ttEl=null;

function tt(){if(!ttEl){ttEl=D.createElement('div');ttEl.className='whyj-tt';D.body.appendChild(ttEl);}return ttEl;}

/* Tabs */
function activateTab(tab,updateHash){
  if(tab!=='dash'&&tab!=='traj')return;
  D.querySelectorAll('.tab-btn').forEach(function(x){x.classList.toggle('on',x.getAttribute('data-tab')===tab);});
  D.querySelectorAll('.tab-panel').forEach(function(p){p.style.display=p.id==='tab-'+tab?'':'none';});
  if(updateHash){try{history.replaceState(null,'','#'+tab);}catch(e){W.location.hash=tab;}}
  setTimeout(function(){
    if(typeof echarts==='undefined')return;
    var cs=D.querySelectorAll('.tab-panel:not([style*=\"display:none\"]) .ec-box > div > [id]');
    cs.forEach(function(d){var i=echarts.getInstanceByDom(d);if(i)i.resize();});
  },100);
}
D.querySelectorAll('.tab-btn').forEach(function(b){
  b.addEventListener('click',function(){
    var tab=b.getAttribute('data-tab');if(!tab)return;
    activateTab(tab,true);
  });
});
activateTab(W.location.hash==='#traj'?'traj':'dash',false);

/* Theme */
W.toggleTheme=function(){
  var h=D.documentElement,n=h.getAttribute('data-theme')==='dark'?'light':'dark';
  h.setAttribute('data-theme',n);
  try{localStorage.setItem('whyj-thm',n)}catch(e){}
  setTimeout(function(){
    var cs=D.querySelectorAll('.tab-panel:not([style*=\"display:none\"]) .ec-box > div > [id]');
    cs.forEach(function(d){var i=echarts.getInstanceByDom(d);if(i)i.resize();});
  },100);
};
try{var s=localStorage.getItem('whyj-thm');if(s==='light')D.documentElement.setAttribute('data-theme','light');}catch(e){}

/* Chart/Raw toggle */
W.toggleView=function(btn,mode){
  var box=btn.closest('.ec-box');if(!box)return;
  var body=box.querySelector('.ec-body'),raw=box.querySelector('.ec-raw');
  var btns=box.querySelectorAll('.tgl-btn');
  btns.forEach(function(b){b.classList.remove('on');});
  btn.classList.add('on');
  if(mode==='chart'){body.style.display='';raw.style.display='none';}
  else{body.style.display='none';raw.style.display='';}
  if(mode==='chart'){var d=body.querySelector('[id]');if(d){var i=echarts.getInstanceByDom(d);if(i)i.resize();}}
};

  /* Trajectory view mode (Compact / Audit / Raw) */
  D.querySelectorAll(".traj-tab").forEach(function(b){
    b.addEventListener("click",function(){
      var mode=b.getAttribute("data-trajmode");if(!mode)return;
      var tabs=b.closest(".traj-tabs");if(!tabs)return;
      var panel=tabs.parentElement;
      tabs.querySelectorAll(".traj-tab").forEach(function(x){x.classList.remove("on");});
      b.classList.add("on");
      panel.querySelectorAll(".traj-mode-panel").forEach(function(p){p.style.display="none";});
      var target=panel.querySelector(".traj-mode-"+mode);
      if(target)target.style.display="";
    });
  });

/* Table sort */
D.querySelectorAll('.tw table').forEach(function(t){
  t.querySelectorAll('th').forEach(function(th,ci){
    th.addEventListener('click',function(){sortTbl(t,ci,th);});
  });
  t.querySelectorAll('tbody tr').forEach(function(r){
    r.addEventListener('click',function(){
      t.querySelectorAll('tbody tr').forEach(function(x){x.classList.remove('sel');});
      r.classList.add('sel');
    });
  });
});
function sortTbl(t,ci,th){
  var tb=t.querySelector('tbody')||t,rows=Array.from(tb.querySelectorAll('tr'));
  var asc=th.getAttribute('aria-sort')!=='ascending';
  t.querySelectorAll('th').forEach(function(h){h.removeAttribute('aria-sort');});
  th.setAttribute('aria-sort',asc?'ascending':'descending');
  rows.sort(function(a,b){
    var ca=(a.children[ci]||{}).textContent||'',cb=(b.children[ci]||{}).textContent||'';
    var na=parseFloat(ca.replace(/[^0-9.-]/g,'')),nb=parseFloat(cb.replace(/[^0-9.-]/g,''));
    return (!isNaN(na)&&!isNaN(nb))?(asc?na-nb:nb-na):(asc?ca.localeCompare(cb):cb.localeCompare(ca));
  });
  rows.forEach(function(r){tb.appendChild(r);});
}

/* Code copy */
D.querySelectorAll('.code').forEach(function(b){
  var btn=b.querySelector('.cbtn');if(!btn)return;
  btn.addEventListener('click',function(){
    var p=b.querySelector('pre');if(!p)return;
    navigator.clipboard.writeText(p.textContent||'').then(function(){btn.textContent='Copied';setTimeout(function(){btn.textContent='Copy';},1500);});
  });
});

function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
})(window,document);
`;
}

export function esc(text: string): string {
  return text.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}

export { esc as escapeHtml };
