# Tournament Dashboard Style Guide

Comprehensive unified design specifications for all tournament dashboard components: admin dashboard, MagicMirror displays, and PDF reports.

---

## 1. Brand Identity & Design Philosophy

- **Theme support** - Dark/light mode toggle with system preference detection
- **High contrast for accessibility** - WCAG 2.1 AA minimum compliance
- **Minimalist, professional aesthetic** - Clean layouts, clear hierarchy
- **No emojis in UI** - Professional appearance required
- **Platform-optimized** - Desktop admin, TV displays, printed reports

---

## 2. Master Color Palette

### Primary Colors

| Token | Hex | RGB | Usage |
|-------|-----|-----|-------|
| `--color-black` | #1A1A1A | 26, 26, 26 | Headers, primary dark backgrounds |
| `--color-black-deep` | #111827 | 17, 24, 39 | Deepest backgrounds |
| `--color-black-pure` | #000000 | 0, 0, 0 | TV displays (OLED optimization) |
| `--color-white` | #FFFFFF | 255, 255, 255 | Primary text on dark, display text |
| `--color-white-soft` | #f3f4f6 | 243, 244, 246 | Dashboard body text |

### Accent Colors

| Token | Hex | RGB | Usage |
|-------|-----|-----|-------|
| `--color-accent` | #E63946 | 230, 57, 70 | Brand accent, highlights, active states |
| `--color-action` | #3b82f6 | 59, 130, 246 | Primary actions, links, selections |
| `--color-success` | #10b981 | 16, 185, 129 | Online, success, completion, checked-in |
| `--color-warning` | #f59e0b | 245, 158, 11 | Warnings, pending states |
| `--color-error` | #ef4444 | 239, 68, 68 | Errors, offline, danger, DQ |

### Neutral Grays

| Token | Hex | RGB | Usage |
|-------|-----|-----|-------|
| `--gray-50` | #F5F5F5 | 245, 245, 245 | Alternating rows (light), PDF backgrounds |
| `--gray-100` | #f3f4f6 | 243, 244, 246 | Light text |
| `--gray-400` | #9ca3af | 156, 163, 175 | Muted text, labels |
| `--gray-500` | #6b7280 | 107, 114, 128 | Secondary text, loading states |
| `--gray-600` | #4b5563 | 75, 85, 99 | Borders hover, secondary borders |
| `--gray-700` | #374151 | 55, 65, 81 | Primary borders |
| `--gray-800` | #1f2937 | 31, 41, 55 | Card backgrounds, containers |
| `--gray-900` | #111827 | 17, 24, 39 | Deep backgrounds |

### Special Purpose Colors

| Token | Hex | RGB | Usage |
|-------|-----|-----|-------|
| `--color-gold` | #FFD700 | 255, 215, 0 | 1st place medal |
| `--color-silver` | #C0C0C0 | 192, 192, 192 | 2nd place medal |
| `--color-bronze` | #CD7F32 | 205, 127, 50 | 3rd place medal |
| `--color-elo-gain` | #27AE60 | 39, 174, 96 | Positive Elo changes |
| `--color-elo-loss` | #E63946 | 230, 57, 70 | Negative Elo changes |
| `--color-next` | #ffa500 | 255, 165, 0 | Up-next states (TV displays) |
| `--color-timer` | #eab308 | 234, 179, 8 | Tournament timer |

### CSS Variable Definitions

```css
:root {
  /* Primary */
  --color-black: #1A1A1A;
  --color-black-deep: #111827;
  --color-black-pure: #000000;
  --color-white: #FFFFFF;
  --color-white-soft: #f3f4f6;

  /* Accent */
  --color-accent: #E63946;
  --color-action: #3b82f6;
  --color-success: #10b981;
  --color-warning: #f59e0b;
  --color-error: #ef4444;

  /* Grays */
  --gray-50: #F5F5F5;
  --gray-100: #f3f4f6;
  --gray-400: #9ca3af;
  --gray-500: #6b7280;
  --gray-600: #4b5563;
  --gray-700: #374151;
  --gray-800: #1f2937;
  --gray-900: #111827;

  /* Special */
  --color-gold: #FFD700;
  --color-silver: #C0C0C0;
  --color-bronze: #CD7F32;
  --color-elo-gain: #27AE60;
  --color-elo-loss: #E63946;
  --color-next: #ffa500;
  --color-timer: #eab308;
}
```

---

## 3. Typography

### Font Stack

```css
--font-primary: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
--font-mono: 'Courier New', Courier, monospace;
--font-pdf: 'Helvetica', 'Helvetica Neue', Arial, sans-serif;
```

