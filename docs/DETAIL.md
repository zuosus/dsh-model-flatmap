# Flat model picker

Replaces the composer's model selector with a single flat panel. There are no
second-level menus: the model grid, the reasoning levels of the current model,
and the agent teamwork switch are all visible at once.

## What it does

- **One surface.** The trigger opens one panel capped at 320 px. The header,
  the reasoning row, and the teamwork row stay fixed; only the model grid
  scrolls.
- **Global search.** The search box filters across every provider and every
  family. Groups that end up empty are not rendered, so no stray headings
  remain. Prefix matches rank first, then substring matches, then ordered
  character matches.
- **Provider-wide search.** A query that matches a *provider* — its id, its
  catalog name, or the label its section draws — selects that provider as a
  whole: every model it offers stays in the grid, not only the ones whose names
  contain the query. Typing `dou` therefore surfaces `豆包(doubao)` with its
  entire catalog. Models matched by their own name still rank first; the rest
  follow in catalog order. Provider matching accepts prefixes and substrings
  only — an ordered-subsequence pass would let a two-letter query drag every
  provider in, which is noise rather than a match. This applies to both
  grouping modes.
- **Two grouping modes.** A segment control switches the grid between
  *By provider* and *By family*. Grouping and search are independent: the
  segment only changes how the filtered result is organised.
- **Model families.** A built-in dictionary recognises DeepSeek, Grok, Opus,
  Haiku, Sonnet, Claude, Qwen, GLM, Kimi, GPT, Gemini, Llama, Mistral and
  others. A model the dictionary does not cover is inferred from the first
  segment of its id; anything unjudgeable falls into *Others*, which always
  sorts last. Families stay flat — no nesting.
- **Adaptive columns.** The panel measures one group title and one model row,
  subtracts the fixed sections from the 320 px cap, and picks the smallest
  column count from 1 to 3 that fits. If even three columns overflow, it keeps
  three and the grid scrolls. A group title never separates from its first
  model, and the last column's deficit is balanced against its neighbour.
- **Reasoning levels.** The current model's advertised levels render as one row
  of pills; a click submits through `session.selectModel` and the row refreshes
  from the directory once it updates. A model without reasoning metadata hides
  the row entirely, and it costs no height.
- **Badges.** A model's catalog badge (for example a third-party rate
  multiplier such as `×0.1`) renders inside its row. A model with no badge
  renders no empty slot.
- **Agent teamwork.** The switch keeps the host's semantics: the same label,
  the same confirmation before disabling it mid-conversation, and no optimistic
  update — the state comes from the `agentTeam` projection.

## Data and interaction

Everything goes through public Client APIs:

- `ctx.modelDirectories.directoryFor(sessionId)` supplies the catalog, the
  current selection, and the pending selection; `load()` refreshes it and
  `select()` submits.
- The directory store is subscribed through `useSyncExternalStore`, so a
  catalog update — including one caused by a selection — repaints the panel.
- `ctx.get('remote').agentTeams.setEnabled()` writes the teamwork selection.
- `ctx.locale` supplies the copy, resolves catalog badge text, and prefers the
  host's own `agent-team` wording when that namespace is registered.

No host component, stylesheet, or DOM is read or restyled.

## Layout behaviour

- Window resize, a grouping switch, and search input all re-plan the columns,
  debounced, and the plan runs once more after fonts finish loading so the
  first frame's measurements do not stick.
- The panel opens above the trigger and flips below when there is no room,
  staying inside the viewport.
- An unbound Session, an empty catalog, a failed provider, and a search with no
  hits each have their own state. A directory that has not resolved yet still
  renders a trigger rather than blanking the composer.

## Styling

Colours, radii, spacing, and elevation come only from the `--dsw-alias-*`,
`--dsw-elevation-*`, `--dsw-menu-*`, and `--dsw-radius-*` tokens, so light and
dark themes both follow the host palette. The panel uses the same menu surface
material as the host's own menus (menu fill, backdrop blur, prominent
elevation, large radius), and hover, focus, selected, and disabled states follow
the shipped picker's visual language.

## Limitations

- The panel replaces the composer seat only; the `/model` popup is untouched.
- The panel does not host the `conversation.input.model.label` and
  `conversation.input.model.options` child slots. The shipped registration keeps
  those declarations alive, so other plugins' contributions stay valid; their
  content simply is not drawn inside this panel.
- Addressed subagent sessions hide the seat, matching the shipped selector.
- The badge comes from the catalog entry, so a provider that publishes no badge
  shows none.
