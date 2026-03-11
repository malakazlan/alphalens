# FRONTEND_SPEC.md — Alpha Lens v2 Frontend Specification

## 1. Tech Stack
- **Next.js 14** with App Router (React Server Components + Client Components)
- **Tailwind CSS** with custom CSS variables matching v1 color theme
- **shadcn/ui** for base components
- **TypeScript** throughout
- **PDF.js 3.11.174** for PDF rendering and bbox overlay
- **Deployed on Vercel**

---

## 2. Color Theme (Preserved Exactly from v1)

```css
/* styles/globals.css */
:root {
  /* Backgrounds */
  --bg: #ffffff;
  --bg-soft: #fafbfc;
  --bg-secondary: #f5f7fa;

  /* Accent — Emerald green */
  --accent: #059669;
  --accent-hover: #047857;
  --accent-light: #d1fae5;
  --accent-2: #10b981;
  --accent-3: #34d399;
  --accent-soft: rgba(5, 150, 105, 0.08);
  --accent-glow: rgba(5, 150, 105, 0.35);

  /* Text */
  --text: #0f172a;
  --text-secondary: #475569;
  --subtle: #64748b;

  /* Borders */
  --border: #e2e8f0;
  --border-light: #f1f5f9;

  /* Cards */
  --card: #ffffff;

  /* Status */
  --success: #059669;
  --warning: #f59e0b;
  --error: #dc2626;

  /* Shadows */
  --shadow: 0 1px 3px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04);
  --shadow-lg: 0 10px 25px rgba(0, 0, 0, 0.08), 0 4px 10px rgba(0, 0, 0, 0.04);
  --shadow-xl: 0 25px 50px -12px rgba(0, 0, 0, 0.12);
}
```

**Tailwind config extensions:**
```js
// tailwind.config.ts
module.exports = {
  theme: {
    extend: {
      colors: {
        accent: '#059669',
        'accent-hover': '#047857',
        'accent-2': '#10b981',
        'accent-3': '#34d399',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
    },
  },
}
```

**Typography:** Inter font (Google Fonts), weights 400/500/600/700/800.

**Glass card effect** (preserved from v1):
```css
.glass-card {
  background: rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(24px) saturate(180%);
  border-radius: 20px;
  border: 1px solid rgba(226, 232, 240, 0.7);
  box-shadow: var(--shadow-xl);
}
```

---

## 3. App Router Structure

```
app/
├── layout.tsx              # Root layout
│   - Inter font via next/font/google
│   - globals.css import
│   - AuthProvider (context for JWT + user)
│   - metadata: title "Alpha Lens — Financial Intelligence Platform"
│
├── page.tsx                # Public landing page (unauthenticated)
│   - Redirects to /dashboard if authenticated
│   - Same hero content as v1 landing.html
│   - "Get Started" → /login
│
├── login/
│   └── page.tsx            # Auth page (unauthenticated only)
│   - Renders LoginForm + SignupForm with tab switching
│   - Redirects to /dashboard on success
│   - Animated background gradient (radial emerald glows)
│   - Animated dot grid background
│
└── dashboard/
    ├── layout.tsx          # Dashboard shell (auth guard + nav)
    │   - Server component: check session cookie → redirect to /login if absent
    │   - Renders Header component
    │   - Renders {children} (the active section)
    │   - Global page wrapper with emerald animated background
    │
    ├── page.tsx            # Home section (/dashboard)
    ├── analyzer/
    │   └── page.tsx        # Analyzer section (/dashboard/analyzer)
    ├── report/
    │   └── page.tsx        # Report section (/dashboard/report)
    └── finbot/
        └── page.tsx        # FinBot section (/dashboard/finbot)
```

---

## 4. Component Specifications

