# BD Smart POS - Role-wise Process Guide (Bangladesh)

This guide explains how to run the system role by role, with practical daily processes and step-by-step flows.

Use this as your operational SOP for pilot/production-lite rollout.

---

## Visual Process Map (Diagram-first)

```mermaid
flowchart LR
    A[Admin] --> B[Role & Permission Setup]
    B --> C[Manager]
    B --> D[Cashier]
    B --> E[Inventory Officer]
    B --> F[Purchase Officer]
    B --> G[Accountant]

    C --> H[Dashboard Review]
    D --> I[POS Sales & Returns]
    E --> J[Stock Count/Transfer/Adjust]
    F --> K[Purchase & Supplier Due]
    G --> L[Accounting & VAT Reports]

    I --> M[Due/Collection]
    J --> K
    K --> L
    M --> L
```

```mermaid
flowchart TD
    S1[Day Start] --> S2[Manager opens Dashboard]
    S2 --> S3[Cashier starts POS]
    S3 --> S4[Inventory checks Low Stock]
    S4 --> S5{Low stock critical?}
    S5 -- Yes --> S6[Create Purchase Draft]
    S5 -- No --> S7[Normal operation]
    S6 --> S8[Purchases with Suggested Supplier]
    S8 --> S7
    S7 --> S9[Day-end settlement + reports]
```

---

## 1) System Roles and Responsibility

## Admin (Owner / Super Admin)
- Seed and configure the system.
- Create branches, roles, users, and permissions.
- Approve high-risk overrides (discount, return, credit limit, stock count variance, hold-cart cross-user actions).
- Monitor compliance, backups, and controls.

## Manager (Branch Manager)
- Supervise daily sales and stock health.
- Approve exceptional actions as per policy.
- Review dashboards, due risks, and quote follow-ups.
- Ensure store-level discipline and shift compliance.

## Cashier (POS Operator)
- Run daily checkout, print invoices, manage held carts and quotations.
- Collect payments and handle split payment entry.
- Follow exception approval flow when required.

## Inventory / Store Officer
- Manage stock adjustments, stock counts, and branch transfers.
- Track low stock alerts and trigger purchase drafts.
- Maintain warehouse discipline and variance reasons.

## Purchase Officer
- Create purchase bills, purchase returns, and supplier due tracking.
- Maintain VAT inclusive/exclusive line entry accuracy.
- Use supplier suggestion and split-bill automation for draft replenishment.

## Accountant
- Review journals, trial balance, financial reports.
- Review VAT register and VAT summary.
- Reconcile due collection/payment and settlement reports.

---

## 2) Permission Model (Reference)

Permissions currently seeded in system:
- `branch.manage`
- `product.view`, `product.create`
- `sale.view`, `sale.create`, `sale.return`
- `rbac.manage`
- `inventory.view`, `inventory.adjust`, `inventory.transfer`
- `purchase.view`, `purchase.create`, `purchase.return`
- `accounting.view`, `accounting.journal.create`, `accounting.report`
- `report.view`
- `supplier.view`, `supplier.create`
- `customer.view`, `customer.create`
- `expense.view`, `expense.create`

Role templates available:
- Cashier
- Manager
- Accountant
- Admin

---

## 3) First-time Setup (Admin)

1. Configure backend and frontend `.env`.
2. Run backend schema sync and start backend.
3. Call `POST /api/bootstrap/seed` with branch/admin payload.
4. Login as admin (`admin@bdpos.local` by default if used in seed).
5. Go to Role Management:
   - Verify templates.
   - Create/update users per branch.
6. Configure master data:
   - Suppliers
   - Customers
   - Products (with SKU, VAT %, reorder level, default discounts)
7. Configure manager PIN policy and internal approval policy.

---

## 4) Daily Opening Process

## Manager
1. Login and open Dashboard.
2. Check:
   - Low stock priorities
   - Quote reminder overdue
   - Cashflow snapshot
3. Confirm cashier and inventory staff are assigned.

## Cashier
1. Login to POS.
2. Verify branch shown in top bar is correct.
3. Validate receipt settings (paper size, language, store info).
4. Test barcode scanner with 1 sample scan.

## Inventory Officer
1. Open Inventory.
2. Review low-stock alerts.
3. Create purchase draft for critical items if needed.

---

## 5) POS Checkout Process (Cashier)

```mermaid
flowchart TD
    P1[Add items/barcode] --> P2[Select customer if due/loyalty needed]
    P2 --> P3[Apply discount/override/redeem]
    P3 --> P4[Choose payment method]
    P4 --> P5{Approval needed?}
    P5 -- Yes --> P6[Manager PIN]
    P5 -- No --> P7[Checkout]
    P6 --> P7
    P7 --> P8[Invoice print + due confirmation]
```

