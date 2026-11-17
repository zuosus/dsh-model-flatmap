# Flat model picker

Replaces the composer's model selector with a single flat panel. There are no
second-level menus: the model grid, the reasoning levels of the current model,
and the agent teamwork switch are all visible at once.

## What it does

- **One surface.** The trigger opens one panel capped at 320 px. The header,
  and one adaptive footer holding the reasoning group and the teamwork row,
  stay fixed; only the model grid scrolls. The two footer groups share a single
  line when both fit with a 30 px gap, and otherwise fall back to one row each.
- **Global search.** The search box filters across every provider and every
  family. Groups that end up empty are not rendered, so no stray headings
  remain. Prefix matches rank first, then substring matches, then ordered
  character matches.
- **Word-wise search.** Whitespace splits the query into tokens, and every
  token has to land somewhere in the name, so `mod inte` finds
  `ModelScope International` even though the two words are never contiguous.
  A hit ranks by its weakest token, so a multi-word query never outranks a
  plain prefix. A single-token query keeps the original ranking exactly.
- **Provider-wide search.** A query that matches a *provider* — its id, its
  catalog name, or the label its section draws — selects that provider as a
  whole: every model it offers stays in the grid, not only the ones whose names
  contain the query. Typing `dou` therefore surfaces `豆包(doubao)` with its
  entire catalog. Models matched by their own name still rank first; the rest
  follow in catalog order. Provider matching is word-wise too, and tokens may
  land in different faces of the same provider — the id answers `mod`, the
  localized name answers `inte`. It accepts prefixes and substrings only: an
  ordered-subsequence pass would let a two-letter query drag every provider in,
  which is noise rather than a match. This applies to both grouping modes.
- **Two grouping modes.** A segment control switches the grid between
  *By provider* and *By family*. Grouping and search are independent: the
  segment only changes how the filtered result is organised.
- **Model families.** A built-in dictionary recognises DeepSeek, Grok, Opus,
  Haiku, Sonnet, Claude, Qwen, GLM, Kimi, GPT, Gemini, Llama, Mistral and
  others. A model the dictionary does not cover is inferred from its id;
  anything unjudgeable falls into *Others*, which always sorts last. Families
  stay flat — no nesting.
- **Registered brands keep their generations apart.** Merging `hy3` and `hy4`
  into one `HY` family (DEC-004) was wrong: the generation has to be visible.
  A registered brand (`FAMILY_BRANDS`, currently `HY`) resolves to
  `BRAND + generation` when its id carries a generation digit, so `hy3` /
  `hy3-x` → `HY3`, `hy4-preview` / `hy4free` / `hy4std` → `HY4`, and a bare
  `hy` → `HY`. Generations rank next to their bare brand in numeric order.
  Unregistered brands still collapse their version tail (`acme4-turbo` and
  `acme-7b` are one `Acme`), and dictionary families are never split by
  generation. A provider prefix does not hide the brand (`codebuddy-hy3` →
  `HY3`).
- **Family-grouped rows are provider-primary, with a model tail.** A family
  heading says what the models *are*, so the family name is not repeated in a
  row. The row's primary text is the provider name — the one thing a heading
  cannot tell you when a family spans providers. The full model name and
  description stay in the row tooltip. What the heading *and* the provider
  cannot say — which model of the family this row is, and the catalog's rate
  multiplier — is drawn as a quieter tail at the END of the row. The tail is
  the model name with the family heading and the provider's own label removed,
  so `Qwen3.8-Flash-Next` under `Qwen` reads `3.8-Flash-Next`, `Qwen3.8-27B`
  reads `3.8-27B`, `Deepseek-V4.1-Flash · x0.00` under `DeepSeek` reads
  `V4.1-Flash · x0.00`, and `豆包 2.1 Turbo` under provider `豆包(doubao)` reads
  `2.1 Turbo`. Version numbers are KEPT (they are the型号 the heading lacks),
  and a multiplier inside the tail is drawn two sizes smaller and bold, exactly
  as it is inside a model name under *By provider*. Two rows of one provider
  that still read alike fall back to the unique model id; a model whose name
  adds nothing draws no tail. Under *By provider* the heading already is the
  provider, so the primary text stays the model name and no tail is drawn.
- **Adaptive columns.** The panel measures one group title and one model row,
  subtracts the fixed sections from the 320 px cap, and picks the smallest
  column count from 1 to 3 that fits. If even three columns overflow, it keeps
  three and the grid scrolls. A group title never separates from its first
  model, and the last column's deficit is balanced against its neighbour.
