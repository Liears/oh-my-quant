import { subscribeFileEvents } from "../../src/fs-events.ts";
import { archiveFundNav } from "../../index.ts";
import { fundNav, NAV_OBSERVED_AT } from "./fund-nav.ts";

subscribeFileEvents(event => {
  if (event.detail === "immutable public NAV revision") process.exit(73);
});
await archiveFundNav("270042.OF", fundNav(), "fund_open_fund_info_em", NAV_OBSERVED_AT);
process.exit(0);
