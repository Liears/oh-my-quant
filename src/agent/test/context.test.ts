import { describe, it, expect } from "bun:test";
import { BASE_SYSTEM_PROMPT, buildSystemPrompt, injectSessionContext, injectSkillContext, injectTurnContext } from "../src/context.ts";

describe("BASE_SYSTEM_PROMPT", () => {
  it("contains quant analyst identity", () => {
    expect(BASE_SYSTEM_PROMPT).toContain("quantitative finance analyst");
  });

  it("uses actual request schemas as the capability contract", () => {
    expect(BASE_SYSTEM_PROMPT).toContain("parameter schemas in this request");
    expect(BASE_SYSTEM_PROMPT).toContain("Registration alone does not verify dependencies");
    expect(BASE_SYSTEM_PROMPT).not.toMatch(/fetch_bars|search_symbols|fetch_snapshot/);
  });

  it("preserves task boundaries without advertising unselected computation tools", () => {
    expect(BASE_SYSTEM_PROMPT).toContain("Do not add unrelated metrics, change dates, substitute engines");
    expect(BASE_SYSTEM_PROMPT).toContain("substitute shell access to bypass disabled capabilities");
    expect(BASE_SYSTEM_PROMPT).not.toMatch(/compute_factor|run_backtest|check_risk|score_benchmark|show_dashboard/);
  });

  it("forbids markdown formatting", () => {
    expect(BASE_SYSTEM_PROMPT).toContain("NO markdown formatting");
    expect(BASE_SYSTEM_PROMPT).toContain("never use **bold**");
  });

  it("forbids emoji", () => {
    expect(BASE_SYSTEM_PROMPT).toContain("NO emoji");
  });

  it("contains financial terminology guidance", () => {
    expect(BASE_SYSTEM_PROMPT).toContain("annualized return");
    expect(BASE_SYSTEM_PROMPT).toContain("historical percentiles do not establish future returns or mean reversion");
    expect(BASE_SYSTEM_PROMPT).toContain("tail risk");
    expect(BASE_SYSTEM_PROMPT).toContain("tracking error");
  });

  it("contains workflow rules", () => {
    expect(BASE_SYSTEM_PROMPT).toContain("Use the matching enabled tool directly");
    expect(BASE_SYSTEM_PROMPT).toContain("Keep source, observation date and stale-cache status visible");
  });

  it("contains structured tool-result preservation guidance", () => {
    expect(BASE_SYSTEM_PROMPT).toContain("Structured Tool Result Handling");
    expect(BASE_SYSTEM_PROMPT).toContain("three-line plain-text table");
    expect(BASE_SYSTEM_PROMPT).toContain("must not use vertical bars");
    expect(BASE_SYSTEM_PROMPT).toContain("Preserve the tool's labeled result rows");
    expect(BASE_SYSTEM_PROMPT).toContain("Do not rename reported metrics");
    expect(BASE_SYSTEM_PROMPT).toContain("time-weighted return/drawdown");
    expect(BASE_SYSTEM_PROMPT).toContain("do not replace the leaderboard with a one-line summary");
  });

  it("contains terminal chart output contracts", () => {
    expect(BASE_SYSTEM_PROMPT).toContain("sparkline rows");
    expect(BASE_SYSTEM_PROMPT).toContain("▁▂▃▄▅▆▇█");
    expect(BASE_SYSTEM_PROMPT).toContain("K-line/candlestick/OHLC");
    expect(BASE_SYSTEM_PROMPT).toContain("Figure icons");
    expect(BASE_SYSTEM_PROMPT).toContain("⌁ for trend/line/equity curve");
    expect(BASE_SYSTEM_PROMPT).toContain("▥ for bars/volume/histogram");
    expect(BASE_SYSTEM_PROMPT).toContain("EQ, BM, EXCESS (pp), DD");
  });

  it("does not advertise shell execution when no tools are supplied", () => {
    expect(buildSystemPrompt()).toContain("Current active tools: none.");
    expect(buildSystemPrompt()).not.toContain("## Shell execution");
  });

  it("requires temporary shell artifacts to use system temp directories", () => {
    const prompt = buildSystemPrompt(undefined, [], [{ name: "bash" }]);
    expect(prompt).toContain("Never place temporary scripts or scratch outputs in the current working directory");
    expect(prompt).toContain("$env:TEMP");
    expect(prompt).toContain("$env:TMP");
    expect(prompt).toContain("/tmp");
  });

  it("constrains Windows shell calls to PowerShell syntax", () => {
    const prompt = buildSystemPrompt(undefined, [], [{ name: "bash" }]);
    expect(prompt).toContain("PowerShell.*");
    expect(prompt).toContain("ls -la");
    expect(prompt).toContain("Get-ChildItem -Force");
    expect(prompt).toContain("cmd1 && cmd2");
    expect(prompt).toContain("cmd1; cmd2");
    expect(prompt).toContain("Get-Content path -Tail N");
    expect(prompt).toContain("Get-Content path -Encoding utf8");
    expect(prompt).toContain("foreach ($x in @(...))");
  });
});

