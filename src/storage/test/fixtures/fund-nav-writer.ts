import { archiveFundNav } from "../../index.ts";
import { fundNav, NAV_OBSERVED_AT } from "./fund-nav.ts";

const result = await archiveFundNav("270042.OF", fundNav(), "fund_open_fund_info_em", NAV_OBSERVED_AT);
console.log(result!.revision);
