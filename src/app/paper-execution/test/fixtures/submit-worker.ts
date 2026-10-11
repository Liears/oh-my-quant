import { createLocalPaperService } from "../../adapter.ts";
import { submitOrder } from "../../../../execution/index.ts";
import type { OrderIntent } from "../../../../execution/index.ts";

const [root, clientOrderId] = process.argv.slice(2);
if (!root || !clientOrderId) throw new Error("Worker needs a paper root and client order ID");
const target = { adapterId: "local-paper", accountRef: "fixture-account", mode: "paper" as const };
const service = createLocalPaperService({ root, target, openingAccount: { balances: [{ currency: "USD", cash: "100" }], positions: [] }, now: () => 1000 });
const intent: OrderIntent = { version: 1, target, clientOrderId, instrument: { symbol: "EXAMPLE", venue: "TEST", currency: "USD" },
  side: "buy", type: "limit", quantity: "2", limitPrice: "10", maxOrderNotional: "20", timeInForce: "gtc" };
process.stdout.write(JSON.stringify(await submitOrder(service.adapter, intent, { now: () => 1000 })));