### Dashboard Typography Scale

| Token | Size | Weight | Line Height | Usage |
|-------|------|--------|-------------|-------|
| `--text-display` | 2rem (32px) | 700 | 1.2 | Large stat values |
| `--text-h1` | 1.5rem (24px) | 700 | 1.3 | Page titles |
| `--text-h2` | 1.25rem (20px) | 600 | 1.4 | Section headers |
| `--text-h3` | 1.125rem (18px) | 600 | 1.4 | Subsection headers |
| `--text-body` | 1rem (16px) | 400 | 1.5 | Normal content |
| `--text-small` | 0.875rem (14px) | 400 | 1.5 | Secondary text |
| `--text-tiny` | 0.75rem (12px) | 400 | 1.4 | Labels, metadata |

### TV Display Typography Scale (Viewport Units)

| Token | Size | Weight | Usage |
|-------|------|--------|-------|
| `--tv-title` | 5vw | 900 | Main headings |
| `--tv-subtitle` | 4.5vw | 900 | Match names |
| `--tv-body` | 3.5vw | 800 | List items |
| `--tv-small` | 2.8vw | 700 | Subtitles |
| `--tv-ticker` | 6vw | 700 | Announcements |

### PDF Typography Scale (Points)

| Token | Size | Weight | Usage |
|-------|------|--------|-------|
| Title | 22pt | Bold | Tournament name |
| Section | 14pt | Bold | Section headers |
| Subtitle | 11pt | Regular | Game/format |
| Body | 10pt | Regular | Table content |
| Small | 9pt | Regular | Match details |
| Tiny | 8pt | Regular | Labels, footer |

### CSS Variable Definitions

```css
:root {
  /* Font Families */
  --font-primary: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  --font-mono: 'Courier New', Courier, monospace;

  /* Dashboard Scale */
  --text-display: 2rem;
  --text-h1: 1.5rem;
  --text-h2: 1.25rem;
  --text-h3: 1.125rem;
  --text-body: 1rem;
  --text-small: 0.875rem;
  --text-tiny: 0.75rem;

  /* TV Display Scale */
  --tv-title: 5vw;
  --tv-subtitle: 4.5vw;
  --tv-body: 3.5vw;
  --tv-small: 2.8vw;
  --tv-ticker: 6vw;
}
```

---

## 4. Spacing System

**Base Unit:** 4px

| Token | Value | Tailwind | Usage |
|-------|-------|----------|-------|
| `--space-xs` | 4px | `p-1` | Tight spacing, icon gaps |
| `--space-sm` | 8px | `p-2` | Small gaps, inline spacing |
| `--space-md` | 16px | `p-4` | Component padding, standard gaps |
| `--space-lg` | 24px | `p-6` | Section gaps |
| `--space-xl` | 32px | `p-8` | Major section spacing |
| `--space-2xl` | 48px | `p-12` | Page section spacing |

### CSS Variable Definitions

```css
:root {
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 32px;
  --space-2xl: 48px;
}
```

---

## 5. Border & Radius

| Token | Value | Tailwind | Usage |
|-------|-------|----------|-------|
| `--radius-sm` | 4px | `rounded` | Small elements, badges |
| `--radius-md` | 8px | `rounded-lg` | Cards, buttons, inputs |
| `--radius-lg` | 12px | `rounded-xl` | Modals, large cards |
| `--radius-full` | 50% | `rounded-full` | Status indicators, avatars |
| `--border-width` | 1px | `border` | Standard borders |
| `--border-width-thick` | 2px | `border-2` | Selected states |
| `--border-width-tv` | 4px | `border-4` | TV display borders |

### CSS Variable Definitions

```css
:root {
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-full: 50%;
  --border-width: 1px;
  --border-width-thick: 2px;
  --border-width-tv: 4px;
}
```

---

## 6. Component Patterns

### Cards

```css
.card {
  background: var(--gray-800);
  border: var(--border-width) solid var(--gray-700);
  border-radius: var(--radius-md);
  padding: var(--space-md);
}

.card:hover {
  border-color: var(--gray-600);
}

.card.selected {
  border-color: var(--color-success);
  border-width: var(--border-width-thick);
}

.card.active {
  border-color: var(--color-accent);
}
```

**Tailwind Implementation:**
```html
<div class="bg-gray-800 border border-gray-700 rounded-lg p-4 hover:border-gray-600">
  <!-- Card content -->
</div>
```

### Buttons

