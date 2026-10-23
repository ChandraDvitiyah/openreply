# Kult workspace design rules

Updated 23 October 2026. This is the design reference for the authenticated
dashboard: Social Media, SEO, and future work areas. The owner's explicit
typography, color, icon-size and radius rules below take priority over older
component styles. Spacing and component guidance codify the existing dashboard.

## Scope and sources

Use `app/globals.css` under `.dashboard-ui` as the shared implementation.
Reference `components/dashboard-shell.tsx`, `components/sidebar.tsx`,
`components/top-bar.tsx`, `app/(dashboard)/dashboard/page.tsx`, and
`components/bulk-dr-checker.tsx` for current layout patterns.

The public landing page, public Link Studio pages and simulated social posts
have separate visual identities. Do not import their display fonts, phone-frame
styling or platform graphics into workspace controls. Clerk owns the embedded
authentication/account UI; it is not evidence for a new workspace style.

## Typography

Keep the existing system font stack:

```css
font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display",
  "Helvetica Neue", Arial, sans-serif;
letter-spacing: -0.15px;
```

Only **400 (regular)** and **500 (medium)** are permitted. Use exactly four sizes:

| Size | Weight | Role |
| --- | --- | --- |
| 12px | 400; 500 for compact labels | Metadata, captions, helper text, table headings, rail labels, badges |
| 13px | 400; 500 for actions/selection | Body copy, navigation, form values, table cells, buttons |
| 14px | 500 for headings | Section/card headings, work-area title, compact emphasized values |
| 24px | 500 | Page title and primary metric values |

Use color, weight, grouping and whitespace to build hierarchy. Do not introduce
15/16/18/20/22/28px text, semibold/bold, uppercase letter-spacing presets, or a
different font to make a heading stand out. Icon dimensions are not type sizes.
Use semantic heading levels even when two levels share a size.

Page-title line-height is 1.25; section headings are 1.45; body copy is about 1.5
(up to 1.625 for explanatory copy). Buttons use 20px line-height. Numbers in
metrics and comparisons should use tabular numerals. Long domains wrap without
forcing the surrounding page wider.

## Color

| Token / value | Use |
| --- | --- |
| `--dashboard-ink`: `#292929` | Titles, values, active text, primary icons, focus outline |
| `--dashboard-secondary`: `#5D5D5D` | Body copy, inactive navigation, instructions, secondary actions |
| `--dashboard-tertiary`: `#9E9E9E` | Low-emphasis metadata, placeholders, decorative separators |
| `--dashboard-brand`: `#9CE069` | Primary CTA, selected tool, progress fill |
| `#86CD51` | Primary CTA hover |
| `--dashboard-brand-soft`: `#EFF8E9` | Quiet brand tint behind card icons/status |
| `#DCEBD2` | Border around the soft brand tint |
| `--dashboard-canvas`: `#F7F7F5` | Page canvas, work-area rail, inset surfaces |
| `--dashboard-surface`: `#FFFFFF` | Cards, tool sidebar, top bar, active rail item |
| `--dashboard-hover`: `#F3F3F0` | Neutral hover, neutral icon background |
| `--dashboard-border`: `#E6E6E3` | 1px borders, dividers, progress tracks |
| `#1E5653` / `#B42318` / `#9A6700` | Success / error / warning text |

Do not invent nearby grays or greens for each new page. Light semantic fills
may accompany warnings/errors; keep their text in the existing semantic palette.
Lime is a fill/accent, not small text on white. Essential instructions and actions
use primary or secondary ink. Tertiary gray is intentionally low emphasis;
do not claim it meets normal-text contrast requirements or use it as the only
way to convey a state. Always pair status color with words or an accessible label.

## Icons

Use **Lucide React** (`lucide-react`), outline style, `currentColor`, with round
caps and joins. Do not mix in Unicode symbols, emoji or another icon library for
workspace actions and metrics.

| Context | Icon size | Stroke width | Container |
| --- | --- | --- | --- |
| Both sidebar tiers, compact actions, field affordances | 14px | 1.8 | Nav row or control hit area |
| Cards, section introduction, empty/loading states | 20px | 1.7 | Usually 36×36px with 8px corners |

The icon's visual size and the clickable area are separate: small icons must
not create 14px hit targets. Icon-only buttons require an accessible name;
decorative icons beside text use `aria-hidden="true"`. Keep stroke consistent
within each role. No large globe/spinner icon to compensate for an empty card.

Platform marks, user avatars, uploaded content, and icons inside faithful social
post previews are content exceptions. Keep them isolated from product navigation.

## Spacing and layout

Use a 4px base rhythm: **4, 8, 12, 16, 20, 24, 32px**.

- Shell: 72px work-area rail + 232px contextual sidebar; 304px combined.
- Top bar and contextual sidebar header: minimum 64px high.
- Page content: maximum 1440px; 16px horizontal / 24px vertical padding on
  mobile, 32px on desktop.
- Section spacing: 24px; card grids usually 16–20px; metric grids 12px.
- Standard card body: 20px. Card header/footer: 20px horizontal and 16px
  vertical. Use 24px in larger form sections, not arbitrary per-page values.
