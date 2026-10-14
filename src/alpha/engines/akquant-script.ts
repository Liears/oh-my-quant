/** Owned strategy only; user data is JSON on stdin, never Python source. */
export const AKQUANT_SCRIPT = String.raw`
import contextlib, importlib.metadata, json, platform, sys

def main():
    payload = json.load(sys.stdin)
    try:
        version = importlib.metadata.version("akquant")
    except importlib.metadata.PackageNotFoundError:
        return {"error": "unavailable"}
    if version != "0.3.58":
        return {"error": "version"}
    with contextlib.redirect_stdout(sys.stderr):
        import akquant as aq
        import pandas as pd
        if aq.__engine_rule_version__ != "1.5.4":
            return {"error": "version"}
        request = payload["request"]
        signals = payload["signals"]
        rows = request["bars"]
        indices = {bar["date"]: i for i, bar in enumerate(rows)}
        def strategy(ctx, bar):
            date = pd.Timestamp(bar.timestamp, unit="ns", tz="UTC").strftime("%Y-%m-%d")
            index = indices[date]
            ctx.cancel_all_orders(bar.symbol)
            if index == len(rows) - 1:
                return
            target = signals[index] * request["strategy"]["quantity"]
            delta = target - ctx.get_position(bar.symbol)
            if delta > 0:
                ctx.buy(bar.symbol, delta)
            elif delta < 0:
                ctx.sell(bar.symbol, -delta)
        frame = pd.DataFrame([{key: bar[key] for key in ("date", "open", "high", "low", "close", "volume")} for bar in rows])
        frame["date"] = pd.to_datetime(frame["date"], utc=True)
        config = aq.BacktestConfig(
            strategy_config=aq.StrategyConfig(exit_on_last_bar=False, round_fill_price=False),
            instruments_config=[aq.InstrumentConfig(symbol=request["symbol"], lot_size=1, tick_size=0.01)],
            timezone="UTC", bootstrap_samples=0,
        )
        result = aq.run_backtest(
            data=frame, strategy=strategy, symbols=request["symbol"],
            initial_cash=request["initialCash"],
            commission_rate=request["costs"]["commissionRate"],
            stamp_tax_rate=0.0, transfer_fee_rate=0.0, min_commission=0.0,
            slippage={"type": "percent", "value": request["costs"]["slippageRate"]},
            volume_limit_pct=1.0, timezone="UTC", t_plus_one=False,
            fill_policy=aq.NextOpen(), show_progress=False, config=config,
            strategy_runtime_config={"error_mode": "raise"},
        )
        curve = [{"date": stamp.strftime("%Y-%m-%d"), "equity": float(value)}
                 for stamp, value in result.equity_curve.items()]
        fills = [{"id": row["id"], "orderId": row["order_id"], "symbol": row["symbol"],
                  "date": row["timestamp"].strftime("%Y-%m-%d"), "side": row["side"],
                  "quantity": float(row["quantity"]), "price": float(row["price"]),
                  "commission": float(row["commission"])}
                 for row in result.executions_df.to_dict("records")]
        orders = [{"id": row["id"], "symbol": row["symbol"], "side": row["side"],
                   "createdDate": row["created_at"].strftime("%Y-%m-%d"),
                   "quantity": float(row["quantity"]), "filledQuantity": float(row["filled_quantity"]),
                   "status": row["status"]}
                  for row in result.orders_df.to_dict("records")]
        return {"protocol": 1, "engine": {"name": "akquant", "version": version,
                "ruleVersion": aq.__engine_rule_version__, "python": platform.python_version()},
                "inputHash": payload["inputHash"], "curve": curve, "fills": fills, "orders": orders}

try:
    output = main()
except ModuleNotFoundError:
    output = {"error": "unavailable"}
except Exception:
    output = {"error": "process"}
print(json.dumps(output, allow_nan=False))
`;
