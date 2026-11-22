# dsh-model-flatmap

> A flat, two-level-free model picker for the DeepSeek Harness (DSH) composer:
> every model and reasoning level on one surface, no second-level menus.

[简体中文](./README.zh.md)

## What it is

`dsh-model-flatmap` is a **client-side** DSH plugin that runs in both the **Web GUI and the
Desktop app**. It replaces the composer's `conversation.input.model` seat with a single flat
panel rendered in the client UI.
Instead of nested popovers, the whole catalogue is one searchable grid where the
model grid, the current model's reasoning levels, and the agent-teamwork switch
are all visible at once.

The plugin reads and writes through **public Client APIs only** — the per-Session
model directory, the teamwork setting, and the host's locale. The host half
(`index.js`) contributes no service, tool, or event; the UI lives in `client.js`,
which registers with a negative priority so it shadows the shipped `ModelSelect`
while active. Disabling the plugin restores the native control with no residue.

The host half has one job of its own: an **anonymous daily heartbeat**
(`telemetry.js`). It sends at most one request per machine per local day to
`https://dsh.zuos.us/api/e` — installation id, plugin id, plugin version,
platform, architecture, event kind and the protocol version — and nothing else:
no prompt, no session content, no model name, no path, no username, no IP. A
process that stays open across midnight re-checks every six hours, so a window
left running all night still counts for the new day rather than only for the day
it was launched.

The installation id is a random UUIDv4 created on first run and unrelated to any
account; deleting `~/.dsh/plugins/dsh-model-flatmap/analytics.json` gives the
machine a new one. A pre-`plugins/` data directory (`~/.dsh/dsh-model-flatmap/`)
is moved there automatically on first start, once; an existing
`~/.dsh/plugins/dsh-model-flatmap/` is never overwritten or merged into.
The heartbeat is `void`-ed and every failure is swallowed, so the picker never
waits for it and never fails because of it. It exists because npm download
counts cannot answer "how many machines actually run this, and how many ran it
today" (installs, CI and mirrors all count), and a Client-side counter cannot
either (a tab nobody reloads reports nothing).

**You can switch it off.** Settings → Model list carries an *Anonymous usage
statistics* toggle at the bottom of the panel, **on by default**. The choice is
opt-out, so a machine whose owner never opens Settings keeps reporting exactly as
before — the toggle is a genuine choice, not a disguised default. It lives in the
browser (`localStorage`) but the heartbeat sends from the Host, so flipping it
mirrors the choice to the Host through a trust-fenced route, which re-reads it
before every send: the next heartbeat (within the day, or on the next launch)
honours it with no restart. See DEC-035. Disabling the bundle still stops the
heartbeat with the UI.

## Screenshot

The panel in action — a flat grid of models, the current model's reasoning
levels, and the agent-teamwork switch on one surface:

![Flat model picker panel](./docs/model-picker.jpeg)

## License

Released under the [MIT License](./LICENSE).