- **Reasoning levels.** The current model's advertised levels render as a
  caption ("推理等级" / "Reasoning effort") with a sparkle icon and a hint
  tooltip, on the same line as a multi-segmentation control — the track wraps
  to its own line only when the row cannot fit. The segments are radio
  choices (`role="radiogroup"` / `role="radio"`, exactly one `aria-checked`
  at a time, arrow keys move the selection) drawn with the header segment's
  visual: a toned track and a floating active segment, so the active level is
  unmistakable. A click submits through `session.selectModel` and the group
  refreshes from the directory once it updates. A model without reasoning
  metadata hides the whole group, and it costs no height.
  The group shares a wrapping footer line with the teamwork row: when
  reasoning + 30 px + teamwork fits the panel's inner width they sit side by
  side, otherwise the footer wraps back to the original two-line stack. The
  break is decided by CSS flex wrapping and the 30 px `column-gap`, never by a
  JS width threshold, so it stays correct across panel resizes, font loads and
  both themes. The single grey rule belongs to the footer container, so it sits
  above the whole footer block and stays put in both states; neither group
  draws a divider of its own (DEC-016).
  The fixed height budget measures the footer container once, not its two
  children, so a shared line is not double-counted against the grid.
- **Selected model.** The current model reads as a solid deep-blue band with
  white, bold text — no checkmark on the right. Selection lives on the row
  itself (`aria-pressed="true"`), so nothing is reserved at the trailing edge:
  unselected rows keep their full width for the name, the provider tag, and the
  badge, and the measurement probe no longer mirrors a tail column. The blue
  is `--dsw-static-deepseek-600` and the text is
  `--dsw-static-neutral-bluish-00`, both from the theme-invariant static
  palette, so the band looks the same in light and dark themes. Hover skips the
  selected row so the neutral hover wash never covers the highlight.
- **Badges.** A model's catalog badge (for example a third-party rate
  multiplier such as `×0.1`) renders inside its row. A model with no badge
  renders no empty slot. On the selected row the badge switches to a
  translucent white chip so it stays legible on the blue fill.
