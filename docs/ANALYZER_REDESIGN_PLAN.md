# Analyzer Redesign Plan
> Status: PENDING APPROVAL
> Author: Claude
> Date: 2026-03-12

---

## 1. Detection Zone Color System (Exact from V1 `_premium_additions.css`)

The overlay color system uses **3 primary visual types** matching Landing.AI's own playground UI. All 14 ADE chunk types map into one of these buckets.

### Primary Type → Color Mapping

| Chunk Type       | Category    | Overlay Color   | Hex       | Bg Fill at Rest              | Bg Fill Active/Hover         |
|------------------|-------------|-----------------|-----------|------------------------------|------------------------------|
| `text`           | Text        | Emerald Green   | `#32D583` | `rgba(50,213,131,0.18)`      | `rgba(50,213,131,0.32)` hover / transparent active |
| `title`          | Text        | Emerald Green   | `#32D583` | same as text                 | same as text                 |
| `page_header`    | Text        | Emerald Green   | `#32D583` | same as text (dimmer opacity)| same as text                 |
| `page_footer`    | Text        | Emerald Green   | `#32D583` | same as text (dimmer opacity)| same as text                 |
| `page_number`    | Text        | Emerald Green   | `#32D583` | dim — opacity 0.08           | same as text                 |
| `key_value`      | Text        | Emerald Green   | `#32D583` | same as text                 | same as text                 |
| `attestation`    | Text        | Emerald Green   | `#32D583` | same as text                 | same as text                 |
| `form`           | Text        | Emerald Green   | `#32D583` | same as text                 | same as text                 |
| `table`          | Table       | Blue            | `#2193FD` | `rgba(33,147,253,0.12)`      | `rgba(33,147,253,0.22)` hover |
| `table_cell`     | Table Cell  | Blue            | `#2193FD` | invisible at rest (`opacity:0`) | `rgba(33,147,253,0.15)` active only |
| `figure`         | Figure      | Pink / Magenta  | `#FF5CFF` | `rgba(255,92,255,0.13)`      | `rgba(255,92,255,0.26)` hover |
| `card`           | Figure      | Pink / Magenta  | `#FF5CFF` | same as figure               | same as figure               |
| `scan_code`      | Figure      | Pink / Magenta  | `#FF5CFF` | same as figure               | same as figure               |
| `logo`           | Figure      | Pink / Magenta  | `#FF5CFF` | same as figure               | same as figure               |
| `error`          | Text        | Slate           | `#64748b` | `rgba(100,116,139,0.1)`      | `rgba(100,116,139,0.2)`      |

### Overlay Behavior Rules

**At rest:**
- Border: 1.5px solid `{typeColor}`
- Background: semi-transparent fill (see table above)
- Label tag: hidden (`opacity:0`)
- `table_cell`: completely invisible — `opacity:0`, `pointer-events:none`

**On hover:**
- Background: stronger opacity fill
- Glow ring: `box-shadow: 0 0 0 1.5px {typeColor}`
- Label tag appears: pill badge above top-left corner showing chunk type name

**On active (clicked / selected from right panel):**
- Border: 2px solid `{typeColor}` (2.5px for table)
- Background: transparent (just border)
- Glow: `box-shadow: 0 0 0 1px {typeColor}`
- `table_cell` active: border 2px solid `#2193FD` + bg `rgba(33,147,253,0.15)` + outer glow `0 0 0 3px rgba(33,147,253,0.22)` — becomes visible

### Overlay Label Style
- Position: absolute, `top: -20px; left: 0`
- Font: 10px bold, `border-radius: 3px 3px 0 0`
- text bg: `#32D583` black text | table bg: `#2193FD` white text | figure bg: `#FF5CFF` white text
- Appears on hover and when active

### Markdown Section Highlight (right panel sync)
When a chunk is selected in right panel, its markdown section also highlights:
- text:   `bg: rgba(50,213,131,0.09)` + `border: 1.5px solid #32D583` + glow `rgba(50,213,131,0.12)`
- table:  `bg: rgba(33,147,253,0.09)` + `border: 1.5px solid #2193FD` + glow `rgba(33,147,253,0.12)`
- figure: `bg: rgba(255,92,255,0.08)` + `border: 1.5px solid #FF5CFF` + glow `rgba(255,92,255,0.10)`