```css
.btn {
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-md);
  font-weight: 500;
  transition: all var(--duration-fast) var(--ease-standard);
}

.btn-primary {
  background: var(--color-action);
  color: var(--color-white);
}

.btn-primary:hover {
  background: #2563eb; /* darker blue */
}

.btn-secondary {
  background: var(--gray-700);
  color: var(--color-white);
}

.btn-destructive {
  background: var(--color-error);
  color: var(--color-white);
}

.btn-success {
  background: var(--color-success);
  color: var(--color-white);
}

.btn-warning {
  background: var(--color-warning);
  color: var(--color-black);
}
```

**Tailwind Implementation:**
```html
<button class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg font-medium">
  Primary Action
</button>
```

### Status Indicators

```css
.status-indicator {
  width: 12px;
  height: 12px;
  border-radius: var(--radius-full);
  display: inline-block;
}

.status-indicator.online {
  background: var(--color-success);
  animation: pulse 2s infinite;
}

.status-indicator.offline {
  background: var(--color-error);
  animation: pulse 2s infinite;
}

.status-indicator.warning {
  background: var(--color-warning);
}

.status-indicator.idle {
  background: var(--gray-500);
}
```

### Form Inputs

```css
.input {
  background: var(--gray-800);
  border: var(--border-width) solid var(--gray-700);
  border-radius: var(--radius-md);
  padding: var(--space-sm) var(--space-md);
  color: var(--color-white);
  min-height: 44px; /* Touch target */
  font-size: 16px; /* Prevents iOS zoom */
}

.input:focus {
  border-color: var(--color-action);
  outline: 2px solid var(--color-action);
  outline-offset: 2px;
}

.input::placeholder {
  color: var(--gray-500);
}

.input:disabled {
  background: var(--gray-900);
  color: var(--gray-500);
  cursor: not-allowed;
}
```

**Tailwind Implementation:**
```html
<input type="text" class="bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white
  focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
  placeholder-gray-500 min-h-[44px]">
```

### Tables

```css
.table-header {
  background: var(--color-black);
  color: var(--color-white);
  font-weight: 600;
}

.table-row:nth-child(odd) {
  background: var(--gray-800);
}

.table-row:nth-child(even) {
  background: var(--gray-900);
}

.table-row:hover {
  background: var(--gray-700);
}

.table-cell {
  padding: var(--space-sm) var(--space-md);
  border-bottom: var(--border-width) solid var(--gray-700);
}
```

### Alerts & Toasts

```css
.alert {
  padding: var(--space-md);
  border-radius: var(--radius-md);
  border-width: var(--border-width);
  border-style: solid;
}

.alert-success {
  background: rgba(16, 185, 129, 0.2);
  border-color: var(--color-success);
  color: var(--color-success);
}

.alert-error {
  background: rgba(239, 68, 68, 0.2);
  border-color: var(--color-error);
  color: var(--color-error);
}

.alert-warning {
  background: rgba(245, 158, 11, 0.2);
  border-color: var(--color-warning);
  color: var(--color-warning);
}

.alert-info {
  background: rgba(59, 130, 246, 0.2);
  border-color: var(--color-action);
  color: var(--color-action);
}
```

### Badges

```css
.badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  font-size: var(--text-tiny);
  font-weight: 500;
  border-radius: var(--radius-sm);
}

.badge-success {
  background: rgba(16, 185, 129, 0.2);
  color: var(--color-success);
}

.badge-error {
  background: rgba(239, 68, 68, 0.2);
  color: var(--color-error);
}

.badge-warning {
  background: rgba(245, 158, 11, 0.2);
  color: var(--color-warning);
}

.badge-info {
  background: rgba(59, 130, 246, 0.2);
  color: var(--color-action);
}
```

### Modals

```css
.modal-overlay {
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(4px);
}

.modal-content {
  background: var(--gray-800);
  border: var(--border-width) solid var(--gray-700);
  border-radius: var(--radius-lg);
  max-width: 90vw;
  max-height: 90vh;
  overflow: auto;
}

.modal-header {
  padding: var(--space-md);
  border-bottom: var(--border-width) solid var(--gray-700);
}

.modal-body {
  padding: var(--space-md);
}

.modal-footer {
  padding: var(--space-md);
  border-top: var(--border-width) solid var(--gray-700);
  display: flex;
  justify-content: flex-end;
  gap: var(--space-sm);
}
```

---

## 7. Animation & Motion

### Durations