- **Out-of-balance models are struck through.** When a model call fails because
  the account has no usable balance, credit, or quota left, that model's row
  text is drawn with a `line-through` decoration. The strike stays until a
  later call for the same model returns something other than an
  insufficient-balance failure, **or** until it has gone 24 hours without a new
  attempt — whichever comes first. The row is not recoloured, so the strike reads
  the same on the selected row's blue band and in both themes, and it does not
  compete with the error strip's red. Only the row's text (the name and a
  family variant tag) is struck; the badge chip and the pending spinner are
  not.
  - **What counts.** The Host already classifies an exhausted account into the
    provider-neutral `QUOTA` / `ACCOUNT_QUOTA` codes and maps a provider HTTP
    `402` to `QUOTA`. The panel accepts those codes, a structured `status: 402`
    (or an `HTTP_402` code), and — for a failure the Host flattened to another
    code with the provider's wording kept — the provider text itself
    (`insufficient balance` / `insufficient credits` / `quota exceeded` /
    `out of credits` / `not enough quota` / `no credits remaining` /
    `额度已用尽` / `余额不足` / `预算已用完`, among others).
  - **A `429` is decided by its body, not by the status.** Several providers
    answer an exhausted balance with HTTP **429** rather than 402 — for example
    `429: {"message":"insufficient balance","request_id":"…"}`, which the Host
    classifies as `RATE_LIMIT`. A `429` therefore neither strikes nor clears on
    its status alone: the message decides, so a 429 carrying balance wording
    strikes while a genuine rate limit (`Rate limit exceeded`,
    `访问量过大`, `使用量已超出频率限制`) does not. The rule is pinned against
    real recorded failures (see the `REAL_INSUFFICIENT` / `REAL_TRANSIENT`
    tables in the render tests, harvested from local session history).
  - **What does not count.** A transient limit leaves the account usable, so
    `RATE_LIMIT` with rate-limit wording, `TIMEOUT`, `TRANSPORT`,
    `CONTEXT_WINDOW_EXCEEDED`, a `SERVER` failure, and a credential that simply
    cannot use the model never strike a row. Nor does a message that only
    *mentions* 额度 — a context-overflow failure says “与网络、账号、额度都无关”
    and a transport failure merely suggests waiting for quota to recover; both
    are excluded, and the tests pin them.
  - **Which model.** The failing call's model is read from the `request/header`
    event that immediately precedes the failing `turn/end`, so the mark lands
    on the route (`provider/model`) the request was actually dispatched to —
    not on the currently selected model, which may have changed since.
  - **When the strike ends.** A `turn/end` for the same route that proves the
    model answered clears it: a completed turn, a `max-tokens` turn, or a turn
    that failed for a different reason. A cancellation (`aborted`), a `blocked`
    turn, and the synthetic `interrupted` / `forked` closers clear nothing —
    the model never answered, so they say nothing about the account.
  - **How long it is drawn without one.** Every record keeps the wall-clock
    time of the observation that made it, which is what separates "this model is
    out of balance" from "this model has not been tried since that verdict". A
    mark older than 24 hours is not drawn: an exhausted balance gets topped up
    and a quota resets daily, so a strike nobody refreshed has stopped being
    information. A retry restamps the record and restarts the window, so the
    rule is "24 hours since the newest thing we learned about this route", not
    "24 hours since the row was painted". Retiring a strike is the one transition
    no event reports, so the store watches the clock itself: on every fold, when
    a seat subscribes, when the panel is opened, and on a timer set for the
    soonest deadline (that handle is `unref`'d, so a day-long wait never holds
    the host process). The record SURVIVES its own expiry, as the watermark for
    the route — which is why re-folding the very failure that made it, after a
    reload or when a second Session's older history is walked, cannot put the
    decoration back.
  - **The marks are global, not per conversation.** Whether a model has quota
    left is a fact about the model route and its account, so the state is NOT
    scoped to the Session a panel happens to render for. One module-level store
    per plugin generation observes the durable feed of **every** Session the
    Session list names, and every seat reads that one store. A failure recorded
    in any Session therefore strikes the same model in every Session and
    workspace, including in a Session whose feed this page never opened.
  - **It survives a reload.** The marks are persisted to `localStorage`
    (origin-scoped, like the grouping choice), so a fresh page load starts from
    the last known state instead of an empty one. Reads and writes degrade
    silently when storage is unavailable. Two lifetimes apply to that record and
    they are not the same one: a mark stops being DRAWN after 24 hours without a
    new observation, while the record itself is kept for 7 days, because it is
    also the watermark that keeps an older replayed failure from restamping the
    route. So a reload of a day-old verdict restores the row as plain text, and
    the fold that re-reads the failure that produced it changes nothing.
  - **The newest observation wins.** A Session feed carries no cross-Session
    sequence number, but every durable event keeps the Host's wall-clock `time`.
    Each route keeps the time of its last decision, and an observation older
    than the stored one is ignored. This is what makes the global state safe:
    replaying an older window (a history replacement, or a second Session whose
    history is older) cannot resurrect a strike that a newer call already
    cleared, and a cleared route keeps its watermark for the same reason.
  - **Where it comes from.** The store folds each Session's durable event feed
    (`sessions.binding(id).eventSource`), which is the same source the Chat
    reads its quota notice from, and re-attaches when the `sessions` service is
    replaced. No Host change is involved. A history replacement refolds that
    Session from scratch; `prepend` pages in older history and cannot change a
    mark, so it is ignored.
- **Agent teamwork.** The switch keeps the host's semantics: the same label,
  the same confirmation before disabling it mid-conversation, and no optimistic
  update — the state comes from the `agentTeam` projection. The row lives in
  the shared footer line described under *Reasoning levels*, immediately right
  of the reasoning group when both fit on one line.

## The trigger

The trigger is the same chip the shipped picker draws (13/20 regular, 28 px,
rounded-sm), and it shows the same *content* — which is more than a model name.

**The name is a slot, not a string.** The shipped `ModelSelect` does not paint
`model.name` on its trigger: it renders `conversation.input.model.label` with
`placement: 'trigger'` and lets the winning contributor decorate the name. That
is where a connection plugin puts things the catalog does not carry: a promotion
chip (`夜间折扣`), a rate, a "new on this machine" marker, and — in the case of
`dsh-connect-workbuddy` — a load mark: one, two or three queued people, or a
rocket when nothing is waiting. A bare name therefore shows strictly less than
the native trigger, which is what this plugin used to do.

**This plugin renders that slot's winner.** It cannot *declare* the child slot
(the shipped entry already did, and a second declaration throws
`already declared`) — but declaring is not needed to read it. The declaration
outlives the shadowing entry, so `slots.entriesOfSlot('conversation.input.model.label')`
still names the winning entry, and its `component` can be rendered with the
seats the renderer would have supplied:

