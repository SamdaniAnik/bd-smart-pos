import { useEffect, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";

function Shifts() {
  const [currentShift, setCurrentShift] = useState(null);
  const [history, setHistory] = useState([]);
  const [openingCash, setOpeningCash] = useState("");
  const [closingCash, setClosingCash] = useState("");

  const load = async () => {
    const [currentRes, historyRes] = await Promise.all([
      api.get("/shifts/current"),
      api.get("/shifts/history"),
    ]);
    setCurrentShift(currentRes.data);
    setHistory(historyRes.data);
  };

  useEffect(() => {
    load();
  }, []);

  const openShift = async (e) => {
    e.preventDefault();
    await api.post("/shifts/open", { openingCash: Number(openingCash || 0) });
    setOpeningCash("");
    load();
  };

  const closeShift = async (e) => {
    e.preventDefault();
    await api.post("/shifts/close", { closingCash: Number(closingCash || 0) });
    setClosingCash("");
    load();
  };

  return (
    <div>
      <h2>Shift & Cash Reconciliation</h2>
      {currentShift ? (
        <div className="page-card" style={{ marginBottom: 12 }}>
          <h4>Open Shift</h4>
          <p><strong>Register:</strong> {currentShift.register?.name || "-"}</p>
          <p><strong>Opened:</strong> {new Date(currentShift.openedAt).toLocaleString()}</p>
          <p><strong>Opening Cash:</strong> ৳{Number(currentShift.openingCash || 0).toFixed(2)}</p>
          <p><strong>Expected Cash:</strong> ৳{Number(currentShift.expectedCash || 0).toFixed(2)}</p>
          <form onSubmit={closeShift} className="form-grid">
            <input
              type="number"
              placeholder="Counted closing cash"
              value={closingCash}
              onChange={(e) => setClosingCash(e.target.value)}
            />
            <button type="submit">Close Shift</button>
          </form>
        </div>
      ) : (
        <form onSubmit={openShift} className="form-grid" style={{ marginBottom: 12 }}>
          <input
            type="number"
            placeholder="Opening cash"
            value={openingCash}
            onChange={(e) => setOpeningCash(e.target.value)}
          />
          <button type="submit">Open Shift</button>
        </form>
      )}

      <DataTable
        title="Recent Shift History"
        rows={history.map((row) => ({
          ...row,
          openedAtLabel: new Date(row.openedAt).toLocaleString(),
          closedAtLabel: row.closedAt ? new Date(row.closedAt).toLocaleString() : "Open",
        }))}
        searchableKeys={["openedAtLabel", "closedAtLabel"]}
        columns={[
          { key: "id", label: "ID" },
          { key: "openedAtLabel", label: "Opened At" },
          { key: "closedAtLabel", label: "Closed At" },
          { key: "openingCash", label: "Opening", render: (v) => `৳${Number(v || 0).toFixed(2)}` },
          { key: "expectedCash", label: "Expected", render: (v) => `৳${Number(v || 0).toFixed(2)}` },
          { key: "closingCash", label: "Counted", render: (v) => `৳${Number(v || 0).toFixed(2)}` },
          { key: "variance", label: "Variance", render: (v) => `৳${Number(v || 0).toFixed(2)}` },
        ]}
      />
    </div>
  );
}

export default Shifts;
