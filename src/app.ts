import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AppRuntime, createInitialAppState } from "./app-runtime.ts";
import { QuantTui } from "./tui/src/tui.ts";

export async function startApp(): Promise<void> {
  const initial = createInitialAppState(getPkgVersion());
  let tui: QuantTui | null = null;

  const runtime = new AppRuntime({
    onMessages: (messages) => tui?.update({ messages }),
    onActivity: (activity) => tui?.update({ activity }),
    onLocalState: (partial) => tui?.update(partial),
    onComposerStatus: (composerStatus) => tui?.update({ composerStatus }),
    onComposerQueue: (composerQueue) => tui?.update({ composerQueue }),
    onConfigRequest: () => tui?.openConfig(),
    onDoctorRequest: (doctor) => tui?.openDoctor(doctor),
    onResumeRequest: (meta) => tui?.openResume(meta),
    onResearchRequest: snapshot => tui?.openResearch(snapshot),
    onPortfolioRequest: () => tui?.openPortfolio(),
    onArtifactRequest: () => tui?.openArtifact(),
    onHelpRequest: () => tui?.openHelp(),
    onSessionRequest: (meta) => tui?.syncCurrentSessionMeta(meta),
    onPanel: (panel, panelLoading = false) => tui?.update({ panel, panelLoading }),
    onHud: (hud) => tui?.update({ hud }),
    onModel: (model) => tui?.update(model),
    onSkillsChanged: () => { void tui?.refreshSkills(() => runtime.getSkillSuggestions()); },
  });

  tui = new QuantTui(initial);
  tui.onDoctorClose(() => runtime.cancelDoctor());
  tui.onConfigurationChange(() => runtime.refreshConfiguration());
  tui.start();

  try {
    const snapshot = await runtime.bootstrap();
    await tui.refreshSkills(() => runtime.getSkillSuggestions());
    tui.update({
      model: snapshot.model,
      modelLabel: snapshot.modelLabel,
      panelLoading: false,
      activity: "ready",
    });
  } catch (err) {
    tui.update({
      panelLoading: false,
      activity: "ready",
      messages: [
        {
          role: "error",
          text: err instanceof Error ? err.message : String(err),
        },
      ],
    });
  }

  tui.onSubmit(async (input: string) => {
    const result = await runtime.submit(input);
    if (result === "exit") {
      await runtime.shutdown();
      tui!.stop();
      process.exit(0);
    }
  });

  void runtime.startSkillInstallation();

  tui.onArtifactRestore((reportId) => {
    void runtime.restoreArtifact(reportId);
  });
  tui.onPrivateAnnualExport((request) => {
    void runtime.exportPrivateAnnual(request);
  });

  tui.onPanelRefresh(() => {
    void runtime.refreshOverviewPanel();
  });

  process.once("exit", () => {
    runtime.dispose();
    tui?.stop();
  });
}

function getPkgVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8"));
    return pkg.version || "1.2.0";
  } catch {
    return "1.2.0";
  }
}