- `t` — bound from the entry's own `locale` namespace through `locale.bind(ns)`;
- the business face — `entry.inject(sessionId)`, the renderer's own contract for
  a session-scoped entry;
- the owner props — `{ provider, model, placement: 'trigger', selected: true }`,
  exactly the share the shipped picker passes.

**The occupant is third-party code, so it is contained.** It runs without the
renderer's per-entry error boundary, so a separate `LabelBoundary` wraps it. A
crash costs the decoration and never the seat: the boundary answers `undefined`
and the trigger falls through to the catalog name. The failure is logged once.

**No occupant still gets the catalog badge.** When the cell is empty — or the
occupant is absent, crashed, or on a Host without `entriesOfSlot` — the trigger
draws the shipped fallback: the model's own `model.badge` as a chip before the
name. This is reproduced rather than imported (the host's `Tag` lives in a
primitives package this plugin does not depend on), and it matters even with an
occupant installed: an occupant that does not reproduce a sibling's `model.badge`
would otherwise lose the promotion marker.

**Registrations that land late still appear.** The trigger subscribes to the
slot through `slots.subscribe(key, fn)` / `slots.getVersion(key)`, so a
connection plugin that registers a moment after boot gets its chip on the
trigger without a page reload. A Host without those accessors keeps the first
read and never notifies.

Because native mode (below) hands the seat to the Host, which renders the same
slot, the trigger is now *one* implementation in both modes — the consistency
this feature exists for.

## Native mode

The footer's trailing `默认样式` / `Default style` button hands the composer's model seat
back to whatever the Host ships in `conversation.input.model`, and back again.

**How the switch works.** The plugin does NOT render the host's control — it
stops shadowing it. This entry registers at a negative priority, so it wins the
`single` slot; a `single` slot keeps every registration and renders only the
highest-priority live one. Native mode therefore `dispose()`s this plugin's
entry, which elects the shipped one underneath: the host mounts its own
`ModelSelect`, whatever that is in the installed version. Nothing is imported,
copied, or re-mounted, so an upgraded DSH shows its own newest picker and this
mode structurally cannot drift out of date.

The alternative — pulling the shipped component into our own tree — is not
available: the `model-selection` package exports no component, and every
`renderSlot` child (`conversation.input.model.label` / `.options`) is bound to
the entry that declares it, so another entry calling it throws
`StaleAuthorizationError` / `SlotOwnershipError`. See DEC-027.

**Stepping aside is verified, never assumed.** Before disposing, the plugin asks
`slots.entries('conversation.input.model')` for the registrations other than its
own. If there is none — the shipped package disabled, uninstalled, or a Host too
old to enumerate entries — the panel stays mounted and the button reads disabled
with a tooltip explaining why. A persisted `native` mode from a previous install
therefore lands on the flat panel instead of an empty composer.

**The way back.** Native mode disposes the entry that owns the footer button, so
the button cannot switch back. The return trip instead rides the HOST picker's
own panel: `conversation.input.model.options` is the list child slot the shipped
`ModelSelect` declares and renders directly after its Model / Effort rows, so our
control appears at the bottom of the native menu itself. It belongs to the
shipped entry, not to ours, so it outlives the disposal; and it renders `null` in
flat mode, so the shipped menu looks exactly as shipped while the panel is on
screen. Clicking it dismisses the host menu first (the entry that owns the menu
is about to be disposed) and then flips the mode back.

**It does not look like a menu row.** Every row above it answers "which value?";
this one performs an action. So it is drawn as a separated bottom band — a 1px
`--dsw-alias-border-l2` rule above, then a full-width 30 px outlined button
(`--dsw-alias-border-l3`, `--dsw-radius-sm`, 12/18 medium label, 14 px icon) with
a hover fill and a focus ring. The slot gives occupants only a `display: contents`
anchor, so that whole box is ours; nothing about the host menu's own rows has to
be imitated. The distinction is pinned by a test that asserts the button carries
no `role="menuitem"`.

Nothing here is a copy of the host control: the row is one entry in a slot the
installed package publicly declares. The former placement — a chip in
`conversation.input.right`, beside the native
trigger — was dropped because it read as a toolbar control belonging to nothing
in particular, and because it forced the mode control to sit outside the panel
it acts on.