### 4.1 Header (`components/layout/Header.tsx`)
**Preserved from v1 exactly:**
- Left: Alpha Lens logo (32×32 PNG) + "Alpha Lens" text
- Center nav: Home | Analyzer | Reports | Chatbot links (active state underline)
- Right: Logout button
- Mobile: hamburger menu with slide-down nav
- Position: sticky top-0, z-50
- Background: white with subtle border-bottom

```tsx
// Props: none — reads auth context for logout
// Active link detection via usePathname()
```

---

### 4.2 Footer (`components/layout/Footer.tsx`)
**Preserved from v1:**
- 3-column grid: Brand | Quick Links | Contact
- Brand: logo + tagline "Empowering smarter financial decisions through AI."
- Quick Links: Analyzer, Reports, Optimizer (placeholder), FinBot AI
- Contact: support@alphalens.com + Twitter/LinkedIn/GitHub icons
- Bottom bar: © 2025 Alpha Lens...

---

### 4.3 Home Page (`app/dashboard/page.tsx`)
**Server Component**

Sections (all preserved from v1):
1. **Hero** — "Transform Your Financial Analysis" + gradient subtitle + "Analyze a Document" button → `/dashboard/analyzer`
2. **Features grid** — 4 cards: Advanced Analysis, Smart Reports, Portfolio Optimizer (placeholder), AI Assistant
   - Each card is clickable → navigates to corresponding section
3. **Footer** — included

Animated background: radial emerald gradients + subtle dot grid (CSS animation, same as v1).

---

### 4.4 Analyzer Page (`app/dashboard/analyzer/page.tsx`)
**Client Component** (needs interactivity, file upload, PDF.js)

#### States:
1. **Initial state** (no document selected)
2. **Processing state** (file uploaded, ADE running)
3. **Result state** (document loaded)

#### 4.4.1 Initial State

```tsx
// ActionCards.tsx
// 3 cards: Parse | Extract | Chat
// Each card has:
//   - Icon (SVG)
//   - "Docs" link (decorative, no URL)
//   - Title + description
//   - "Upload File" button → triggers file picker

// Hidden file input — accepts: .pdf,.docx,.doc,.html,.htm,.png,.jpg,.jpeg,.tiff,.tif,.webp
// On file select:
//   1. Compute SHA256 hash (SubtleCrypto API)
//   2. POST /api/documents/check-hash
//   3. If duplicate → show existing document in result state
//   4. If new → POST /api/documents/upload → show processing state
```

**Pre-saved Documents section:**
- Fetches `GET /api/documents` on mount
- Renders list of user's documents with filename, status badge, upload date
- Click any document → switch to result state with that document loaded

#### 4.4.2 Processing State

```tsx
// ProcessingStatus.tsx
// Spinner + progress bar
// Status message text (from SSE document status stream)
// Stages displayed:
//   Uploading → Queued → Parsing → Extracting → Indexing → Complete
// Connects to GET /api/documents/{id}/status SSE
// On complete → switches to result state
```

#### 4.4.3 Result State — Workspace Layout

```tsx
// Layout: flex row, full viewport height minus header
// [WorkspaceRail 48px] [DocumentViewer 40%] [ResizeDivider 4px] [RightPanel 60%]

// WorkspaceRail (DocumentRail.tsx)
// - Position: fixed left, full height
// - Width: 48px (icon-only)
// - Items (top to bottom):
//     Logo (32px PNG)
//     Home button (house icon) → goes back to initial state
//     Documents flyout button (pages icon) with badge showing doc count
//     Upload button (cloud-upload icon) → triggers file picker
//     Spacer (flex-grow)
//     User avatar circle with initials
// - Documents flyout panel (DocumentFlyout.tsx):
//     Appears on hover/click of documents button
//     Lists all user documents
//     Active doc highlighted
//     Each item: filename (truncated), status dot, clickable to switch document
```

#### 4.4.4 PDF Viewer (`components/analyzer/PDFViewer.tsx`)