---

## 2. Section 1 — Pre-Upload State (Home View)

### Current State
DocumentRail (left 256px) + simple 3-card ActionCards grid

### Redesigned Layout
```
┌──────────────────────────────────────────────────────────────────┐
│  DocumentRail (256px)  │  Main Area (flex-1)                     │
│                        │                                          │
│  [Doc list / skeleton] │  ┌─ Page Header ──────────────────────┐ │
│                        │  │ "Document Analyzer"                 │ │
│                        │  │ subtitle                            │ │
│                        │  └─────────────────────────────────────┘ │
│                        │                                          │
│                        │  ┌─ Upload Zone (large, centered) ────┐ │
│                        │  │  Cloud upload icon (animated)       │ │
│                        │  │  "Drop your financial document"     │ │
│                        │  │  "or click to browse"               │ │
│                        │  │  Supported: PDF · DOCX · PNG · TIFF │ │
│                        │  │  Dashed border, green accent        │ │
│                        │  └─────────────────────────────────────┘ │
│                        │                                          │
│                        │  ┌─ 3 Action Cards (horizontal) ──────┐ │
│                        │  │  [Parse]  [Extract]  [Chat]         │ │
│                        │  │  Each clickable → opens file picker │ │
│                        │  └─────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### Upload Zone Spec
- Width: full, max-width 680px, centered
- Height: 180px
- Background: `rgba(5,150,105,0.03)` at rest → `rgba(5,150,105,0.07)` on drag-over
- Border: `2px dashed rgba(5,150,105,0.25)` at rest → `2px dashed #059669` on drag-over
- Border-radius: 20px
- On drag-over: scale(1.01), border solid green, bg stronger
- Cloud icon: 48px, green, subtle float animation
- Primary text: "Drop your financial document here" — 16px semibold
- Secondary text: "or click to browse" — green link style
- Format chips: PDF · DOCX · PNG · JPEG · TIFF (small grey pills)
- Entire zone is clickable → file picker (accept same as current)

### 3 Action Cards (below upload zone)
- 3-column horizontal row
- Smaller than current: padding 20px, rounded-xl
- Icon + Title + one-line description
- Subtle bg, no button — clicking the card opens file picker for that action
- Hover: lift + green border

---

## 3. Section 2 — Workspace (After Upload)

### Layout
```
┌─────────┬──────────────────────────┬──────────────────────────────┐
│Document │    DocViewer             │   Right Panel                │
│Rail     │    (~48% width)          │   (flex-1, min 340px)        │
│(240px)  │                          │                              │
│         │  [Header bar]            │  [Tab bar: Parse|Extract|Chat│
│         │  filename | p.X/Y | zoom │                              │
│         │                          │  [Sub-panel content]         │
│         │  [PDF canvas]            │                              │
│         │  + colored bbox overlays │                              │
│         │  + overlay labels        │                              │
└─────────┴──────────────────────────┴──────────────────────────────┘
```

---

## 4. DocViewer — Left Panel Enhancements

### Header Bar (new)
- Back button (← Back)
- Filename (truncated)
- Spacer
- Page counter: `p. 3 / 12` (auto-updates on scroll)
- Zoom controls: `−` · `fit` · `+` buttons (small, grey, pill)

### Overlay Rendering
- Each chunk from parse data = one `<div class="overlay-box overlay-box--{type}">` positioned absolutely over PDF canvas
- Coordinates: `left = box.left * 100%`, `top = box.top * 100%`, `width = (box.right - box.left) * 100%`, `height = (box.bottom - box.top) * 100%`
- `table_cell` overlays rendered but invisible at rest (opacity:0) — only appear when that cell is activated from markdown
- Label tag: `<span class="overlay-label">{type}</span>` inside each overlay box
- Clicking an overlay box → selects corresponding chunk in right panel + auto-scrolls chunk list