**One shared store.** Both controls read one page-wide mode store, so a flip made
from either is what the other sees. The store persists the choice to
`localStorage` (`dshmf:mode`, the same origin-scoped mechanism as the grouping
choice) and degrades to `flat` whenever storage is unavailable — a missing store
must never leave the composer without a model control.

**Reported state is the visible state.** The panel only renders while it owns the
cell, so the stored mode and the on-screen mode can disagree in exactly one case:
`native` persisted with nothing to inherit the cell. The button's `aria-pressed`
then reports flat, because it describes what is on screen, not what is in
storage.

**What changes across a switch.** Coming back from native mode remounts the
panel, so it opens closed with an empty query. Focus follows the disposed
button down to the document; cross-plugin DOM queries for focus are not allowed,
so it is not chased.

## Project link

Immediately left of the `默认样式` / `Default style` button sits an icon button
that opens this project's GitHub page in a new tab. The two are one trailing
**pair**, held in a single container (`.dshmf-actions`) with a 2px gap between
them; the pair carries the footer's auto margin, so it stays pinned to the
panel's bottom-right and wraps as one unit on a narrow panel.

Grouping them is what makes that gap small. The footer spaces its own groups by
`column-gap: 30px` — the distance between the reasoning group, the teamwork row
and the trailing pair — and that gap applies between flex items. While the two
buttons were separate footer items it fell between them too, so the space was
30px + the icon's margin, and no margin on either button could shrink it. As one
item the 30px stays outside the pair and the inner spacing is the container's
own 2px.

**The address is derived, never hardcoded.** The browser half has no filesystem
and no subprocess, so the Host reads the checkout with
`git remote -v` and converts the first usable GitHub remote into a page URL.
`origin` is tried first, then `upstream`, then the rest in configuration order.
Every spelling git writes for the same repository resolves to the same page:

| Configured remote | Opened page |
|---|---|
| `git@github.com:owner/repo.git` | `https://github.com/owner/repo` |
| `https://github.com/owner/repo.git` | `https://github.com/owner/repo` |
| `ssh://git@github.com/owner/repo` | `https://github.com/owner/repo` |
| `git://github.com/owner/repo.git` | `https://github.com/owner/repo` |
| `github.com:owner/repo` | `https://github.com/owner/repo` |

A remote on another host (GitLab, Bitbucket, a self-hosted server) is refused
rather than rewritten: opening a *different* repository than the one configured
would be worse than opening the fallback, because nothing on screen would say
the destination changed. Renaming the repository, moving it to another owner, or
adding a fork upstream all change the destination without touching this plugin.

**When there is no GitHub remote.** An npm-installed copy ships no `.git`, and a
plain tarball has none either, so the button opens
`https://github.com/zuosus/dsh-model-flatmap` — this project's own page — and
its tooltip says so. That address is the one hardcoded value in the feature,
declared once in `repo-url.js` and pinned by a test to `package.json`'s
`repository.url` and `homepage` so the three cannot drift apart. The browser
half repeats it (it cannot import a Host-only module), and a second test pins
that repetition.

**The click does not wait on the network.** The URL is prefetched when the panel
opens, so the ordinary click has it in hand and opens the tab synchronously —
`window.open` after an `await` is a popup the browser may block. Only a click
that beats the prefetch takes the async path. A tab the browser refuses anyway
is reported in the button's tooltip instead of being swallowed, and only an
`http(s)` address can reach `window.open` at all: a payload naming
`javascript:`, `file:` or any other scheme is discarded for the fallback.

**Transport.** The Host answers one read-only route,
`/dsh-model-flatmap/project-link`, resolved on every request rather than at
activation — a remote added while the Host is running is picked up by the next
click. It is guarded by the same Host/Origin fence and authenticated-Peer check
the shipped plugins apply to their own routes, and fails closed if that check
cannot answer. A composition without a web server simply does not register it,
and the button falls back.

## Data and interaction

Everything goes through public Client APIs:

- `ctx.modelDirectories.directoryFor(sessionId)` supplies the catalog, the
  current selection, and the pending selection; `load()` refreshes it and
  `select()` submits.
- The directory store is subscribed through `useSyncExternalStore`, so a
  catalog update — including one caused by a selection — repaints the panel.