```tsx
// Client Component
// Uses PDF.js via window.pdfjsLib (loaded from CDN script tag)
// Props:
//   signedUrl: string          — Supabase signed URL for the PDF
//   bboxHighlights: BboxItem[] — from chat grounding response
//   onPageRender?: (page) => void

interface BboxItem {
  element_id: string;
  page: number; // 0-indexed
  box: { left: number; top: number; right: number; bottom: number }; // normalized 0-1
  type: 'chunkText' | 'chunkTable' | 'chunkFigure' | 'tableCell';
}

// Renders ALL pages vertically (same as v1 renderAllPdfPages)
// Each page: <canvas> element inside a <div class="pdf-page-wrapper">
// Page wrapper stores: data-page-num={i}

// BBox overlay:
// After each page renders, if bboxHighlights includes a match for that page:
//   const canvas = canvasRef.current;
//   const ctx = canvas.getContext('2d');
//   const { width, height } = canvas;  // actual canvas pixel dimensions
//   ctx.save();
//   ctx.strokeStyle = '#10b981';       // --accent-2 emerald
//   ctx.fillStyle = 'rgba(16,185,129,0.15)';
//   ctx.lineWidth = 2;
//   for (const bbox of highlightsForPage) {
//     const x = bbox.box.left * width;
//     const y = bbox.box.top * height;
//     const w = (bbox.box.right - bbox.box.left) * width;
//     const h = (bbox.box.bottom - bbox.box.top) * height;
//     ctx.fillRect(x, y, w, h);
//     ctx.strokeRect(x, y, w, h);
//   }
//   ctx.restore();

// Scroll to citation page:
// When new highlights arrive: document.querySelector(`[data-page-num="${page}"]`).scrollIntoView()

// Non-PDF files: show "Preview not available for this file type" placeholder
```

#### 4.4.5 Right Panel Tabs

```tsx
// Tabs: Parse | Extract | Chat
// Uses shadcn/ui <Tabs> component

// PARSE TAB (ParsePanel.tsx)
// Sub-tabs: Markdown | JSON
// Markdown view:
//   - Renders ADE markdown with react-markdown or syntax highlighter
//   - Preserves HTML table markup
//   - Style: monospace-ish, dark text on white
// JSON view:
//   - <pre> with JSON.stringify(chunks, null, 2)
//   - Chunk items are clickable → highlights their bbox in PDF viewer

// EXTRACT TAB (ExtractPanel.tsx)
// Fetches GET /api/documents/{id}/extract on load
// Renders sections: Document Info | Income Statement | Balance Sheet | Cash Flow | Key Metrics | Red Flags & Audit
// Each field row: Label | Value | (optional) click-to-highlight bbox
// formatCurrency() and formatPercentage() helpers applied
// Red flags: amber badge per item
// Auditor opinion: colored badge (green/amber/red)

// CHAT TAB (ChatPanel.tsx)
// Description header (preserved from v1: test tube + flask SVG icon)
// Example prompts chips (fetched from GET /api/chat/suggestions/{doc_id})
// Messages area (scrollable)
//   User messages: right-aligned, emerald background
//   Assistant messages: left-aligned, card background
//   Streaming: tokens append in real-time via SSE
//   After done: show "View sources" link → opens CitationSidebar
// Input: text input + send button (arrow icon)
// On send:
//   POST /api/chat/stream (SSE)
//   Parse SSE events: token → append, done → store best_chunks, grounding → highlight PDF
// Clear chat button
```

#### 4.4.6 Citation Sidebar (`components/analyzer/CitationSidebar.tsx`)

```tsx
// Slide-in panel (right side or overlay) triggered by "View sources" after chat response
// Shows list of cited chunks:
//   - Chunk type badge (Table, Text, Figure)
//   - Section header
//   - Page number
//   - Markdown preview (first 100 chars)
//   - "Jump to page" button → scrolls PDF viewer to bbox
// Clicking a citation item calls highlightBbox(bbox) on PDFViewer
```