1. Add products by click or barcode.
2. Enter customer (name/phone) when sale may include due or loyalty usage.
3. Apply:
   - product/line overrides if allowed
   - cart discount
   - loyalty redemption
4. Select payment:
   - cash/card/mobile banking/split.
5. Click checkout.

If approval needed:
- enter manager PIN (discount/price override/high redemption/credit over-limit).

After success:
- print invoice
- verify paid/due values.

---

## 6) Due / Credit Control Process

## Cashier
1. For due sale, ensure customer is selected.
2. If credit limit breach occurs, request manager PIN.
3. Complete sale only after approved PIN.

## Due Collection Officer / Accountant
1. Go to Due Collection.
2. Filter customer dues.
3. Post receipt voucher against customer due.
4. Confirm updated customer balance and journal impact.

---

## 7) Held Cart and Quotation Process

## Cashier
1. Hold cart if customer is undecided.
2. Add hold note.
3. Resume own hold directly.
4. For another cashier's hold, obtain manager PIN.

## Sales / Manager
1. Save sales quotation from POS.
2. Use quote reminder statuses:
   - OVERDUE / TODAY / TOMORROW / UPCOMING
3. Convert quote to sale when customer confirms.

---

## 8) Inventory Process (Store Officer)

```mermaid
flowchart LR
    I1[Inventory Menu] --> I2[Stock Adjustment]
    I1 --> I3[Stock Count]
    I1 --> I4[Stock Transfer]
    I1 --> I5[Low Stock Alerts]

    I5 --> I6[Create Purchase Draft]
    I6 --> I7[Purchases Module]
```

## A) Manual Adjustment
1. Open Inventory.
2. Select product and warehouse (optional).
3. Enter `qtyChange` (+/-) and reason.
4. Submit and verify ledger entry.

## B) Stock Count
1. Create stock count session/schedule.
2. Count and submit counted quantities.
3. Add variance reason for mismatches.
4. Finalize session.
5. If high variance threshold is hit, manager PIN approval is required.

## C) Branch Transfer
1. Select destination branch.
2. Add transfer line(s):
   - source product
   - destination mapped product
   - quantity
3. Submit transfer and verify transfer history.

---

## 9) Replenishment Process (Low Stock -> Purchase)

```mermaid
flowchart TD
    R1[Low Stock Alerts] --> R2[Create Draft single/all]
    R2 --> R3[Purchases Draft Card]
    R3 --> R4{Supplier suggestions available?}
    R4 -- Yes --> R5[Use Suggested Supplier]
    R4 -- Mixed --> R6[Auto Split & Create Bills]
    R4 -- No --> R7[Manual supplier selection]
    R5 --> R8[Create Purchase]
    R6 --> R9[Multiple Purchase Bills]
    R7 --> R8
```

1. Open Inventory low-stock list.
2. Use:
   - `Create Purchase Draft` (single item), or
   - `Create Draft for All Low/Out Items`.
3. System redirects to Purchases.
4. In Purchases draft card:
   - review suggested suppliers
   - use single supplier or
   - `Auto Split & Create Bills` by supplier.
5. Validate created bills in purchase history.

---

## 10) Purchase Bill Process (Purchase Officer)

```mermaid
flowchart TD
    B1[Select Supplier] --> B2[Add line: product, qty, cost]
    B2 --> B3[Set VAT% and VAT Type]
    B3 --> B4[Submit Purchase]
    B4 --> B5[Stock In + Payable + Journal]
    B5 --> B6[Purchase History VAT breakdown]
    B6 --> B7[Details modal for line-wise VAT]
```

1. Select supplier.
2. Add purchase line(s):
   - product, qty, cost
   - VAT %
   - VAT Type (`EXCLUSIVE` or `INCLUSIVE`)
3. Submit purchase.
4. Verify:
   - stock increased
   - supplier payable updated
   - accounting journal posted.

## Purchase Return
1. Select purchase bill.
2. Choose item and qty for return.
3. Enter reason and submit.
4. Verify stock/payable/journal impact.

---

## 11) VAT Compliance Process (Current)

```mermaid
flowchart LR
    V1[Sales VAT Data] --> V3[VAT Summary]
    V2[Purchase VAT Data] --> V3[VAT Summary]
    V3 --> V4[Net VAT Payable]
    V3 --> V5[VAT Sales Register]
    V5 --> V6[CSV/PDF Export]
```

## Available now
1. Go to Reports.
2. Use date filter.
3. Review:
   - VAT Summary
   - VAT Sales Register
4. Export:
   - VAT Sales Register CSV/PDF

## Purchase VAT trace
1. Open Purchases.
2. In purchase history, click `Details`.
3. Review line-wise VAT trace:
   - taxable
   - VAT rate/type
   - VAT amount
   - gross