- `ctx.sessions.binding(sessionId).eventSource` is the Session's contiguous
  durable event window. A single module-level store folds the feed of **every**
  Session the Session list names (`ctx.sessions.list`) to derive the global
  per-model insufficient-balance marks, persists them to `localStorage`, and
  every seat subscribes through `useSyncExternalStore` so a mark transition
  repaints the panel while every other event stays quiet. The same store also
  re-reads the clock on subscribe, on panel open and on a self-armed timer,
  because a strike reaching its 24-hour age is a transition no feed will ever
  report. A snapshot is replaced only when the set of drawn marks actually
  changed, so those extra reads cannot churn the panel.
- `ctx.get('remote').agentTeams.setEnabled()` writes the teamwork selection.
- `ctx.locale` supplies the copy, resolves catalog badge text, and prefers the
  host's own `agent-team` wording when that namespace is registered.
- `slots.register()` / its disposer and `slots.entries()` / `slots.subscribe()`
  drive native mode: disposing this plugin's `conversation.input.model` entry
  elects whatever the Host registered underneath, and `entries()` is what makes
  that verifiable before the switch. `slots.subscribe()` re-runs the reconcile,
  so a shipped picker that appears (or disappears) later enables or disables the
  button without a reload.

The plugin does not read or restyle host components or stylesheets. The one
exception is the Settings navigation glyph: the host section contract exposes
only `id`, `order`, and `label`, and unknown section ids receive the default
gear. A narrowly scoped `MutationObserver` finds this section by its localized
label and replaces only that glyph with a list icon; it disconnects when the
plugin effect is disposed.

## Provider and model visibility

A profile with many connection plugins offers more models than anyone picks
between, so the panel can be narrowed down. The controls live in the app's own
settings panel, as the **Model list** section.

### Where it lives

The section occupies `settings.section`, the settings domain's own extension
point: one page per registration, with the registration's `label` in the
settings nav column. It registers with an id of its own (`model-flatmap`), so it
is added **beside** the shipped sections rather than replacing one, and it
declares no `children`, so it is a leaf.

It is deliberately not a `plugins.bundle.config` page. That seat renders inside
the **Plugin Manager's** bundle detail page, which answers "how is this package
configured"; "which models do I want to see" is a preference about the composer,
and belongs where the app's other preferences are.

### What it shows

Every provider is one row: a disclosure button carrying the chevron, the
provider's name, and how many of its models are on, then a separate switch. The
disclosure spans the whole text side of the row, so a click anywhere between the
chevron and the switch expands it. Expanding the row lists that provider's
models, each with its own switch. Provider switches stay on the brand blue;
model switches take a hue shifted towards the success tint, so the master
control and the per-model exceptions never blur.

The provider switch is a **bulk action**, not an override. Switching it off
writes every one of that provider's model keys; switching it on clears them.
The model switches stay live the whole time, so the workflow the feature exists
for works: switch a provider with dozens of models off, then switch the two or
three you want back on. A provider in that state reports `mixed` on its switch
and "N on" beside its name, and a provider with every model off dims and says
"all off".

The section reads the catalogue from `remote.session.modelCatalog()`, which is
the Host-generation catalog shared by every Session. It is not Session-scoped,
which matters because the settings panel has no Session and
`modelDirectories.directoryFor(sessionId)` requires one. The call resolves to
`RemoteResult<ModelCatalog>` — `{ok:true,value}` or `{ok:false,error}` — so the
value is unwrapped once; a rejected call and an `ok:false` result both mean "no
catalogue", which the section states plainly rather than treating as a failure
the user must fix.

### What it stores

The record holds what is **hidden**; absence means visible. That is what lets a
provider or model added by a plugin installed tomorrow appear without anyone
re-opening Settings, and it keeps the common record empty.

Keys are route keys, the same `provider/model` pair the insufficient-balance
marks use, plus a bare provider id for a provider-wide switch. Both live in one
record, so a provider switch and a per-model exception can never disagree about
which was written last. The two key shapes cannot collide: provider ids contain
no `/`, and routes always do.

A provider switch writes the same per-model keys a user could write one at a
time, so the two controls compose instead of one overriding the other. That is
what makes "switch the provider off, then switch a few models back on" produce
an ordinary record with no special case in it.

A record written by an earlier design stored a bare provider id as an override.
It is still honoured when reading, so an existing record keeps working, and the
settings page folds it into per-model keys as soon as the catalogue names the
models it covered. A provider key whose provider is no longer in the catalogue
is left alone rather than guessed at.

### Provider names

