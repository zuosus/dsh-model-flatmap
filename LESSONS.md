# LESSONS

Project-level lessons log for the dsh-model-flatmap plugin. Append-only: new
entries go below the marker, newest first; old entries are never rewritten.

<!-- APPEND-ONLY LOG: 新条目插入到此行之后 -->

## LES-004 — 2026-11-13 — Verify a fill's *composited* contrast, not just its name or value

`--dsw-alias-menu-group-header-fill` is designed for the host's own menus,
where it sits against a different surface. On this panel — whose rows sit on
translucent `--dsw-menu-surface-fill` — the two are nearly the same colour (a
few levels apart) in both themes, so the bare token (even with DEC-003's frame)
does not buy separation. Two traps: (1) judge a fill by the **composited**
result over the actual surface/backdrop, not by its raw value; (2) do not
assume mixing toward `--dsw-alias-label-primary` helps — that token is dark in
light themes, but a light-theme header band must get *lighter* than the surface
to stand out, so that tint actually reduced separation. The robust fix was the
panel's own floating-segment recipe: an opaque `--dsw-alias-bg-layer-1` fill
(white in light / near-black in dark) with `--dsw-elevation-soft`, which
separates in both themes with no hard-coded colour or second theme branch.
Also: when concurrent writers already took DEC-003/LES-003, append with the
next free IDs instead of reusing or renumbering theirs.

## LES-003 — 2026-11-13 — Verify a row-layout change against the REAL panel width, not a guessed one

`PANEL_MAX = 320` is the panel's **height** cap, not its width: the placement
effect sets `width = clamp(280, vw - 24, 560)`, so the panel is normally much
wider than 320 px. Previewing the new per-row provider tag in a 320 px mock
therefore showed "CodeBuddy …" truncation that does not happen in the product,
and it took a `max-width: 45%` cap — which *caused* real truncation at the true
width — to notice the mistake. Read the placement code for the real geometry
before judging a dense layout, and drop width caps on secondary text: flex
already shrinks it, and a cap truncates labels that had room.


## LES-002 — 2026-11-13 — "Multi-segmentation" means reusing the panel's own segment recipe

When the user asks for a "multi-segmentation 控件" visual, do not invent a
new control: reuse the token recipe the panel already ships for
`.dshmf-seg`/`.dshmf-segBtn` (`interactive-bg-hover` track + 2 px inset +
`bg-layer-1` active segment + `elevation-soft`). Two segment-styled controls
on one panel read as one design system; a third invented flavour (e.g. the
brand-fill pills of DEC-001) is what prompts the redesign. Also: the
user-specified wording for a caption (推理等级 vs 思考强度) is a spec item —
use their exact term, and keep the explanatory detail in a tooltip instead
of widening the caption.

## LES-001 — 2026-11-13 — Host token/theme inspection: grep the asar with narrow windows only

The installed host ships its entire client (including the `--dsw-alias-*`
theme CSS) inside a single ~200 MB `app.asar` file. `grep -a` with a wide
context window (`.\{80\}`) against it takes minutes and overruns the bash
timeout. Use narrow windows (`grep -ao -- "token:[^;}]*"`), or verify a token
by its use in already-working plugin code. `--dsw-alias-brand-primary`,
`--dsw-alias-label-primary-foreground`, and `--dsw-radius-md` were confirmed
present this way; the brand/foreground pairing is already exercised by the
host switch, so it is safe for text on a brand background in both themes.
