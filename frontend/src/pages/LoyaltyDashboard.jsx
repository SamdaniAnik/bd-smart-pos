import { useEffect, useMemo, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";

const toInputDate = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

function LoyaltyDashboard() {
  const [range, setRange] = useState(() => {
    const now = new Date();
    const from = new Date(now);
    from.setDate(now.getDate() - 29);
    return { from: toInputDate(from), to: toInputDate(now) };
  });
  const [ranking, setRanking] = useState([]);
  const [redemptions, setRedemptions] = useState({ rows: [], summary: {} });

  const exportFile = async (url, filename) => {
    const res = await api.get(url, { responseType: "blob" });
    const blobUrl = URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(blobUrl);
  };

  const buildRangeQuery = () => {
    const q = new URLSearchParams();
    if (range.from) q.set("from", range.from);
    if (range.to) q.set("to", range.to);
    return q.toString() ? `?${q.toString()}` : "";
  };

  const setPresetRange = (preset) => {
    const now = new Date();
    if (preset === "today") {
      const today = toInputDate(now);
      setRange({ from: today, to: today });
      return;
    }
    if (preset === "last7") {
      const from = new Date(now);
      from.setDate(now.getDate() - 6);
      setRange({ from: toInputDate(from), to: toInputDate(now) });
      return;
    }
    if (preset === "month") {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      setRange({ from: toInputDate(start), to: toInputDate(now) });
      return;
    }
    setRange({ from: "", to: "" });
  };

  const load = async () => {
    const q = new URLSearchParams();
    if (range.from) q.set("from", range.from);
    if (range.to) q.set("to", range.to);
    const redemptionUrl = q.toString() ? `/sales/loyalty/redemptions?${q.toString()}` : "/sales/loyalty/redemptions";
    const [rankRes, redeemRes] = await Promise.all([
      api.get("/master/customers/loyalty"),
      api.get(redemptionUrl),
    ]);
    setRanking(rankRes.data || []);
    setRedemptions(redeemRes.data || { rows: [], summary: {} });
  };

  useEffect(() => {
    load();
  }, [range.from, range.to]);

  const tierSummary = useMemo(() => {
    return ranking.reduce(
      (acc, row) => {
        const tier = String(row.loyaltyTier || "REGULAR");
        acc[tier] = (acc[tier] || 0) + 1;
        return acc;
      },
      { REGULAR: 0, SILVER: 0, GOLD: 0 }
    );
  }, [ranking]);

  return (
    <div>
      <h2>Loyalty Dashboard</h2>
      <div className="form-grid" style={{ marginBottom: 12 }}>
        <input
          type="date"
          value={range.from}
          onChange={(e) => setRange((prev) => ({ ...prev, from: e.target.value }))}
        />
        <input
          type="date"
          value={range.to}
          onChange={(e) => setRange((prev) => ({ ...prev, to: e.target.value }))}
        />
        <button type="button" className="btn-secondary" onClick={() => setRange({ from: "", to: "" })}>
          Clear Range
        </button>
        <button type="button" className="btn-secondary" onClick={() => setPresetRange("today")}>
          Today
        </button>
        <button type="button" className="btn-secondary" onClick={() => setPresetRange("last7")}>
          Last 7 Days
        </button>
        <button type="button" className="btn-secondary" onClick={() => setPresetRange("month")}>
          This Month
        </button>
        <button type="button" onClick={() => exportFile("/master/customers/loyalty/export.csv", "loyalty-ranking.csv")}>
          Export Ranking CSV
        </button>
        <button type="button" className="btn-secondary" onClick={() => exportFile("/master/customers/loyalty/export.pdf", "loyalty-ranking.pdf")}>
          Export Ranking PDF
        </button>
        <button type="button" onClick={() => exportFile("/master/customers/loyalty/export.xlsx", "loyalty-ranking.xlsx")}>
          Export Ranking XLSX
        </button>
        <button
          type="button"
          onClick={() => exportFile(`/sales/loyalty/redemptions/export.csv${buildRangeQuery()}`, "loyalty-redemptions.csv")}
        >
          Export Redemptions CSV
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => exportFile(`/sales/loyalty/redemptions/export.pdf${buildRangeQuery()}`, "loyalty-redemptions.pdf")}
        >
          Export Redemptions PDF
        </button>
        <button
          type="button"
          onClick={() => exportFile(`/sales/loyalty/redemptions/export.xlsx${buildRangeQuery()}`, "loyalty-redemptions.xlsx")}
        >
          Export Redemptions XLSX
        </button>
      </div>

      <div className="quick-stats" style={{ marginBottom: 12 }}>
        <div className="stat">Customers: {ranking.length}</div>
        <div className="stat">Regular: {tierSummary.REGULAR}</div>
        <div className="stat">Silver: {tierSummary.SILVER}</div>
        <div className="stat">Gold: {tierSummary.GOLD}</div>
        <div className="stat">Redeemed Points: {Number(redemptions.summary?.redeemedPoints || 0).toFixed(0)}</div>
        <div className="stat">Redeemed Amount: ৳{Number(redemptions.summary?.redeemedAmount || 0).toFixed(2)}</div>
      </div>

      <DataTable
        title="Top Loyalty Customers"
        rows={ranking.map((row, idx) => ({ rowNo: idx + 1, ...row }))}
        searchableKeys={["name", "phone", "loyaltyTier"]}
        columns={[
          { key: "rowNo", label: "ID" },
          { key: "name", label: "Customer" },
          { key: "phone", label: "Phone", render: (v) => v || "-" },
          { key: "loyaltyTier", label: "Tier" },
          { key: "loyaltyPoints", label: "Available Points", render: (v) => Number(v || 0).toFixed(0) },
          { key: "loyaltyTotalSpent", label: "Total Spent", render: (v) => `৳${Number(v || 0).toFixed(2)}` },
          { key: "loyaltyOrders", label: "Orders" },
        ]}
      />

      <DataTable
        title="Loyalty Redemption History"
        rows={(redemptions.rows || []).map((row, idx) => ({
          rowNo: idx + 1,
          ...row,
          createdAtLabel: new Date(row.createdAt).toLocaleString(),
        }))}
        searchableKeys={["invoiceNo", "customerName", "customerPhone", "tier", "createdAtLabel"]}
        columns={[
          { key: "rowNo", label: "ID" },
          { key: "invoiceNo", label: "Invoice" },
          { key: "customerName", label: "Customer" },
          { key: "customerPhone", label: "Phone" },
          { key: "tier", label: "Tier" },
          { key: "redeemedPoints", label: "Redeemed Points" },
          { key: "redeemedAmount", label: "Redeemed Amount", render: (v) => `৳${Number(v || 0).toFixed(2)}` },
          { key: "tierDiscountAmount", label: "Tier Discount", render: (v) => `৳${Number(v || 0).toFixed(2)}` },
          { key: "createdAtLabel", label: "Date" },
        ]}
      />
    </div>
  );
}

export default LoyaltyDashboard;