**Colors applied as CSS classes:**
- text, title, key_value, page_header, page_footer, page_number, attestation, form → `overlay-box--text` → `#32D583`
- table → `overlay-box--table` → `#2193FD`
- table_cell → `data-chunk-type="table_cell"` → `#2193FD` (invisible at rest)
- figure, card, scan_code, logo → `overlay-box--figure` → `#FF5CFF`
- error → `overlay-box--error` → `#64748b`

---

## 5. Right Panel — Parse Tab (Full Redesign)

### Three sub-tabs: `Chunks (N)` | `Markdown` | `JSON`

---

### 5a. Chunks Sub-tab

**Type filter pill row** (sticky at top):
- Pills: All · Text · Table · Figure · Title · Key-Value
- Active pill: filled green bg, white text
- Each pill shows count: "Table (4)"
- Clicking a pill filters the list below

**Chunk card list:**
```
┌──────────────────────────────────────────────────────┐
│ ▌  [type badge]   [section header]       p.3         │
│    Preview text line 1 (max 2 lines)...              │
│    Preview text line 2...                            │
└──────────────────────────────────────────────────────┘
```
- Left accent bar: 3px, type color (`#32D583` / `#2193FD` / `#FF5CFF`)
- Type badge: colored pill, small (10px), bg = `{typeColor}18`, color = `{typeColor}`
- Section header: grey small text with `§` prefix (if available)
- Page chip: `p.3` right-aligned, slate
- Content preview: 2 lines, HTML stripped, monospace-ish font
- **On click:**
  - Card gets selected style (green bg + left green border)
  - Fires `onHighlight()` → PDF viewer highlights the bbox overlay
  - Smooth auto-scroll to that overlay on the PDF canvas
  - Scroll the markdown view to the matching `<a id='uuid'>` anchor

---

### 5b. Markdown Sub-tab

**Properly rendered HTML markdown** (not raw `<pre>`):

**Rendering rules:**
| Markdown pattern | Rendered as |
|---|---|
| `# Heading` | `<h1>` — 20px bold, dark, bottom border |
| `## Heading` | `<h2>` — 17px bold, slightly indented |
| `### Heading` | `<h3>` — 15px semibold |
| `**bold**` | `<strong>` |
| `*italic*` | `<em>` |
| `\`code\`` | `<code>` — monospace, green bg pill |
| HTML tables (`<table id="0-1">`) | Rendered with full borders, alternating rows |
| Table cell (`<td id="0-2">`) | Clickable — fires cell bbox highlight |
| `<a id='uuid'>` chunk anchors | Used as scroll targets |
| `<!-- PAGE BREAK -->` | Visual page divider line with page label |
| Plain text blocks | `<p>` with line-height 1.7 |

**Table styling (matches V1 extracted-table):**
- Header row: `background: #f8fafc`, `color: #374151`, `font-weight: 600`, bottom border `2px solid #e2e8f0`
- Odd rows: `#fff`, Even rows: `#f9fafb`
- Hover row: `rgba(33,147,253,0.07)`
- Cell click → `outline: 2px solid #2193FD` + `background: rgba(33,147,253,0.14)` + triggers cell bbox highlight on PDF

**Chunk section wrappers:**
- Each chunk markdown is wrapped in `<div class="markdown-section" data-chunk-id="uuid" data-chunk-type="text|table|figure">`
- When that chunk is selected in Chunks tab or from PDF overlay: wrapper gets `highlighted--text` / `highlighted--table` / `highlighted--figure` class → coloured bg + border
- Auto-scroll: when chunk selected from Chunks tab, markdown scrolls to `<a id='uuid'>` anchor

**Search bar** (top of markdown view):
- Small input: "Search in document…"
- Highlights matching text with yellow bg as user types
- Shows match count: "3 of 12"

---

### 5c. JSON Sub-tab

**Content:**
- Full chunks array as formatted JSON
- Syntax highlighted:
  - Keys: `#0891b2` (blue)
  - String values: `#059669` (green)
  - Numbers: `#d97706` (amber)
  - Booleans/null: `#6366f1` (indigo)
- Monospace font, font-size 11px, line-height 1.6
- Copy button (top-right): copies full JSON, shows "Copied!" feedback

---

