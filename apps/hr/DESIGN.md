# Design System: MM HR — "Gold & Black on a soft wash"

**Scope: the whole HR app (`apps/hr`), a staff / operate-mode world of its own.** It is not the hotel's neutral blue staff theme and never the guest "Woven Ledger". Light by default, with a dark theme (below).

Visual authority: three user-supplied reference screens. Only their **component styling** was taken (how buttons, tables, chips, panels look); layout, placement and concept are this app's own.

## Overview

Calm, frosted, high-legibility. A diagonal wash ground, large soft panels, pill controls, and exactly two accent colors with fixed jobs:

- **Black does** — primary action, active navigation, checked state.
- **Gold marks** — selection, highlight, data, focus ring.
- Gold is never text on a light ground; text on gold is always black.

## Colors

| Token | Value (oklch) | Use |
|---|---|---|
| `--wash-cool` → `--wash-warm` | `0.925 0.006 255` → `0.975 0.045 95` | Page ground, 135° gradient |
| `--ink` | `0.22 0.01 85` | Text, primary buttons, active nav |
| `--ink-muted` | `0.5 0.012 85` | Secondary text |
| `--gold` | `0.85 0.15 90` | Selected row, gold button, data |
| `--gold-deep` | `0.74 0.14 82` | Hover, focus ring |
| `--gold-soft` | `0.955 0.07 92` | Row hover, soft highlight |
| `--card` | `0.997 0.006 95 / 0.88` | Frosted panel (kept ≥85% opaque for AA) |
| `--ok` / `--danger` / `--warning` | green / red / amber | Status tints only |

## Typography

- **Urbanist Variable** (`font-display`): page titles and large numerals, light weight (300), large size.
- **Inter Variable** (`font-sans`): all dense text, tables, forms. Tabular figures in tables.

## Shape and material

- Panels (`.panel` utility): frosted near-white, `radius-3xl`, soft long shadow, no hard border.
- Controls are pills (`rounded-full`); icon buttons are circles. Base radius `1rem`.
- Table: dotted 1px row dividers, quiet `text-xs` muted header, hover = `gold-soft`, selected = `gold`.
- `.hatch` utility: diagonal hairline hatch for genuinely empty regions, always paired with a text label.

## Components

Copied from the hotel app's shadcn-svelte set and restyled in place under `src/lib/components/ui/`:
button (`default` black, `gold`, `outline` white, `ghost`), input (white pill), badge (`ok`, `muted`, `gold` tinted with a dot), table, dialog (`rounded-3xl`), sidebar (pill items, active = black pill), sonner (light).

## Layout

Left collapsible sidebar (sheet on mobile) + inset content on the wash. Page = large light title → one frosted panel containing toolbar (search, filter chips, primary action) and the table. Single-column, scan-first.

## Do's and Don'ts

- Do keep frosted surfaces ≥85% opaque; never place text directly on the gradient.
- Do pair gold selection with a check/checkbox state — never color alone.
- Don't use gold for text on white. Don't add a second accent hue. Don't add dark mode without re-deriving the wash.

## Dark theme — "black & gold, lit from within"

`.dark` on `<html>`, toggled from the sidebar footer (Dark mode / Light mode), remembered in `localStorage` (`hr-theme`), defaulting to the device setting and applied before paint in `app.html`. Tokens live in `src/app.css` (`.dark { … }`).

- **Ground:** warm near-black wash with a faint gold glow from the top-right; panels are raised charcoal with a hairline border.
- **Roles invert:** `--ink` becomes warm off-white so `text-ink`, `border-ink/*` and `bg-ink/*` keep working. Black can no longer "do", so the **primary action is gold with black text**; gold still marks selection and data. Text on gold is black (`--on-gold`).
- **Sidebar:** the active item gets a gold outline pill.
- **`bg-white` / `text-white`** map to `--white`: pure white in light, raised charcoal in dark.
- **Print routes are always light** (`routes/print/+layout.svelte` removes `.dark`).
- Decorative gem/glass art from the reference is deliberately left out; HR is a task tool.
