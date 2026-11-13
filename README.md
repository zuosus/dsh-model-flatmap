# dsh-model-flatmap

> A flat, two-level-free model picker for the DeepSeek Harness (DSH) composer:
> every model and reasoning level on one surface, no second-level menus.

[简体中文](./README.zh.md)

## What it is

`dsh-model-flatmap` is a **browser-only** DSH plugin. It replaces the composer's
`conversation.input.model` seat with a single flat panel rendered in the Web GUI.
Instead of nested popovers, the whole catalogue is one searchable grid where the
model grid, the current model's reasoning levels, and the agent-teamwork switch
are all visible at once.

The plugin reads and writes through **public Client APIs only** — the per-Session
model directory, the teamwork setting, and the host's locale. The host half
(`index.js`) contributes no service, tool, or event; the UI lives in `client.js`,
which registers with a negative priority so it shadows the shipped `ModelSelect`
while active. Disabling the plugin restores the native control with no residue.

## Features

- **One surface.** The trigger opens one panel capped at 320 px. The header, the
  reasoning row, and the teamwork row stay fixed; only the model grid scrolls.
- **Global search.** Filters across every provider and every family. Groups that
  end up empty are dropped, so no stray headings remain. Prefix matches rank
  first, then substring matches, then ordered character matches.
- **Word-wise search.** Whitespace splits the query into tokens, and every token
  must land somewhere in the name. A hit ranks by its weakest token.
- **Provider-wide search.** A query that matches a *provider* (its id, catalog
  name, or section label) keeps that provider's entire catalogue in the grid.
- **Two grouping modes.** A segment control switches the grid between
  *By provider* and *By family*. Grouping and search are independent.
- **Model families.** A built-in dictionary recognises DeepSeek, Grok, Opus,
  Haiku, Sonnet, Claude, Qwen, GLM, Kimi, GPT, Gemini, Llama, Mistral and others.
  Unrecognised models are inferred from their id; anything unjudgeable falls into
  *Others* (always sorts last). Families stay flat — no nesting.
- **Generations are kept apart.** A registered brand splits by generation:
  `hy3` → `HY3`, `hy4free` / `hy4std` / `hy4-preview` → `HY4`, and a bare `hy`
  → `HY`. Unregistered brands still collapse their version tail; dictionary
  families (GPT, Qwen…) are never split.
- **Rows are provider-primary.** Under *By family* the heading already says what
  the models are, so the family name is not repeated in a row: the primary text
  is the provider name. Only when one provider offers several models in the same
  family does a short id-derived suffix differentiate them. The full model name
  and description stay in the tooltip.
- **Reasoning effort.** The current model's reasoning levels render as an
  exclusive, keyboard-operable group ("推理等级" / "Reasoning effort") driven by
  radio semantics.
- **Adaptive footer.** The reasoning group and the agent-teamwork switch share
  one line when both fit with a 30 px gap, and fall back to one row each when
  they do not — the break is CSS flex wrapping, not a measured pixel threshold.
- **Theme-aware.** Styled with host theme tokens only; looks correct in both
  light and dark themes.

See [`docs/DETAIL.md`](./docs/DETAIL.md) for the full behaviour spec and
[`DECISIONS.md`](./DECISIONS.md) for the decision log behind the design.

## Installation

This package is a DSH **bundle**. Install it from your DSH profile (the plugin
manager), or drop it into the profile's bundle directory so the `dsh` loader
picks up `cordis.patch.yml`.

```bash
# Example: install the bundle into a running profile (paths vary by install)
cp -r . "<profile>/bundles/dsh-model-flatmap"
```

Enable or disable the plugin from the profile's plugin list — no native control
is touched when the bundle is off.

## Project layout

| Path                 | Purpose                                                  |
| -------------------- | -------------------------------------------------------- |
| `index.js`           | Host half — bundle entry, contributes nothing at runtime. |
| `client.js`          | Browser half — the entire flat picker UI.                |
| `cordis.patch.yml`   | Cordis patch applied by the `dsh` bundle loader.         |
| `locale/en.json`     | English copy and metadata.                               |
| `locale/zh.json`     | Simplified-Chinese copy and metadata.                    |
| `docs/DETAIL.md`     | Detailed behaviour specification.                        |
| `test/`              | Render-path tests driven through a minimal hook runtime. |

## Development

The plugin is plain ES modules with no build step.

```bash
# Run the render-path tests (no browser required)
node --test test/
```

Tests read `client.js` directly and drive the real component through a minimal
hook runtime to catch crashes, missing sections, and wrong column counts.

## License

Released under the [MIT License](./LICENSE).