## Important note
- Input VAT is exact for purchases captured with new VAT audit payload.
- Older purchases may be estimated using product VAT rate.

---

## 12) Accounting and Reconciliation Process

```mermaid
flowchart TD
    A1[Settlement Reports] --> A5[Reconciliation Review]
    A2[Due Collection/Payment] --> A5
    A3[Journals/Trial Balance] --> A5
    A4[VAT Summary/Register] --> A5
    A5 --> A6[Exception investigation]
    A6 --> A7[Corrective posting/action]
```

## Accountant Daily
1. Review settlement:
   - payment method/channel
   - paid vs due
2. Review dues:
   - customer receivable
   - supplier payable
3. Review Accounting module:
   - journals
   - trial balance
   - P&L
   - balance sheet
4. Investigate mismatches:
   - payment channel totals vs vouchers vs journals

---

## 13) Dashboard Review Process (Manager/Admin)

Use Dashboard at least 3 times/day:
- Opening
- Mid-day
- Closing

Check:
1. Sales and collection trend (vs yesterday).
2. Purchase and low-stock trend.
3. Cashflow snapshot.
4. Top payment methods.
5. Top products.
6. Low-stock priorities.
7. Recent sales and quote follow-up counts.

---

## 14) Period-End / Closing Checklist

```mermaid
flowchart TD
    C1[Daily Close] --> C2[Export Settlement/Aging/VAT]
    C2 --> C3[Backup snapshot]
    C3 --> C4[Weekly reconcile]
    C4 --> C5[Monthly VAT + Financial finalization]
    C5 --> C6[Archive reports + verify restore readiness]
```

## Daily close
1. Confirm no pending critical approvals.
2. Confirm due collections posted.
3. Export key reports:
   - settlement
   - aging
   - VAT sales register
4. Save backup snapshot.

## Weekly close
1. Reconcile receivable/payable movements.
2. Review stock count variance patterns.
3. Review role/permission drift.

## Monthly close
1. Finalize VAT summary and register export.
2. Verify accounting statements.
3. Archive month-end reports and backups.

---

## 15) Exception Handling SOP

## A) Wrong sale entry
1. Use Sales Return with reason.
2. Manager PIN approval required.
3. Recreate corrected sale.

## B) Stock mismatch
1. Run stock count session.
2. Record reasons.
3. Finalize with approval if high variance.

## C) User cannot access module
1. Verify role template and permission mapping.
2. Re-assign permissions from Role Management.
3. Re-login to refresh token permissions.

## D) Credit limit block at checkout
1. Verify customer due and credit limit.
2. Use manager PIN if business-approved override.
3. Prefer partial collection to reduce due.

---

## 16) Security and Control SOP (Must Follow)

1. Change default admin password immediately.
2. Set strong `JWT_SECRET`.
3. Restrict backend CORS origin in production.
4. Limit manager PIN sharing.
5. Use role-based least privilege.
6. Keep backup retention and restore drill process.
7. Keep audit logs retained and reviewed.

---

## 17) Suggested Training Plan

## Day 1
- Cashier: POS, payment, hold/quote, return.
- Inventory: low-stock, adjustment, transfer, stock count.

## Day 2
- Purchase officer: draft -> supplier suggestion -> split purchase -> VAT type.
- Accountant: reports, VAT register, reconciliation.

## Day 3
- Manager/Admin: approvals, dashboards, exception handling, role governance.

---

## 18) Quick Go-Live Readiness Checklist

- [ ] Users and roles configured.
- [ ] Product VAT and reorder level complete.
- [ ] Supplier/customer masters cleaned.
- [ ] Manager PIN policy published.
- [ ] Daily backup job active.
- [ ] Reports export tested (CSV/PDF).
- [ ] VAT summary + sales register verified.
- [ ] Purchase VAT detail modal validated for sample bills.
- [ ] Recovery test performed once.

---

## Appendix: Role-wise Swimlane (High Level)

```mermaid
flowchart LR
    subgraph Admin
      AD1[Seed system]
      AD2[Create roles/users]
      AD3[Security policy]
    end
    subgraph Manager
      MG1[Dashboard monitoring]
      MG2[Approvals]
      MG3[Closing review]
    end
    subgraph Cashier
      CS1[POS checkout]
      CS2[Hold/Quote]
      CS3[Collection]
    end
    subgraph Inventory
      IV1[Adjust/Count/Transfer]
      IV2[Low stock monitor]
    end
    subgraph Purchase
      PU1[Draft to PO]
      PU2[VAT line entry]
      PU3[Purchase return]
    end
    subgraph Accountant
      AC1[Reports & books]
      AC2[VAT review]
      AC3[Reconciliation]
    end

    AD2 --> MG1
    CS1 --> MG2
    IV2 --> PU1
    PU2 --> AC2
    CS3 --> AC3
    MG3 --> AC3
```

