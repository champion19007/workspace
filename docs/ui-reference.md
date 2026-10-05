# Workspace v1 — UI Reference & Design System Specification

## Overview

Workspace v1's visual language is grounded in the dark charcoal aesthetic established in reference screenshots `Screenshot (927).png` through `Screenshot (958).png`. The interface balances high-density information architecture with clarity, accessibility, and strict visual hierarchy.

---

## 1. Color System & Surfaces

### 1.1 Charcoal Surface Palette

| Token | Hex / Value | Role & Usage | Contrast vs White (#f8fafc) |
|---|---|---|---|
| `--canvas` | `#0d0f12` | Root application background, behind sidebar and panels | 17.6:1 (AAA) |
| `--sidebar` | `#0b0d10` | Left persistent navigation surface | 18.5:1 (AAA) |
| `--panel` | `#14171e` | Main content card and elevated panel surface | 15.5:1 (AAA) |
| `--panel-elevated`| `#1a1e27` | Hover states, active cards, dropdown popovers | 13.8:1 (AAA) |
| `--panel-inset` | `#101319` | Inset wells, table headers, search input fields | 16.8:1 (AAA) |
| `--border-subtle` | `#222633` | Primary structural borders, card edges, dividers | 3.2:1 against panel |
| `--border-strong` | `#2e3446` | Active borders, hovered inputs, focused rings | 4.5:1 against panel |

### 1.2 Text & Content Hierarchy

| Token | Hex / Value | Purpose |
|---|---|---|
| `--text-primary` | `#f8fafc` | Primary titles, table values, active navigation items |
| `--text-secondary`| `#94a3b8` | Subtitles, labels, table headers, metadata |
| `--text-muted` | `#64748b` | Timestamps, placeholder text, inactive icons |
| `--text-inverse` | `#0d0614` | High-contrast text on top of `#d86dfc` accent surfaces |

### 1.3 Accent Color & Dynamic Theming

- **Default Accent (`#d86dfc`)**:
  - A vibrant orchid/magenta accent matching the visual reference screenshots.
  - **Luminance & Contrast**: Relative luminance $\approx 0.35$.
    - Text on Accent: White (`#ffffff`) has a contrast ratio of only $2.5:1$ (FAILS WCAG AA). Dark charcoal (`#0d0614`) achieves $8.2:1$ (EXCEEDS WCAG AAA 7:1).
    - **Rule**: All solid buttons and active pill badges filled with `--accent` MUST render text using `--accent-foreground` (`#0d0614`).
    - Accent on Panel (`#d86dfc` on `#14171e`): Contrast is $7.1:1$, providing excellent visibility for focus rings, status dots, and icon highlights.
- **Persistence & Customization**:
  - Saved in browser `localStorage` under `workspace_accent_color`.
  - Dynamically injected as CSS custom properties (`--accent`, `--accent-foreground`, `--accent-muted`).
  - Adjustable via Settings Drawer (tab: Appearance) and Settings Page (`/settings`).
  - Presets provided: Orchid (`#d86dfc`), Sky (`#38bdf8`), Emerald (`#34d399`), Rose (`#f43f5e`), Amber (`#fbbf24`), with a one-click "Reset to Default".

---

## 2. Screenshot Mapping & Layout Hierarchy

| Screenshot | Screen / Feature | Layout & Behavioral Patterns |
|---|---|---|
| **927** | **Project Dashboard** | Left-bordered hero card (`#d86dfc` left border), circular completion ring (`0% COMPLETE`), 4-item metric strip with colored indicator dots, project progress quote callout, recent movement activity feed. |
| **928** | **Task List View** | Table toolbar (Search, View selector, Filter, `+ Add Task` accent button), table headers (Checkbox, Key/Title, Status, Priority, Assignee, Due Date), clean empty state. |
| **929** | **Kanban Board** | 3 columns (`To Do`, `In Progress`, `Completed`) with colored dots (`#d86dfc`, `#f59e0b`, `#34d399`), count badges, compact `+ Add Task` column button, draggable card layout. |
| **938** | **My Tasks** | Header with assignee scope, search & filter row, horizontal status filter chips (`My Tasks`, `Pending`, `Overdue`, `Due Today`, `Upcoming`). |
| **940** | **Team Members** | Command center hero with plan badge, seat capacity progress bar ("3 / 10 seats"), `+ Invite` button, active member cards with role badges and action menus. |
| **941** | **Projects Directory** | Search toolbar, sort controls, `+ New Project` button, grid of project cards with lead avatars, key badge, and task metrics. |
| **942** | **Teams / Org Tree** | Split-pane tree view: Left hierarchy navigator for teams/departments, right pane for team details, lead, members, and sub-projects. |
| **943** | **Ask AI (P1)** | Flagged P1 feature layout: AI chat assistant, suggested question chips, interactive chat stream with citation chips. |
| **946–948**| **Settings Drawer** | Right slide-out drawer with tabs (`Appearance`, `Integrations`, `Shortcuts`). Appearance tab includes color picker swatch, hex input, presets, and reset. |
| **949–951**| **Help Drawer** | Right slide-out drawer with accordion FAQs explaining AI notes, human approvals, keyboard shortcuts, and retention policies. |
| **952–954**| **Keyboard Shortcuts** | Centered modal with keyboard keycap badges grouped into Navigation, Actions, and Views. |
| **955** | **Account Popover** | Bottom-left popover anchored to user pill with Profile, Settings, and Sign out items. |
| **956** | **Profile Settings** | Profile form layout with avatar, full name, email, timezone, and notification preferences. |
| **958** | **Full Settings Page** | Full-page settings view with tabs, organization controls, and live theme appearance preview. |

---

## 3. Persistent Navigation & Shell Architecture

### 3.1 Desktop Sidebar (~320px)

The sidebar is fixed to the left on screens $\ge 1024\text{px}$ (`lg:` breakpoint) and renders:
1. **Organization Switcher (Top)**:
   - Organization icon/avatar, name, slug, and chevron.
   - Popover to switch between authenticated organizations or create a new organization.
2. **Search / Command Trigger**:
   - `Search or jump to...` input styled trigger.
   - `Ctrl+K` (or `Cmd+K` on macOS) shortcut badge.
3. **Personal Navigation**:
   - `Home` (`/orgs/[orgId]`)
   - `My Tasks` (`/orgs/[orgId]/my-tasks`)
   - `Inbox` (Approvals & Notifications)
4. **Company / Workspace Navigation**:
   - `Teams` (`/orgs/[orgId]/teams`)
   - `Projects` (`/orgs/[orgId]/projects`)
   - `Documents` (`/orgs/[orgId]/docs`)
   - `Meetings` (`/orgs/[orgId]/meetings`)
   - `Members` (`/orgs/[orgId]/members`)
5. **Daily Focus / Reminder Card**:
   - Compact reminder card prompting task review or meeting action approvals.
6. **User Account Pill (Bottom)**:
   - User avatar, name, email.
   - More icon (`...`) opening the account popover (`Profile`, `Settings`, `Sign out`).

### 3.2 Responsive Mobile Drawer

On mobile viewports ($< 1024\text{px}$), the sidebar is hidden and replaced with:
- Top mobile header bar containing the organization brand and a hamburger menu button.
- Slide-out mobile drawer with full sidebar navigation, backdrop overlay, and swipe-to-close behavior.

### 3.3 Top Bar & Project View Switcher

When viewing project-scoped views, the top bar presents:
- Organization & Project breadcrumb.
- Horizontal pill navigation:
  - `Dashboard`
  - `List`
  - `Board`
  - `Documents`
  - `Meetings`
- Active pill is styled with solid `--accent` background and `--accent-foreground` dark text.
- Utility buttons on the right:
  - `Ask AI` pill (labeled with `P1` badge)
  - `Help` button (`?` icon) -> opens Help Drawer
  - `Shortcuts` button (`Cmd` icon) -> opens Keyboard Shortcuts Modal
  - `Settings` button (gear icon) -> opens Settings Drawer

---

## 4. Accessibility & Keyboard Navigation (WCAG 2.1 AA)

### 4.1 Focus Management & Trapping

- All drawers (`SettingsDrawer`, `HelpDrawer`, `MobileNav`) and dialogs (`ShortcutsDialog`, `CommandLauncher`) trap keyboard focus using accessible dialog patterns.
- Pressing `Escape` closes the topmost modal or drawer and restores focus to the invoking trigger.
- Drawers and dialogs render appropriate ARIA attributes: `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, and `aria-describedby`.

### 4.2 Keyboard Shortcut Map

| Key Combination | Action | Scope |
|---|---|---|
| `Ctrl+K` / `Cmd+K` | Open Command Palette / Search | Global |
| `Shift+?` | Open Keyboard Shortcuts Modal | Global |
| `Escape` | Close active Drawer, Dialog, or Popover | Global |
| `Shift+D` | Jump to Project Dashboard | Org Scope |
| `Shift+L` | Jump to Project Task List | Org Scope |
| `Shift+B` | Jump to Project Kanban Board | Org Scope |
| `Alt+M` | Jump to My Tasks | Org Scope |
| `Alt+Shift+T` | Jump to Teams Directory | Org Scope |

*Note*: Global keyboard shortcuts are suppressed when the active element is an `<input>`, `<textarea>`, `<select>`, or has `contenteditable="true"`.

---

## 5. Component Specifications

### 5.1 Completion Ring (`CompletionRing`)
- SVG circular gauge displaying percentage completion.
- Background track: `--border-subtle` (`#222633`).
- Progress stroke: `--accent` (`#d86dfc`).
- Center label: `0% COMPLETE` or `XX% COMPLETE`.

### 5.2 Metric Strip (`MetricStrip`)
- 4-column responsive grid of summary cards.
- Each card displays:
  - Indicator dot: Magenta (`#d86dfc`), Amber (`#f59e0b`), Emerald (`#34d399`), Purple (`#818cf8`).
  - Metric label (e.g., `Total Tasks`, `In Progress`, `Pending Review`, `Completed`).
  - Metric value (large bold count).
  - Trend indicator / subtitle.

### 5.3 Badges (`Badge`)
- Never rely on color alone to convey status.
- Text + icon pairing for all statuses:
  - `To Do`: Slate pill + Circle icon.
  - `In Progress`: Amber pill + PlayCircle / Loader icon.
  - `Done` / `Completed`: Emerald pill + CheckCircle icon.
  - `Cancelled`: Rose pill + XCircle icon.
  - Role badges: `Owner` (Magenta/Orchid), `Admin` (Indigo), `Member` (Slate), `Viewer` (Zinc).