describe("buildSystemPrompt", () => {
  it("returns base prompt with no extra", () => {
    const p = buildSystemPrompt();
    expect(p).toContain("quantitative finance analyst");
  });

  it("appends extra content", () => {
    const p = buildSystemPrompt("Extra instructions here");
    expect(p).toContain("Extra instructions here");
  });

  it("appends available skills in pi XML format", () => {
    const p = buildSystemPrompt(undefined, [{
      name: "whyj-quant",
      description: "Use for benchmark interpretation.",
      content: "# WhyJ Quant",
      filePath: "C:/tmp/whyj-quant/SKILL.md",
    }]);
    expect(p).toContain("<available_skills>");
    expect(p).toContain("<name>whyj-quant</name>");
  });
});

describe("injectSessionContext", () => {
  it("wraps input with session context", () => {
    const result = injectSessionContext("analyze AAPL", {
      lastSymbol: "000001.SZ",
      lastMarket: "A",
      lastStartDate: null,
      lastEndDate: null,
      recentToolState: {
        toolName: null,
        resultShape: null,
      },
    });
    expect(result).toContain("analyze AAPL");
    expect(result).toContain("last_symbol: 000001.SZ");
    expect(result).toContain("last_market: A");
  });

  it("returns input unchanged when context is empty", () => {
    const result = injectSessionContext("hello", {
      lastSymbol: null,
      lastMarket: null,
      lastStartDate: null,
      lastEndDate: null,
      recentToolState: {
        toolName: null,
        resultShape: null,
      },
    });
    expect(result).toBe("hello");
  });
});