## 6. Right Panel — Extract Tab (Visual Polish Only)

No data changes. Visual improvements:
- Metric group cards with subtle left border accent
- Numbers formatted with B/M/K suffixes
- Audit opinion badge: green (Clean) / amber (Qualified) / red (Adverse/Disclaimer)
- Red flags: warning cards with amber left border + icon
- Empty state: clean illustration + "Extract data to see financial metrics"

---

## 7. Right Panel — Chat Tab

No changes needed. Already solid.

---

## 8. Files to Create / Modify

| File | Type of change |
|---|---|
| `frontend/app/dashboard/analyzer/page.tsx` | Full redesign: home view (upload zone + cards) + workspace layout |
| `frontend/components/analyzer/ActionCards.tsx` | Replace 3-card grid with large upload zone + smaller feature cards |
| `frontend/components/analyzer/ParsePanel.tsx` | Add HTML markdown renderer, JSON tab, type filter pills, enhanced chunk cards, markdown section wrappers with scroll sync |
| `frontend/components/analyzer/DocViewer.tsx` | Add header bar (page counter + zoom), overlay CSS classes, label tags |
| `frontend/components/analyzer/ExtractPanel.tsx` | Visual polish only |
| `frontend/app/globals.css` | Add overlay CSS classes (`.overlay-box--text`, `.overlay-box--table`, `.overlay-box--figure`, `.overlay-label`, `.markdown-section`, `.highlighted--*`) |

**No changes:** `ChatPanel.tsx`, `DocumentRail.tsx`, `ProcessingStatus.tsx`

---

## 9. Interaction Flow (End-to-End)

```
User uploads PDF
    → ProcessingStatus shows progress
    → On complete → workspace opens

Workspace loads:
    → DocViewer renders PDF pages
    → ParsePanel fetches chunks → renders overlays over PDF
    → Each overlay positioned by normalized bbox coords
    → Chunks tab shows list with type-colored cards

User clicks a chunk card (right panel):
    → Card highlights green
    → PDF viewer scrolls to that page
    → That chunk's overlay goes "active" (colored border, no fill)
    → Markdown tab scrolls to matching <a id> anchor
    → Markdown section wrapper gets highlighted class

User clicks an overlay on the PDF (left panel):
    → Selects chunk in right panel list (scroll + highlight)
    → Markdown scrolls to section

User clicks a table cell in Markdown tab:
    → table_cell overlay (invisible at rest) becomes visible with blue fill
    → Scrolls PDF to that cell's location

User switches to JSON tab:
    → Sees full formatted chunk JSON with copy button

User filters by type (e.g. "Table"):
    → Chunk list shows only table chunks
    → PDF overlays: non-table overlays dim (opacity 0.3)
    → Table overlays remain at full intensity
```

---

## 10. Styling Constants (for implementation)

```typescript
// Overlay / badge colors — exact V1 values
export const TYPE_COLORS = {
  // Text family → Emerald Green
  text:        "#32D583",
  title:       "#32D583",
  key_value:   "#32D583",
  page_header: "#32D583",
  page_footer: "#32D583",
  page_number: "#32D583",
  attestation: "#32D583",
  form:        "#32D583",

  // Table family → Blue
  table:       "#2193FD",
  table_cell:  "#2193FD",

  // Figure family → Pink/Magenta
  figure:      "#FF5CFF",
  card:        "#FF5CFF",
  scan_code:   "#FF5CFF",
  logo:        "#FF5CFF",

  // Fallback
  error:       "#64748b",
};

// Overlay CSS class by type
export const TYPE_CLASS = {
  text: "overlay-box--text", title: "overlay-box--text",
  key_value: "overlay-box--text", attestation: "overlay-box--text",
  form: "overlay-box--text", page_header: "overlay-box--text",
  page_footer: "overlay-box--text", page_number: "overlay-box--text",
  table: "overlay-box--table",
  table_cell: "overlay-box--table",    // invisible at rest
  figure: "overlay-box--figure", card: "overlay-box--figure",
  scan_code: "overlay-box--figure", logo: "overlay-box--figure",
};
```

---

*Awaiting approval before implementation begins.*