| Token | Value | Usage |
|-------|-------|-------|
| `--duration-fast` | 150ms | Hover states, micro-interactions |
| `--duration-normal` | 300ms | Standard transitions |
| `--duration-slow` | 500ms | Overlays, modals, complex animations |

### Easing Functions

```css
:root {
  --ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-enter: cubic-bezier(0, 0, 0.2, 1);
  --ease-exit: cubic-bezier(0.4, 0, 1, 1);
}
```

### Standard Keyframes

```css
/* Status indicator pulse */
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

/* Loading spinner */
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* Alert slide down */
@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Fade in */
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* Timer warning pulse (TV displays) */
@keyframes timerWarning {
  0%, 100% { color: var(--color-timer); }
  50% { color: var(--color-warning); }
}

/* Timer critical pulse (TV displays) */
@keyframes timerCritical {
  0%, 100% { color: var(--color-error); }
  50% { color: var(--color-white); }
}
```

### CSS Variable Definitions

```css
:root {
  --duration-fast: 150ms;
  --duration-normal: 300ms;
  --duration-slow: 500ms;
  --ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-enter: cubic-bezier(0, 0, 0.2, 1);
  --ease-exit: cubic-bezier(0.4, 0, 1, 1);
}
```

---

## 8. Responsive Breakpoints

| Token | Value | Tailwind | Usage |
|-------|-------|----------|-------|
| `--bp-mobile` | 640px | `sm:` | Mobile phones |
| `--bp-tablet` | 768px | `md:` | Tablet portrait |
| `--bp-desktop` | 1024px | `lg:` | Desktop screens |
| `--bp-wide` | 1280px | `xl:` | Wide screens |

### Mobile Requirements

- **Touch targets:** Minimum 44px x 44px
- **Input font size:** 16px minimum (prevents iOS zoom)
- **Full-screen modals** on mobile devices
- **Sticky headers/footers** in modals
- **Horizontal scrolling** for filter buttons with scroll hints

### CSS Media Query Examples

```css
/* Mobile-first approach */
.component {
  padding: var(--space-sm);
}

@media (min-width: 640px) {
  .component {
    padding: var(--space-md);
  }
}

@media (min-width: 768px) {
  .component {
    padding: var(--space-lg);
  }
}

@media (min-width: 1024px) {
  .component {
    padding: var(--space-xl);
  }
}

/* Touch device detection */
@media (pointer: coarse) {
  .touch-target {
    min-height: 44px;
    min-width: 44px;
  }
}
```

---

## 9. Platform-Specific Adaptations

### TV Displays (MagicMirror)

