# BD Smart POS - রোলভিত্তিক প্রসেস গাইড (বাংলা)

এই গাইডে রোলভিত্তিক দায়িত্ব, দৈনন্দিন অপারেশন, এবং ধাপে ধাপে কাজের SOP দেওয়া আছে।

এটি পাইলট/প্রোডাকশন-লাইট অপারেশনের জন্য ব্যবহারযোগ্য।

---

## ১) রোল ও দায়িত্ব

## Admin (মালিক / সুপার অ্যাডমিন)
- সিস্টেম সেটআপ, সিড, কনফিগারেশন।
- ব্রাঞ্চ, রোল, ইউজার, পারমিশন ম্যানেজ।
- হাই-রিস্ক অ্যাপ্রুভাল পর্যবেক্ষণ।
- সিকিউরিটি, ব্যাকআপ, কন্ট্রোল নিশ্চিত করা।

## Manager (ব্রাঞ্চ ম্যানেজার)
- দৈনিক সেলস ও স্টক স্বাস্থ্য তদারকি।
- এক্সেপশন অ্যাপ্রুভাল প্রদান।
- ড্যাশবোর্ড, ডিউ রিস্ক, কোটেশন ফলোআপ মনিটর।

## Cashier (POS অপারেটর)
- POS বিক্রয়, ইনভয়েস, হোল্ড কার্ট, কোটেশন।
- পেমেন্ট এন্ট্রি ও চেকআউট।
- প্রয়োজনে ম্যানেজার PIN নিয়ে প্রসেস সম্পন্ন।

## Inventory/Store Officer
- স্টক এডজাস্টমেন্ট, স্টক কাউন্ট, ট্রান্সফার।
- লো-স্টক মনিটরিং এবং পারচেজ ড্রাফট ট্রিগার।

## Purchase Officer
- পারচেজ বিল, পারচেজ রিটার্ন, সাপ্লায়ার ডিউ।
- VAT inclusive/exclusive সঠিকভাবে এন্ট্রি।
- Suggested supplier ও auto split ব্যবহার।

## Accountant
- জার্নাল, ট্রায়াল ব্যালেন্স, রিপোর্ট রিভিউ।
- VAT summary ও VAT register যাচাই।
- সেটেলমেন্ট/রিসিভেবল/পেয়েবল রিকনসিলিয়েশন।

---

## ২) পারমিশন রেফারেন্স

সিস্টেমে ব্যবহৃত প্রধান পারমিশন:
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

রোল টেমপ্লেট:
- Cashier, Manager, Accountant, Admin

---

## ৩) প্রথমবার সেটআপ (Admin)

1. Backend/Frontend `.env` কনফিগার করুন।
2. Backend schema sync করে backend চালু করুন।
3. `POST /api/bootstrap/seed` কল করুন।
4. Admin লগইন করুন।
5. Role Management এ গিয়ে:
   - role template যাচাই
   - user তৈরি/assign
6. Master data সেট করুন:
   - suppliers
   - customers
   - products (VAT %, reorder level, SKU)
7. ম্যানেজার PIN নীতি ফাইনাল করুন।

---

## ৪) দৈনিক ওপেনিং প্রসেস

## Manager
1. Dashboard খুলুন।
2. Low stock, quote overdue, cashflow চেক করুন।
3. ক্যাশিয়ার/ইনভেন্টরি দায়িত্ব নিশ্চিত করুন।

## Cashier
1. POS লগইন।
2. Branch সিলেকশন ঠিক আছে কি না যাচাই।
3. রিসিপ্ট সেটিংস চেক।
4. বারকোড স্ক্যান টেস্ট।

## Inventory Officer
1. Inventory মডিউল খুলুন।
2. Low stock দেখুন।
3. প্রয়োজন হলে purchase draft তৈরি।

---

## ৫) POS চেকআউট প্রসেস (Cashier)

1. Product add (click/barcode)।
2. Due/loyalty হলে customer select।
3. Discount/override/redeem apply।
4. Payment method select।
5. Checkout।

অ্যাপ্রুভাল লাগলে:
- Manager PIN দিন (discount/price override/high redemption/credit breach)।

চেকআউট শেষে:
- invoice print
- paid/due যাচাই।

---

## ৬) ডিউ/ক্রেডিট কন্ট্রোল প্রসেস

## Cashier
1. Due sale হলে customer অবশ্যই দিন।
2. Credit limit breach হলে manager PIN নিন।
3. অনুমোদনের পর sale complete করুন।

## Due/Accounts Team
1. Due Collection মডিউল খুলুন।
2. Customer due filter করুন।
3. Receipt voucher পোস্ট করুন।
4. Balance update ও journal impact যাচাই।

---

## ৭) Hold Cart ও Quotation প্রসেস

## Cashier
1. Hold cart save করুন (note দিন)।
2. নিজ hold resume করুন।
3. অন্য cashier hold হলে manager PIN লাগবে।

## Sales/Manager
1. POS থেকে quotation তৈরি।
2. Reminder status দেখে followup:
   - OVERDUE / TODAY / TOMORROW / UPCOMING
3. Confirm হলে quote to sale convert।

---

## ৮) ইনভেন্টরি প্রসেস

