# WhyJ Quant

**Research before conviction.**

An open-source AI research terminal for exploring markets, testing ideas, and keeping the evidence. Bring your own models and data sources.

[Website](https://oh-my-quant.vercel.app/en/) / [中文](https://oh-my-quant.vercel.app) / [Documentation](#documentation) / [Blog](https://oh-my-quant.vercel.app/en/blog/)

[![WhyJ Quant website demo: research tools, sample analysis, and a market overview](./docs/assets/website-workspace.png)](https://oh-my-quant.vercel.app/en/)

*Interactive website demo with synthetic data. The CLI runs in your own terminal.*

## Quick start

Install the [published package](https://www.npmjs.com/package/whyj-quant), then launch the terminal:

```sh
npm install -g whyj-quant
whyj
```

Open `/config` to connect your model and market-data providers. Use `/doctor` to check the setup, then ask a question:

```text
Analyze the returns and risk of 000001.SZ from 2025-01-06 to 2025-06-30.
Show the actual data source, coverage dates, assumptions, and missing inputs.
```

To save reports, enable **Auto Artifacts** in `/config` before submitting a research request. `/artifact` opens existing reports; `/resume` returns to a saved session.

Provider credentials and optional Python dependencies depend on your data sources. Model and data services may charge for usage. See the [configuration guide](./docs/quant-harness/configuration.md) and [provider reference](./docs/quant-harness/source-data-providers.md).

<details>
<summary>Run from source</summary>

With Bun installed, run from the repository root:

```sh
bun install
bun run src/index.ts
```

The checkout and npm release may differ. Check `whyj --version` and the [changelog](./CHANGELOG.md) for the version you are using.

</details>

## Features

- **Research in context.** Connect market data and quantitative tools in one conversation.
- **Test an idea.** Explore factors, backtests, and risk with explicit dates and data coverage.
- **Keep the evidence.** Review reports and tool calls, then resume the source research.
- **Work your way.** Choose models, data providers, skills, and workspace preferences.

## Commands

| Command | Purpose |
| --- | --- |
| `/config` | Connect models and data; adjust the workspace |
| `/doctor` | Check the research environment |
| `/portfolio` | Manage observation groups |
| `/skill` | Discover and inspect skills |
| `/artifact` | Browse reports and restore their source research |
| `/resume` | Continue a saved session |

Use `/help` in the terminal or `whyj --help` in your shell. The [command reference](./docs/quant-harness/slash-commands.md) covers the full interface and one-shot usage.

## Documentation

- **Use the terminal:** [Configuration](./docs/quant-harness/configuration.md), [data providers](./docs/quant-harness/source-data-providers.md), [reports](./docs/quant-harness/artifacts-design.md), [tools and skills](./docs/quant-harness/trader-skills.md).
- **Agent Runtime design:** [Runtime, lifecycle, and Pi integration](./docs/agent-runtime/README.md).
- **Quant Harness design:** [Data, computation, execution, reports, and UI/UX](./docs/quant-harness/README.md).
- **System and UI:** [Module architecture](./docs/quant-harness/module-architecture.md), [visual design](./DESIGN.md).
- **Read further:** [Investment notes](./notes/README.md), [changelog](./CHANGELOG.md).

Most technical references are in Chinese. The [website](https://oh-my-quant.vercel.app/en/) supports English and Chinese; articles will appear on the [Blog](https://oh-my-quant.vercel.app/en/blog/).

## Development

```sh
bun run typecheck
bun run check:architecture
bun run test
bun run build
```

The product website lives in [`site/`](./site/README.md) and has its own build:

```sh
bun run --cwd site dev
bun run --cwd site build
```

## License

[MIT](./LICENSE). Built for thoughtful research.

Research software, not investment advice. Observation groups are not brokerage accounts. Settings, sessions, and reports are stored locally; analysis sends necessary requests to your chosen providers. Review reports before sharing them.