Each provider row also offers a rename action: the pencil between the
disclosure and the switch is always present, and is tinted once a provider
carries a name. Clicking it replaces the disclosure with an inline editor,
using the shipped Models page's own field
geometry (32 px, a `.5 px` `border-l4`, `--dsw-radius-md`, `bg-layer-1`). The
input is prefilled with the current alias; the original catalog name is shown
as the placeholder, in the helper line and on the collapsed row's quiet meta
line. The chevron is drawn as a non-interactive ghost so the field starts
exactly where the name did. `Enter` or the check
saves; `Escape` or the cross cancels; moving focus out of the editor commits.
The circular-arrow suffix restores the catalog name in one click. Enter
during IME composition is ignored. A name already used by another provider —
in the catalog or as an alias, compared case-insensitively — is reported but
never blocked, through a live region that exists for the editor's whole life so
the warning is actually announced.

Two details keep the editor from fighting the pointer. The wrapper's blur is
the commit boundary, but every mousedown inside it except the field itself is
either default-prevented (padding, ghost chevron, helper line — focus stays in
the field) or flagged one-shot (the check, cross and reset buttons) so their own
handler decides the outcome; without that, a tap on Cancel on touch would
blur-commit first and then cancel an editor that had already saved. `Escape` is
handled on the wrapper so it works from the buttons too, while `Enter` stays
with the focused control — `Enter` on Cancel must cancel, not save.

The alias is a **display label only**. It is keyed by the provider's stable id,
so it cannot change routing, the hidden record's keys, the current selection or
the order of providers, and a rename survives a provider disappearing and
returning. It is stored in `localStorage` under `dshmf:aliases`; absence means
"use the catalog name", and a draft that normalizes to the original stores
nothing, so a future upstream rename still flows through. A read or write
failure degrades to the catalog names, exactly as the hidden record degrades to
"visible".

One function, `providerLabel(group, t, resolveText, alias)`, resolves the label
for every surface: the *By provider* heading, the provider primary text of a
*By family* row, its tooltip, the failure strip, and the provider face of
search. That is why there is no second place to update and why the panel and
Settings cannot disagree. Search still matches the catalog's name, the alias,
and a mix of both across a multi-token query; a provider hit still keeps its
whole catalogue. Family-row tails strip the **catalog spelling** only, because a
model name usually carries it; the alias is deliberately not stripped — it is a
user label and may be a word the model name legitimately uses (`Pro` in
`Claude 3.5 Pro Sonnet`).

Aliases are sanitized on the way in and out: control characters become spaces,
whitespace runs collapse, the value is trimmed, and it is capped at 48 Unicode
code points so an emoji is never split. They are literal, language-neutral
strings — the user typed one name, and both UI languages show it. Renaming the
provider a conversation is using is allowed; the trigger still names the model
and is unaffected. The shipped picker reached through `Default style` is the
host's own component and therefore keeps the catalog's names; a provider's
catalog name cannot be rewritten from this plugin.

### Where the filter applies

The filter runs on the single catalogue the panel derives everything from —
before grouping, before search, before column planning, and before the trigger's
label is resolved. A hidden entry therefore cannot reach the grid, the search
index, a group heading, or the model count by any route; there is no second
place that has to remember to filter. A provider left with no visible model is
dropped rather than drawn as an empty heading.

### Persistence and reactivity

The record is kept in `localStorage` under `dshmf:hidden`, like this plugin's
other preferences, and a read or write failure degrades to "everything is
visible": a browser that refuses storage loses the memory of the choice, never
the models. One store per activation is shared by the settings section and every
panel in the page, so a switch flipped in Settings re-renders an open panel
immediately, with no reload.

Hiding the model a conversation currently uses is allowed. The grid obeys the
switch, and the trigger still names the current model, because the trigger reads
the Session's selection rather than the catalogue. If every model is hidden the
panel says so and points back at Settings, instead of claiming that no models
are available.

Newly added providers and models are shown by default; the section says so.

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

Colours, radii, spacing, and elevation come from the `--dsw-alias-*`,
`--dsw-static-*`, `--dsw-elevation-*`, `--dsw-menu-*`, and `--dsw-radius-*`
tokens, so light and dark themes both follow the host palette. The selected
row's blue is deliberately drawn from the static palette (`--dsw-static-*`),
which is theme-invariant: the alias `--dsw-alias-state-business-primary`
flips to a light blue with dark text in the dark theme, which would break the
requested deep-blue-with-white-text treatment there. The panel uses the same menu surface
material as the host's own menus (menu fill, backdrop blur, prominent
elevation, large radius), and hover, focus, selected, and disabled states follow
the shipped picker's visual language.