- Heading to description: 4px. Label to control: 8px. Icon to text: 8–12px.
- Navigation: 12px horizontal / 10px vertical inset; 4px between tool rows.
  The established 10px nav inset and 6px pill inset are optical exceptions.
- Inputs: 12px horizontal padding, typically 36px minimum height. Textareas
  may be taller/resizable. Center field icons vertically rather than using a
  hardcoded top offset.

At widths below 1024px, both sidebar tiers belong to one dismissible drawer.
Keep the overlay, Escape handling, focus containment/restoration and inert
background. Keep hidden navigation out of keyboard traversal. Use a single
column for dense tool panels until enough width is available; the DR checker
splits into a 320px input column and flexible results column at 1280px.
Allow a table to scroll within its card; avoid page-level horizontal scrolling.

## Shapes, surfaces and controls

- **Navigation: 8px radius**, in both tiers (`--dashboard-radius-nav`). The
  active work area uses white plus a subtle border; the active tool uses lime.
- **Cards: 16px radius** (`--dashboard-radius-card`). Use `.panel`: white,
  1px neutral border, no shadow. Full-width notices follow the same radius.
- **CTAs: pill radius** (`--dashboard-radius-cta`, 999px). Reuse
  `.button-primary` and `.button-secondary`, 13px medium, minimum 36px high,
  8px icon gap. The primary action is lime with dark text; secondary is white
  with a neutral border. Keep hover stationary, without a vertical lift.
- Inputs, compact icon tiles and segmented navigation use 8px corners.
  Avatars/status dots are circular; badges and progress tracks may be pill-shaped.
- Quiet text actions remain text actions; do not give every link a pill or card.
- Active navigation uses `aria-current`; disabled controls need both a disabled
  attribute and visible disabled styling. Keep focus visible with a 2px dark
  outline and 2px offset (1px offset on fields).
- Preserve the shared reduced-motion rule. Motion should explain loading/state,
  not decorate the dashboard. Shadows are reserved for genuine overlays.

## Data and feedback

Use 12px table labels, 13px cells, neutral dividers and 24px summary values.
Keep unavailable values distinct from zero. Keep the last-check timestamp visible
when displaying a prior report. Give empty, loading, error and disconnected states
their own text. Loading controls retain their labels and communicate busy state;
errors use `role="alert"`, asynchronous status uses `role="status"`.
Required attribution is visible at normal caption size. Never show simulated
metrics as live results or expose API credentials in product copy.

## Design audit — 23 October 2026

This was a source audit of the shell, overview, Views chart, Schedule, Link Studio,
shared controls, loading states, and the new SEO page. Rendered verification
focuses on the revised sidebar/SEO components; this is not a claim that every
legacy page has been visually normalized.

Rendered checks on the revised sidebar/SEO view found only 12/13/14/24px text,
400/500 weights, and -0.15px tracking. Both navigation tiers use 14px icons and
8px corners; panels compute to 16px and CTAs to 999px. Results metrics remain
24px and table values 13px. The 390px mobile drawer preserves these sizes and
does not produce page-level horizontal overflow.

| Finding | Resolution / status |
| --- | --- |
| New rail used 20px nav icons, 12px corners, a shadow, and extra gray shades; work-area title was 15px | Corrected to 14px Lucide nav icons, 8px corners, flat surfaces, shared colors and 14px medium title |
| SEO used 22px metrics, 13–38px icons, multiple off-palette neutrals/greens, and 12px notice corners | Corrected to the four-size type scale, 14/20px icons, shared palette and 16px notice corners |
| Shared stat card used Unicode glyphs instead of the main icon family | Replaced with 20px Lucide icons |
| Shared CTA inherited the landing page's upward hover movement; small heading weight was implicit | Dashboard hover is stationary; section headings explicitly use medium weight |
| Legacy Tailwind font classes are visually clamped by `.dashboard-ui` rules | Compatibility layer retained; new markup must use the correct sizes/weights directly |
| Schedule CSS still defines 10/11/18/28px text, 600 weight, and mixed 12/14/20px container radii; action icons vary | Follow-up: normalize workspace chrome in `components/scheduler.css` and `components/scheduler.tsx`; preserve simulated post content |
| Views chart has explicit 11px SVG ticks and `#777` labels; Link Studio editor has older spacing/radius utilities | Follow-up: align `components/views-daily-chart.tsx` and editor chrome in `components/link-studio.tsx`; distinguish computed styles from utilities overridden by global CSS |
| Account selector uses an old uppercase/tracking class and removes its outline | Follow-up: simplify its label and ensure a visible keyboard focus indicator |

## Review before adding a workspace section

1. Reuse the current shell, `.panel`, action classes and palette.
2. Check computed font family, size, weight and tracking; source utilities alone
   are insufficient because the dashboard has compatibility overrides.
3. Verify every navigation icon is 14px and card icon is 20px, from Lucide.
4. Check 8px nav, 16px card and pill CTA radii, spacing and text hierarchy.
5. Inspect desktop and mobile, keyboard focus, empty/loading/error/data states,
   long values and overflow. Use a focused visual check for visual-only changes;
   do not add brittle snapshot tests that merely duplicate the CSS.