describe("injectTurnContext", () => {
  it("adds lightweight render guidance for comparison-heavy requests", () => {
    const result = injectTurnContext("compare top 5 holdings and show a table", {
      lastSymbol: "510300.SH",
      lastMarket: "A",
      lastStartDate: null,
      lastEndDate: null,
      recentToolState: {
        toolName: null,
        resultShape: null,
      },
    });
    expect(result).toContain("<!-- tool execution guidance -->");
    expect(result).toContain("never write temp_*.py");
    expect(result).toContain("<!-- render guidance -->");
    expect(result).toContain("compact aligned three-line plain-text table");
    expect(result).toContain("do not use vertical bars");
    expect(result).toContain("use figure icons");
    expect(result).toContain("EQ, BM, EXCESS (pp), DD");
    expect(result).toContain("sparkline rows");
    expect(result).toContain("last_symbol: 510300.SH");
  });

  it("adds tool-family-specific guidance for backtest and risk style requests", () => {
    const result = injectTurnContext("run backtest and compare risk with a chart", {
      lastSymbol: null,
      lastMarket: null,
      lastStartDate: null,
      lastEndDate: null,
      recentToolState: {
        toolName: null,
        resultShape: null,
      },
    });
    expect(result).toContain("total return, CAGR, Sharpe, max drawdown, up-period ratio, period P/L ratio");
    expect(result).toContain("preserve VaR/CVaR and drawdown lines explicitly");
    expect(result).toContain("<!-- quant analysis workflow -->");
    expect(result).toContain("TECHNICAL INDICATORS");
    expect(result).toContain("RISK METRICS");
    expect(result).toContain("Do not expand a backtest-only or risk-only task");
    expect(result).not.toMatch(/call compute_factor|call check_risk/);
  });

  it("suggests technical and risk analysis while preserving explicit criteria and parameters", () => {
    const result = injectTurnContext("分析中际旭创 300308 的近期走势", {
      lastSymbol: null,
      lastMarket: null,
      lastStartDate: null,
      lastEndDate: null,
      recentToolState: { toolName: null, resultShape: null },
    });
    expect(result).toContain("relevant installed quant/risk/trading skill");
    expect(result).toContain("Use enabled tools and their schemas");
    expect(result).toContain("Explicit task criteria and user parameters take precedence");
    expect(result).toContain("volume_ratio(20)");
    expect(result).toContain("VaR(95/99)");
    expect(result).toContain("Never invent a metric");
  });

  it("does not force the quant workflow for a simple quote lookup", () => {
    const result = injectTurnContext("查看 300308 最新价格", {
      lastSymbol: null,
      lastMarket: null,
      lastStartDate: null,
      lastEndDate: null,
      recentToolState: { toolName: null, resultShape: null },
    });
    expect(result).not.toContain("<!-- quant analysis workflow -->");
  });

  it("adds figure guidance for quant chart terms without saying chart", () => {
    const result = injectTurnContext("show volume, exposure, alpha, and drawdown", {
      lastSymbol: null,
      lastMarket: null,
      lastStartDate: null,
      lastEndDate: null,
      recentToolState: {
        toolName: null,
        resultShape: null,
      },
    });
    expect(result).toContain("<!-- render guidance -->");
    expect(result).toContain("▥ bars/volume/histogram");
    expect(result).toContain("EQ, BM, EXCESS (pp), DD");
  });

  it("uses last tool name to shape a generic follow-up", () => {
    const result = injectTurnContext("继续，展开讲一下", {
      lastSymbol: "000300.SH",
      lastMarket: "A",
      lastStartDate: null,
      lastEndDate: null,
      recentToolState: {
        toolName: "check_risk",
        resultShape: null,
      },
    });
    expect(result).toContain("recent_tool_state:");
    expect(result).toContain("tool: check_risk");
    expect(result).toContain("<!-- render guidance -->");
    expect(result).toContain("preserve VaR/CVaR and drawdown lines explicitly");
  });

  it("uses last result shape to shape a generic follow-up", () => {
    const result = injectTurnContext("继续", {
      lastSymbol: "000300.SH",
      lastMarket: "A",
      lastStartDate: null,
      lastEndDate: null,
      recentToolState: {
        toolName: null,
        resultShape: "dashboard_ranking",
      },
    });
    expect(result).toContain("recent_tool_state:");
    expect(result).toContain("result_shape: dashboard_ranking");
    expect(result).toContain("<!-- render guidance -->");
    expect(result).toContain("preserve ranking rows and scores instead of summarizing only the top name");
  });

  it("stays lightweight for ordinary chat requests", () => {
    const result = injectTurnContext("hello", {
      lastSymbol: null,
      lastMarket: null,
      lastStartDate: null,
      lastEndDate: null,
      recentToolState: {
        toolName: null,
        resultShape: null,
      },
    });
    expect(result).toContain("hello");
    expect(result).toContain("<!-- tool execution guidance -->");
    expect(result).not.toContain("<!-- render guidance -->");
  });
});

describe("injectSkillContext", () => {
  it("adds compact structured-output guidance to skill instructions", () => {
    const result = injectSkillContext("whyj-quant", "focus on benchmark drift");
    expect(result).toContain("focus on benchmark drift");
    expect(result).toContain("<!-- tool execution guidance -->");
    expect(result).toContain("$env:TEMP");
    expect(result).toContain("structured rows visible");
    expect(result).toContain("3 short lines");
    expect(result).toContain("Preserve score rows, ranking rows, risk rows, and backtest metric rows");
    expect(result).toContain("<!-- quant skill analysis contract -->");
    expect(result).toContain("technical factors → risk metrics");
  });

  it("keeps macro report source provenance and the SHY/TLT proxy explicit", () => {
    const result = injectSkillContext("macro-regime-detector");
    expect(result).toContain("metadata.data_source");
    expect(result).toContain("FMP API on a yfinance-only run");
    expect(result).toContain("SHY/TLT is a yield-curve proxy");
  });
});