---

### 4.5 Report Page (`app/dashboard/report/page.tsx`)
**Client Component**

```tsx
// Layout: centered, max-width 900px

// 1. Document selector dropdown
//    - Fetches GET /api/documents → filters status="complete"
//    - Select component (shadcn/ui)

// 2. "Generate Report" button
//    - POST /api/reports/generate → SSE stream
//    - Disabled while generating

// 3. Report viewer (ReportViewer.tsx)
//    - Renders sections as they stream in
//    - Sections: Executive Summary | Revenue & Profitability | Balance Sheet Health
//              | Cash Flow Analysis | Key Metrics | Red Flags | Auditor Opinion | Outlook
//    - Each section: h2 header + prose content
//    - Typography: clean, readable, professional

// 4. Export PDF button (ExportButton.tsx)
//    - GET /api/reports/{doc_id}/pdf → downloads PDF
//    - Or triggers window.print() with report-specific print styles
```

---

### 4.6 FinBot Page (`app/dashboard/finbot/page.tsx`)
**Client Component**

**Two-panel layout (preserved exactly from v1):**

```tsx
// FinBotSidebar.tsx — LEFT PANEL (dark themed)
// Width: 320px on desktop, hidden on mobile
// Background: dark (--text: #0f172a or darker)
// Sections:
//   Header: FinBot branding + logo + status dot
//   Featured Insights carousel (NewsCard.tsx)
//     - Fetches GET /api/finbot/news
//     - 3-5 news cards with image/title/source/date
//     - Dot indicators for carousel position
//     - Auto-advance every 5 seconds
//   Breaking News list
//     - Remaining news items as text list
//     - Title + source + relative time

// FinBotChat.tsx — RIGHT PANEL
// Topbar: FinBot logo + title "Financial Assistant" + subtitle + Clear chat button
// Messages area (scrollable):
//   Welcome state (no messages): logo + "Ask FinBot" + description + chips
//   Chips: AAPL Price | Compare Stocks | Invest $500 | Gold Price | Market News
//   User messages: right-aligned
//   Assistant messages: left-aligned, markdown-rendered
//     Tool call indicator: "🔧 Fetching market data..." while tool executing
//     Streaming tokens render in real-time
// Input area (sticky bottom):
//   <textarea> auto-resize (rows=1, grows to 4 rows)
//   Send button with arrow icon
//   Disclaimer: "Not financial advice · For educational use only"

// Chip click → populates input and sends immediately
// Clear chat → DELETE /api/finbot/chat/{session_id}
```

---

## 5. Auth Context

```tsx
// lib/auth.ts
interface AuthContext {
  user: { id: string; email: string } | null;
  token: string | null;
  login: (token: string, user: User) => void;
  logout: () => void;
  isLoading: boolean;
}

// Token storage:
// Primary: HTTP-only cookie (set by backend, browser sends automatically)
// Backup: localStorage.getItem('access_token') (for Authorization header in fetch calls)

// Auth guard in dashboard/layout.tsx:
// Server component checks cookie — redirect to /login if absent
// Client-side: useAuth() hook, redirect if token expires
```

---

## 6. API Client

```typescript
// lib/api.ts
const API_BASE = process.env.NEXT_PUBLIC_API_URL; // Render.com FastAPI URL

async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = localStorage.getItem('access_token');
  return fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',  // Send cookies
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });
}

// SSE client
function streamSSE(path: string, body: object, onEvent: (event: object) => void): () => void {
  // Uses fetch with ReadableStream — not EventSource (allows POST with body)
  const controller = new AbortController();

  fetch(`${API_BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: controller.signal,
  }).then(async (res) => {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const event = JSON.parse(line.slice(6));
            onEvent(event);
          } catch {}
        }
      }
    }
  });

  return () => controller.abort(); // Return cleanup function
}
```

---

## 7. PDF.js Integration Details

```typescript
// lib/pdf-highlight.ts

