import { prepareOrderIntent } from "../../../execution/index.ts";
import type { OrderIntent } from "../../../execution/index.ts";
import { AlpacaPaperJournal } from "../journal.ts";

const root = process.argv[2]!, clientOrderId = process.argv[3]!;
const target = { adapterId: "alpaca-paper", accountRef: "paper-account", mode: "paper" as const };
const intent: OrderIntent = { version: 1, target, clientOrderId,
  instrument: { symbol: "AAPL", venue: "ALPACA-US", currency: "USD" },
  side: "buy", type: "limit", quantity: "2", limitPrice: "10", maxOrderNotional: "20", timeInForce: "gtc" };
const prepared = prepareOrderIntent(intent, target);
const reserved = await new AlpacaPaperJournal(root, target).reserve(prepared, new AbortController().signal);
process.stdout.write(JSON.stringify({ reserved, hash: prepared.intentHash }));
