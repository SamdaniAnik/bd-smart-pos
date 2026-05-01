# BD Smart POS - Diagram-only Process Maps

Use this file for quick training sessions, operations briefings, and role onboarding.

---

## 1) End-to-end Operational Map

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

---

## 2) Daily Branch Flow

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

## 3) POS Checkout Flow

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

---

## 4) Inventory Flow

```mermaid
flowchart LR
    I1[Inventory Menu] --> I2[Stock Adjustment]
    I1 --> I3[Stock Count]
    I1 --> I4[Stock Transfer]
    I1 --> I5[Low Stock Alerts]

    I5 --> I6[Create Purchase Draft]
    I6 --> I7[Purchases Module]
```

---

## 5) Replenishment Flow (Low Stock -> Purchase)

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

---

## 6) Purchase + VAT Capture Flow

```mermaid
flowchart TD
    B1[Select Supplier] --> B2[Add line: product, qty, cost]
    B2 --> B3[Set VAT% and VAT Type]
    B3 --> B4[Submit Purchase]
    B4 --> B5[Stock In + Payable + Journal]
    B5 --> B6[Purchase History VAT breakdown]
    B6 --> B7[Details modal for line-wise VAT]
```

---

## 7) VAT Compliance Flow (Current)

```mermaid
flowchart LR
    V1[Sales VAT Data] --> V3[VAT Summary]
    V2[Purchase VAT Data] --> V3[VAT Summary]
    V3 --> V4[Net VAT Payable]
    V3 --> V5[VAT Sales Register]
    V5 --> V6[CSV/PDF Export]
```

---

## 8) Accounting Reconciliation Flow

```mermaid
flowchart TD
    A1[Settlement Reports] --> A5[Reconciliation Review]
    A2[Due Collection/Payment] --> A5
    A3[Journals/Trial Balance] --> A5
    A4[VAT Summary/Register] --> A5
    A5 --> A6[Exception investigation]
    A6 --> A7[Corrective posting/action]
```

---

## 9) Period-end Closing Flow

```mermaid
flowchart TD
    C1[Daily Close] --> C2[Export Settlement/Aging/VAT]
    C2 --> C3[Backup snapshot]
    C3 --> C4[Weekly reconcile]
    C4 --> C5[Monthly VAT + Financial finalization]
    C5 --> C6[Archive reports + verify restore readiness]
```

---

## 10) Role-wise Swimlane (High Level)

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