// Load PDF.js (CDN script in layout.tsx <Script> tag)
// pdfjsLib.GlobalWorkerOptions.workerSrc = 'cdnjs.cloudflare.com/.../pdf.worker.min.js';

// Render all pages:
async function renderAllPages(
  pdfUrl: string,
  container: HTMLElement,
  scale: number = 1.5
): Promise<Map<number, HTMLCanvasElement>> {
  const pdf = await pdfjsLib.getDocument(pdfUrl).promise;
  const canvases = new Map<number, HTMLCanvasElement>();

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.dataset.pageNum = String(pageNum - 1); // 0-indexed to match ADE

    const wrapper = document.createElement('div');
    wrapper.className = 'pdf-page-wrapper';
    wrapper.dataset.pageNum = String(pageNum - 1);
    wrapper.appendChild(canvas);
    container.appendChild(wrapper);

    await page.render({
      canvasContext: canvas.getContext('2d')!,
      viewport,
    }).promise;

    canvases.set(pageNum - 1, canvas);
  }

  return canvases;
}

// Highlight bbox on page:
function highlightBbox(
  canvases: Map<number, HTMLCanvasElement>,
  bbox: BboxItem
): void {
  const canvas = canvases.get(bbox.page);
  if (!canvas) return;

  const ctx = canvas.getContext('2d')!;
  const { width, height } = canvas;

  ctx.save();
  ctx.strokeStyle = '#10b981';
  ctx.fillStyle = 'rgba(16, 185, 129, 0.15)';
  ctx.lineWidth = 2;
  ctx.setLineDash([]);

  const x = bbox.box.left * width;
  const y = bbox.box.top * height;
  const w = (bbox.box.right - bbox.box.left) * width;
  const h = (bbox.box.bottom - bbox.box.top) * height;

  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

// Clear all highlights on a page (before redrawing):
function clearPageHighlights(canvas: HTMLCanvasElement, page: pdfjsLib.PDFPageProxy, scale: number): void {
  const viewport = page.getViewport({ scale });
  page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
}

// Scroll to page:
function scrollToPage(pageNum: number): void {
  const wrapper = document.querySelector(`[data-page-num="${pageNum}"]`);
  wrapper?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
```

---

## 8. Responsive Design

### Breakpoints (Tailwind defaults):
- `sm`: 640px
- `md`: 768px
- `lg`: 1024px
- `xl`: 1280px

### Desktop-First Layout:
- Header: always visible, nav full
- Analyzer: 3-column (rail + viewer + panel) on lg+, collapses on mobile
- FinBot: 2-column on lg+, sidebar hidden on mobile (accessible via menu)
- Report: centered single column always

### Mobile Adaptations:
- Nav: hamburger menu (same as v1)
- Analyzer: tabs only on mobile (no side-by-side viewer + panel)
- FinBot sidebar: hidden, news accessible via top button
- PDF viewer: full-width on mobile
- Resizer handle: hidden on mobile

---

## 9. Loading States

All data-fetching components use React Suspense boundaries where possible.

Pattern for interactive components:
- Initial load: skeleton placeholders (shadcn/ui Skeleton component, emerald shimmer)
- Upload: progress bar (shadcn/ui Progress component)
- Streaming: tokens appear incrementally (no full-page loading)
- Error states: red-bordered card with error message + retry button

---

## 10. Environment Variables (Frontend)

```
NEXT_PUBLIC_API_URL=https://{app}.onrender.com
```

All other secrets (API keys) live in the backend only. The frontend never holds any API keys.

---

## 11. Scripts in next.js layout.tsx

PDF.js loaded via `next/script` with `strategy="beforeInteractive"`:
```tsx
<Script
  src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"
  strategy="beforeInteractive"
/>
```

Worker option set on client side in PDFViewer component `useEffect`:
```typescript
if (typeof window !== 'undefined' && window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}
```