Each provider / family label is deliberately set apart from the model rows
beneath it: it draws as a filled, rounded band that floats on
`--dsw-alias-bg-layer-1` with `--dsw-elevation-soft` — the same recipe as the
active segment. That fill is opaque white in light themes and near-black in
dark, so it steps clearly away from the translucent panel surface (and the
transparent model rows) in both themes, with no hard-coded colour. The bare
`--dsw-alias-menu-group-header-fill` token was only a few levels from the
surface and read as almost the same background as the rows (see DEC-005). The
label keeps smaller but bold type with a stronger label colour. The model rows
stay 13 px regular text on a transparent background, so the band reads as a
section header rather than another selectable row.

The band also carries a low-key frame: a hairline border
(`--dsw-alias-border-l2`) and a short brand-blue left edge
(`--dsw-alias-state-business-primary`, the panel's own accent). That marks each
group start clearly without boxing the group's rows — a group's rows may flow
across columns, so only its label is framed (see DEC-003).

### Long text: one-pass hover marquee

A model name, or a group heading, that does not fit its column is ellipsised.
Resting the pointer on it for 0.5 s starts a single, eased, leftward pass that
stops when the last glyph reaches the window's right edge; leaving resets it
immediately with no animation. The pass runs ONCE, is `ease-in-out` rather than
`linear`, and honours `prefers-reduced-motion: reduce` by not running at all.

Both a model row and a group title use the same structure, so only the text
slides and the frame never does: a clipped **window** (`overflow: hidden` +
`text-overflow: ellipsis`) wraps a **track** (`width: max-content`) that is
allowed to be wider than the window. For a row the frame is the row itself, so
the right-aligned tail, badge (`限时免费`, `x0.1`) and spinner never move; for a
title the frame is the band, so its fill, frame, radius and elevation stay put.
One state machine drives both — keyed by the row's route or the title's block
key — so only one thing in the panel scrolls at a time. The travel distance is
the measured overflow, and the duration is that distance divided by 50 px/s
(see DEC-021, DEC-022, DEC-023).

## Limitations

- The panel replaces the composer seat only; the `/model` popup is untouched.
- The panel's GRID does not host the `conversation.input.model.label` child
  slot: rows draw the catalog name plus `model.badge`. Only the TRIGGER renders
  that slot's winner, because that is what the native trigger does. The
  `conversation.input.model.options` slot is not drawn anywhere in the panel.
  The shipped registration keeps both declarations alive, so other plugins'
  contributions stay valid either way.
- The Host half sends one anonymous heartbeat per local day (DEC-031). It is
  the only network request this plugin ever makes on its own. Since DEC-035 the
  user can switch it off: Settings → Model list carries an *Anonymous usage
  statistics* toggle at the bottom of the panel, **on by default**. The choice
  is opt-out, so a machine whose owner never opens Settings keeps reporting —
  the toggle is a real choice, not a disguised default. What bounds the request
  is still its shape (installation id, plugin id, version, platform,
  architecture, event kind, nothing else) and its rate. The toggle lives in the
  browser (`localStorage`, `dshmf:telemetry`) but the send happens in the Host,
  so the browser mirrors the choice through the trust-fenced
  `/dsh-model-flatmap/telemetry-settings` route, which persists it to
  `telemetry-settings.json`; the Host re-reads that file before every send, so
  the next heartbeat honours it with no restart. A missing or damaged file reads
  as **enabled** — an unreadable choice must never silently silence reporting.
  Disabling the bundle stops the heartbeat with everything else.
- The trigger's label cell renders ANOTHER PLUGIN'S component. It is written
  against the documented `ModelLabelOwner` props, but nothing guarantees every
  future contributor stays compatible; `LabelBoundary` degrades a crash to the
  catalog name, which is the same fallback the host uses for an empty cell.
- Addressed subagent sessions hide the seat, matching the shipped selector.
- The visibility record is per-browser-origin (`localStorage`), so it does not
  follow an account to another machine or another browser profile. It narrows
  the **flat panel** only: the shipped `/model` popup and the Host's own picker
  (native mode) still list the whole catalogue, because neither reads this
  record. Hiding is presentation, not access control — a hidden provider is
  still configured, still billed, and still selectable through those other
  surfaces.
- The badge comes from the catalog entry, so a provider that publishes no badge
  shows none.
