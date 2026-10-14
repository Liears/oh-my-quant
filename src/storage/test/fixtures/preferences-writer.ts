import { basename } from "node:path";
import { editPortfolio } from "../../../runtime/research/portfolio.ts";
import { saveSettings } from "../../src/settings.ts";
import { DEFAULT_SETTINGS } from "../../../types/config.ts";

const root = process.env.OHQUANT_DIR;
if (!root || !basename(root).startsWith("ohq-preferences-")) throw new Error("A dedicated preferences test directory is required.");
const deadline = Date.now() + 10_000;
for (;;) {
  try {
    if (process.argv[3] === "settings") {
      saveSettings({ ...DEFAULT_SETTINGS, model: `Process ${process.argv[2]}`, revision: process.argv[4] });
      console.log("saved");
    } else editPortfolio({ type: "create", name: `Process ${process.argv[2]}` });
    break;
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESTORAGECONFLICT") { console.log("conflict"); break; }
    if ((error as NodeJS.ErrnoException).code !== "ELOCKED" || Date.now() >= deadline) throw error;
    await Bun.sleep(25);
  }
}
