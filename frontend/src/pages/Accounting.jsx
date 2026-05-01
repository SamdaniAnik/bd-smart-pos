import { useEffect, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";

function Accounting() {
  const [accounts, setAccounts] = useState([]);
  const [trialBalance, setTrialBalance] = useState([]);
  const [pl, setPl] = useState({ revenue: 0, expense: 0, netProfit: 0 });
  const [bs, setBs] = useState({ assets: 0, liabilities: 0, equity: 0 });

  useEffect(() => {
    const load = async () => {
      const [a, t, p, b] = await Promise.all([
        api.get("/accounting/accounts"),
        api.get("/accounting/reports/trial-balance"),
        api.get("/accounting/reports/profit-loss"),
        api.get("/accounting/reports/balance-sheet"),
      ]);
      setAccounts(a.data);
      setTrialBalance(t.data);
      setPl(p.data);
      setBs(b.data);
    };
    load();
  }, []);

  return (
    <div>
      <h2>Accounting</h2>
      <div className="quick-stats">
        <div className="stat">Revenue: ৳{pl.revenue?.toFixed?.(2) || 0}</div>
        <div className="stat">Expense: ৳{pl.expense?.toFixed?.(2) || 0}</div>
        <div className="stat">Net Profit: ৳{pl.netProfit?.toFixed?.(2) || 0}</div>
        <div className="stat">Assets: ৳{bs.assets?.toFixed?.(2) || 0}</div>
        <div className="stat">Liabilities: ৳{bs.liabilities?.toFixed?.(2) || 0}</div>
        <div className="stat">Equity: ৳{bs.equity?.toFixed?.(2) || 0}</div>
      </div>
      <DataTable
        title="Chart of Accounts"
        rows={accounts}
        searchableKeys={["code", "name", "type"]}
        filters={[
          {
            key: "type",
            label: "Type",
            options: [...new Set(accounts.map((a) => a.type))].map((x) => ({ label: x, value: x })),
          },
        ]}
        columns={[
          { key: "id", label: "ID" },
          { key: "code", label: "Code" },
          { key: "name", label: "Name" },
          { key: "type", label: "Type" },
        ]}
      />
      <DataTable
        title="Trial Balance"
        rows={trialBalance.map((row, idx) => ({ rowNo: idx + 1, ...row }))}
        searchableKeys={["code", "name"]}
        columns={[
          { key: "rowNo", label: "ID" },
          { key: "code", label: "Code" },
          { key: "name", label: "Name" },
          { key: "debit", label: "Debit", render: (v) => Number(v).toFixed(2) },
          { key: "credit", label: "Credit", render: (v) => Number(v).toFixed(2) },
          { key: "balance", label: "Balance", render: (v) => Number(v).toFixed(2) },
        ]}
      />
    </div>
  );
}

export default Accounting;
