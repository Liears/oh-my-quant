import { readAccountPerformance } from "../src/account-performance/index.ts";
import { accountHistoryFixture } from "../src/account-performance/test/fixture.ts";

// Fixed synthetic demo, not a production provider or personal account discovery path.
const history = accountHistoryFixture();
const result = await readAccountPerformance({ id: history.source.adapterId, accountRef: history.request.accountRef,
  async readHistory() { return structuredClone(history); },
}, history.request, AbortSignal.timeout(2000));
console.log(JSON.stringify({ synthetic: true, method: result.method, currency: result.request.currency,
  openingEquity: result.openingEquity, closingEquity: result.closingEquity, netExternalFlow: result.netExternalFlow,
  netProfit: result.netProfit, feesAlreadyDeducted: result.feesAlreadyDeducted,
  timeWeightedReturn: result.timeWeightedReturn, observedMaxDrawdown: result.observedMaxDrawdown }, null, 2));