**Optimizations:**
- Background: Pure black (#000000) for OLED power savings
- Text: Pure white (#FFFFFF) for maximum contrast
- Borders: 4px width for visibility at distance
- Font weights: 800-900 for legibility from 10+ feet
- Viewport units (vw) for responsive scaling
- High contrast animations for active states

**Color Adaptations:**
| Standard Token | TV Display Adaptation |
|----------------|----------------------|
| `--color-black-deep` | `--color-black-pure` (#000000) |
| `--color-white-soft` | `--color-white` (#FFFFFF) |
| `--border-width` | `--border-width-tv` (4px) |

**Example TV Component:**
```css
.tv-match-card {
  background: var(--color-black-pure);
  border: var(--border-width-tv) solid var(--gray-700);
  color: var(--color-white);
  font-size: var(--tv-body);
  font-weight: 800;
}

.tv-match-card.active {
  border-color: var(--color-accent);
  animation: pulse 2s infinite;
}

.tv-match-card.up-next {
  border-color: var(--color-next);
}
```

### PDF Reports

**Optimizations:**
- Light alternating rows (#F5F5F5) for print readability
- Header bar: #1A1A1A with white text
- Accent line: 3px #E63946
- Helvetica font family (PDF-compatible, no embedding needed)
- 50px page margins
- Points (pt) for font sizes

**PDF Color Constants (JavaScript):**
```javascript
const PDF_COLORS = {
  black: '#1A1A1A',
  white: '#FFFFFF',
  accent: '#E63946',
  success: '#27AE60',
  muted: '#6b7280',
  lightGray: '#F5F5F5',
  gold: '#FFD700',
  silver: '#C0C0C0',
  bronze: '#CD7F32'
};
```

**PDF Typography (PDFKit):**
```javascript
// Title
doc.font('Helvetica-Bold').fontSize(22).fillColor(PDF_COLORS.white);

// Section header
doc.font('Helvetica-Bold').fontSize(14).fillColor(PDF_COLORS.black);

// Body text
doc.font('Helvetica').fontSize(10).fillColor(PDF_COLORS.black);

// Muted/footer text
doc.font('Helvetica').fontSize(8).fillColor(PDF_COLORS.muted);
```

---

## 10. Accessibility

### Contrast Requirements

- **Normal text (< 18pt):** Minimum 4.5:1 contrast ratio
- **Large text (18pt+ or 14pt+ bold):** Minimum 3:1 contrast ratio
- **Interactive elements:** Visible focus ring required

### Focus States

```css
/* Modern focus-visible for keyboard navigation only */
:focus-visible {
  outline: 2px solid var(--color-action);
  outline-offset: 2px;
}

/* Remove outline for mouse users */
:focus:not(:focus-visible) {
  outline: none;
}
```

### Color Contrast Reference

| Background | Text Color | Ratio | Status |
|------------|------------|-------|--------|
| #111827 (gray-900) | #FFFFFF | 16.1:1 | Pass AAA |
| #1f2937 (gray-800) | #FFFFFF | 12.6:1 | Pass AAA |
| #374151 (gray-700) | #FFFFFF | 8.6:1 | Pass AAA |
| #1A1A1A (black) | #FFFFFF | 16.0:1 | Pass AAA |
| #1A1A1A (black) | #E63946 | 4.8:1 | Pass AA |
| #1f2937 (gray-800) | #10b981 | 5.1:1 | Pass AA |
| #1f2937 (gray-800) | #3b82f6 | 4.6:1 | Pass AA |

### Screen Reader Considerations

- Use semantic HTML elements (`<button>`, `<nav>`, `<main>`, etc.)
- Include `aria-label` for icon-only buttons
- Use `aria-live` regions for dynamic content updates
- Ensure logical tab order

---

## 11. Icon Guidelines

### Icon Sizes

| Context | Size | Usage |
|---------|------|-------|
| Inline | 16px | Within text, badges |
| Button | 20px | Button icons |
| Navigation | 24px | Sidebar icons |
| Status | 12px | Status indicators |
| Large | 32px+ | Empty states, features |

### Icon Colors

- **Default:** `--gray-400` (#9ca3af)
- **Hover:** `--color-white` (#FFFFFF)
- **Active:** `--color-action` (#3b82f6)
- **Success:** `--color-success` (#10b981)
- **Error:** `--color-error` (#ef4444)
- **Warning:** `--color-warning` (#f59e0b)

---

## 12. Z-Index Scale

| Layer | Z-Index | Usage |
|-------|---------|-------|
| Base | 0 | Normal document flow |
| Dropdown | 10 | Dropdown menus |
| Sticky | 20 | Sticky headers |
| Fixed | 30 | Fixed elements |
| Sidebar | 40 | Navigation sidebar |
| Modal Backdrop | 50 | Modal overlay |
| Modal | 60 | Modal content |
| Toast | 70 | Toast notifications |
| Tooltip | 80 | Tooltips |

---

## 13. Implementation Checklist

When implementing new UI components, ensure:

- [ ] Uses only colors from the master palette
- [ ] Follows typography scale for the platform
- [ ] Uses spacing tokens (multiples of 4px)
- [ ] Includes hover/focus states
- [ ] Meets minimum touch target size (44px) on mobile
- [ ] Has sufficient color contrast (4.5:1 minimum)
- [ ] Uses standard animation durations and easing
- [ ] Responsive at all breakpoints
- [ ] No emojis in UI elements
- [ ] Uses CSS variables for theme-aware colors
- [ ] Works correctly in both light and dark modes

---

## Quick Reference

### Most Used Colors (CSS Variables)
```
/* Use CSS variables for theme support */
Background:  var(--bg-primary)    /* Light: #ffffff, Dark: #111827 */
Card:        var(--bg-secondary)  /* Light: #f3f4f6, Dark: #1f2937 */
Border:      var(--border-color)  /* Light: #d1d5db, Dark: #374151 */
Text:        var(--text-primary)  /* Light: #111827, Dark: #f3f4f6 */
Muted:       var(--text-muted)    /* Light: #6b7280, Dark: #9ca3af */
Accent:      #E63946 (red)
Action:      #3b82f6 (blue)
Success:     #10b981 (green)
Warning:     #f59e0b (orange)
Error:       #ef4444 (red)
```

### Most Used Spacing
```
xs: 4px   (tight)
sm: 8px   (inline)
md: 16px  (standard)
lg: 24px  (sections)
xl: 32px  (major)
```

### Most Used Radii
```
sm: 4px   (badges)
md: 8px   (cards, buttons)
lg: 12px  (modals)
```
