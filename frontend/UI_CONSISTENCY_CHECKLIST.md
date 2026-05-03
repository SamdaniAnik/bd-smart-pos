# UI Consistency Checklist

Use this checklist when creating or updating pages in the frontend.

## 1) Page Structure

- Use a clear page header with:
  - `page-title`
  - `page-subtitle` in the format: `Step-by-step <area> workflow`
- If a page has multiple tasks, split it into numbered tabs:
  - `1. ...`, `2. ...`, `3. ...`
- Show only one major work area at a time.
- Keep advanced tools in collapsible sections (`details/summary`) when possible.

## 2) Primary-First Layout

- Show the most important KPI/actions first.
- Place secondary analytics/tables below or behind tabs.
- Keep destructive actions (`Delete`, `Discard`) visually secondary and clearly labeled.

## 3) Wording Rules

- Use title case for button labels and section titles.
- Prefer explicit nouns:
  - `Quantity` (not `Qty`)
  - `Number` (not `No.`)
  - `Unit Cost` (not `Cost` when ambiguous)
  - `Paid Amount (BDT)` for monetary inputs
- Use action verbs consistently:
  - `Create`, `Save`, `Update`, `Export`, `Submit`, `Approve`, `Reject`
- Use consistent export naming:
  - `Export <Report Name> CSV`
  - `Export <Report Name> PDF`

## 4) Form Clarity

- Mark optional fields with `(Optional)` in placeholder/label.
- Add short helper text near submit buttons:
  - what action does
  - what is missing (if blocked)
- For risky/approval actions, show warning box with required steps.

## 5) Tables and Data Blocks

- Use clear title names that match user intent (`Purchase History`, `Low Stock Alerts`, etc.).
- Keep table action buttons short and clear (`Edit`, `Details`, `Create Purchase Draft`).
- Keep units visible in column values (`৳`, `%`, `kg`).

## 6) Visual Consistency

- Reuse existing classes where possible:
  - `page-header`, `page-card`, `form-grid`
  - `pos-tabs`, `pos-tablist`, `pos-tab`, `pos-tab-active`
  - `quick-stats`, `stat`, `badge`
- Avoid introducing one-off styling unless needed.

## 7) Validation Before Merge

- [ ] Copy is clear and consistent with this checklist
- [ ] Tabs/sections follow a step-by-step flow
- [ ] Main actions are visible without scrolling too much
- [ ] Advanced actions are grouped and labeled
- [ ] `ReadLints` returns no new issues

