# Research interruption and overview refresh

Second repair batch, based on upstream `app` at `2ab32b9fd7c25f7793d01406ddf9de6a6d0b1668`.

## Agreed behavior

- Preserve the configured model thinking depth. Show the active model/tool stage and elapsed waiting time; do not invent a completion percentage or ETA.
- Ctrl+G stops the current model/tool operation through the existing session abort contract. Keep the original task, conversation and saved verified evidence. Clear queued follow-ups, suppress automatic reports for the interrupted turn, and show explicit continuation guidance. Existing Esc, Ctrl+C, Ctrl+D and Ctrl+P meanings are preserved.
- Continuation is a new explicit user request in the retained session. Existing research-harness reconciliation revalidates evidence against the task; interruption does not mark the persistent research task cancelled or reset its journal. This is not a new automatic resumable scheduler.
- Retain successful public overview observations during refresh/failure. Label each retained row as refreshing or stale and retain its original observation date, source and factual state. A UI refresh flag never changes analysis-tool evidence.
- Retry only failed symbols with Ctrl+R. While a request is active, repeated retry shares it. Healthy symbols are not fetched again. Prune removed symbol identities and reject obsolete generation callbacks.
- Display Doctor failures and their repair actions before successful phases and warnings. Diagnostic execution order is unchanged.

## Key configuration

Optional settings.json entries apply on next launch:

```json
{
  "keybindings": {
    "interruptResearch": ["ctrl+x"],
    "retryFailedQuotes": ["ctrl+r"]
  }
}
```

An empty array disables an action. Bindings accept supported Ctrl-letter input and exclude existing exit, configuration, Tab, Enter and Backspace controls. The two actions cannot share a chord. No credential settings are changed.

## Verification

Public AppRuntime interruption tests exercise abort, retained user text, no cancelled-turn report, explicit continuation and unchanged max thinking. Overview tests exercise original-date retention, visible cached rows while refreshing, isolated failed-symbol retry, healthy no-op retry, supersession and late callback guards. Doctor repair actions are checked at 60x20, 80x24 and 120x32.

Windows PTY raw input smoke checks exercise Ctrl+G and a remapped Ctrl+X and normal exit. They do not verify native Windows Terminal pixels, clipboard or IME. Live provider speed and model reasoning quality remain external; synthetic integration checks do not prove semantic continuation for every model.

The first batch (answer validation and rendering performance) and third batch (readability and configuration/report discovery) are independent changes.