## A) Stock Adjustment
1. Product + warehouse (optional) সিলেক্ট।
2. `qtyChange` (+/-) ও reason দিন।
3. Submit করে ledger verify করুন।

## B) Stock Count
1. Session/schedule তৈরি।
2. Counted qty submit।
3. Variance reason দিন।
4. Finalize করুন।
5. High variance হলে manager PIN approval লাগবে।

## C) Branch Transfer
1. Destination branch select।
2. Source product, mapped destination product, qty দিন।
3. Submit করুন।
4. Transfer history verify করুন।

---

## ৯) Replenishment (Low Stock -> Purchase)

1. Inventory low stock list খুলুন।
2. `Create Purchase Draft` (single/all) দিন।
3. Purchases এ গিয়ে draft card review করুন।
4. Suggested supplier ব্যবহার করুন।
5. প্রয়োজনে `Auto Split & Create Bills` ব্যবহার করুন।
6. Created purchase bills যাচাই করুন।

---

## ১০) Purchase Bill প্রসেস (VAT সহ)

1. Supplier select।
2. Line add:
   - product
   - qty
   - cost
   - VAT %
   - VAT Type (EXCLUSIVE/INCLUSIVE)
3. Submit purchase।
4. যাচাই:
   - stock increase
   - supplier payable update
   - journal posting

## Purchase Return
1. Purchase select।
2. Item + qty + reason দিন।
3. Submit।
4. Stock/payable/journal verify করুন।

---

## ১১) VAT প্রসেস (বর্তমান)

## Available
1. Reports এ যান।
2. Date filter দিন।
3. VAT Summary দেখুন।
4. VAT Sales Register দেখুন।
5. CSV/PDF export নিন।

## Purchase VAT trace
1. Purchases এ যান।
2. Purchase History থেকে `Details` ক্লিক।
3. Line-wise VAT trace দেখুন:
   - taxable
   - VAT rate/type
   - VAT amount
   - gross

## Note
- নতুন purchase এ input VAT exact capture হয়।
- পুরনো purchase এ কিছু ক্ষেত্রে estimate হতে পারে।

---

## ১২) Accounting ও Reconciliation প্রসেস

1. Settlement method/channel রিপোর্ট দেখুন।
2. Paid vs due যাচাই করুন।
3. Receivable/payable ম্যাচ করুন।
4. Accounting module এ:
   - journals
   - trial balance
   - P&L
   - balance sheet
5. mismatch থাকলে exception investigate করুন।

---

## ১৩) Dashboard Review SOP (Manager/Admin)

দিনে অন্তত ৩ বার দেখুন:
- Opening
- Mid-day
- Closing

চেকলিস্ট:
1. Sales/collection trend
2. Purchase/low-stock trend
3. Cashflow snapshot
4. Top payment methods
5. Top products
6. Low stock priorities
7. Recent sales + quote follow-up

---

## ১৪) Period-end Closing Checklist

## Daily
1. Pending critical approval নেই নিশ্চিত করুন।
2. Due collection entries verify করুন।
3. Export:
   - settlement
   - aging
   - VAT register
4. Backup নিন।

## Weekly
1. Receivable/payable movement reconcile।
2. Stock count variance trend review।
3. Role/permission drift review।

## Monthly
1. VAT summary finalize।
2. Accounting statements verify।
3. Reports archive + backup verify।

---

## ১৫) Exception Handling SOP

## ভুল বিক্রয়
1. Sales return করুন (reason সহ)।
2. Manager PIN approval দিন।
3. Corrected sale পুনরায় তৈরি করুন।

## স্টক মিসম্যাচ
1. Stock count session চালান।
2. Variance reason দিন।
3. প্রয়োজন হলে approval নিয়ে finalize করুন।

## Module access সমস্যা
1. User role/permission যাচাই।
2. Template re-apply করুন।
3. Re-login করে permissions refresh করুন।

## Credit limit block
1. Customer balance + limit যাচাই।
2. নীতি অনুযায়ী manager PIN override।
3. সম্ভব হলে partial collection নিন।

---

## ১৬) Security SOP (অবশ্যই)

1. Default admin password পরিবর্তন।
2. শক্তিশালী `JWT_SECRET` সেট করুন।
3. Production এ CORS restrict করুন।
4. Manager PIN শেয়ার নীতি কঠোর করুন।
5. Least-privilege role policy চালু করুন।
6. Backup retention + restore drill চালু করুন।
7. Audit log review রুটিন চালু করুন।

---

## ১৭) Training Plan

## Day 1
- Cashier: POS, payment, hold/quote, return
- Inventory: low-stock, adjustment, transfer, stock count

## Day 2
- Purchase officer: draft -> suggestion -> split purchase -> VAT type
- Accountant: reports, VAT register, reconciliation

## Day 3
- Manager/Admin: approvals, dashboard, exceptions, role governance

---

## ১৮) Go-live Readiness Checklist

- [ ] Role/user setup complete
- [ ] Product VAT + reorder level complete
- [ ] Supplier/customer master clean
- [ ] Manager PIN policy communicated
- [ ] Daily backup active
- [ ] Report exports tested
- [ ] VAT summary/register validated
- [ ] Purchase VAT details validated
- [ ] Recovery test completed

