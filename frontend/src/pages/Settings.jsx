import { useEffect, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";
import { notifyActionRequired, notifySuccess } from "../utils/notify";

function Settings() {
  const [branchId, setBranchId] = useState(localStorage.getItem("bd_pos_branch_id") || "1");
  const [managerPinForm, setManagerPinForm] = useState({
    currentPin: "",
    newPin: "",
    confirmPin: "",
  });
  const [showPins, setShowPins] = useState({
    current: false,
    next: false,
    confirm: false,
  });
  const [branches, setBranches] = useState([]);
  const [branchForm, setBranchForm] = useState({
    code: "",
    name: "",
    address: "",
    phone: "",
    isActive: true,
    sellerBin: "",
    tradeLicenseNo: "",
    vatRegistrationLabel: "",
  });
  const [editingBranchId, setEditingBranchId] = useState(null);
  const [settingsTab, setSettingsTab] = useState("general");

  const loadBranches = async () => {
    const res = await api.get("/branches");
    setBranches(res.data);
  };

  useEffect(() => {
    loadBranches();
  }, []);

  const save = () => {
    localStorage.setItem("bd_pos_branch_id", branchId);
    notifySuccess("branch updated.");
  };

  const saveManagerPin = (e) => {
    e.preventDefault();
    const expectedCurrentPin = String(localStorage.getItem("bd_pos_manager_pin") || "1234");
    if (String(managerPinForm.currentPin).trim() !== expectedCurrentPin) {
      notifyActionRequired("current manager PIN is incorrect.");
      return;
    }
    const nextPin = String(managerPinForm.newPin || "").trim();
    if (nextPin.length < 4) {
      notifyActionRequired("new manager PIN must be at least 4 digits.");
      return;
    }
    if (nextPin !== String(managerPinForm.confirmPin || "").trim()) {
      notifyActionRequired("confirm PIN does not match.");
      return;
    }
    localStorage.setItem("bd_pos_manager_pin", nextPin);
    setManagerPinForm({ currentPin: "", newPin: "", confirmPin: "" });
    notifySuccess("manager PIN updated.");
  };

  const pinStrengthLabel = (() => {
    const pin = String(managerPinForm.newPin || "");
    if (!pin) return "Strength: N/A";
    if (!/^\d+$/.test(pin)) return "Strength: Weak (digits only recommended)";
    if (pin.length < 4) return "Strength: Weak";
    if (pin.length >= 6 && /(\d)(?!\1)(\d)(?!\1|\2)(\d)/.test(pin)) return "Strength: Strong";
    return "Strength: Medium";
  })();

  const submitBranch = async (e) => {
    e.preventDefault();
    const payload = {
      code: branchForm.code.trim(),
      name: branchForm.name.trim(),
      address: branchForm.address || null,
      phone: branchForm.phone || null,
      isActive: branchForm.isActive,
      sellerBin: branchForm.sellerBin?.trim() || null,
      tradeLicenseNo: branchForm.tradeLicenseNo?.trim() || null,
      vatRegistrationLabel: branchForm.vatRegistrationLabel?.trim() || null,
    };
    if (editingBranchId) {
      await api.put(`/branches/${editingBranchId}`, payload);
    } else {
      await api.post("/branches", payload);
    }
    setBranchForm({ code: "", name: "", address: "", phone: "", isActive: true, sellerBin: "", tradeLicenseNo: "", vatRegistrationLabel: "" });
    setEditingBranchId(null);
    loadBranches();
  };

  const editBranch = async (row) => {
    const res = await api.get(`/branches/${row.id}`);
    const b = res.data;
    setEditingBranchId(b.id);
    setBranchForm({
      code: b.code || "",
      name: b.name || "",
      address: b.address || "",
      phone: b.phone || "",
      isActive: Boolean(b.isActive),
      sellerBin: b.sellerBin || "",
      tradeLicenseNo: b.tradeLicenseNo || "",
      vatRegistrationLabel: b.vatRegistrationLabel || "",
    });
  };

  const deleteBranch = async (row) => {
    if (!window.confirm(`Delete branch "${row.name}"?`)) return;
    await api.delete(`/branches/${row.id}`);
    if (String(row.id) === String(branchId)) {
      localStorage.setItem("bd_pos_branch_id", "1");
      setBranchId("1");
    }
    if (editingBranchId === row.id) {
      setEditingBranchId(null);
      setBranchForm({ code: "", name: "", address: "", phone: "", isActive: true, sellerBin: "", tradeLicenseNo: "", vatRegistrationLabel: "" });
    }
    loadBranches();
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">System Settings</div>
          <div className="page-subtitle">Step-by-step settings workflow</div>
        </div>
      </div>
      <div className="pos-tabs">
        <div className="pos-tablist" role="tablist" aria-label="Settings tabs">
          <button
            type="button"
            role="tab"
            aria-selected={settingsTab === "general"}
            className={`pos-tab ${settingsTab === "general" ? "pos-tab-active" : ""}`}
            onClick={() => setSettingsTab("general")}
          >
            1. General
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={settingsTab === "security"}
            className={`pos-tab ${settingsTab === "security" ? "pos-tab-active" : ""}`}
            onClick={() => setSettingsTab("security")}
          >
            2. Security
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={settingsTab === "branches"}
            className={`pos-tab ${settingsTab === "branches" ? "pos-tab-active" : ""}`}
            onClick={() => setSettingsTab("branches")}
          >
            3. Branches
            <span className="pos-tab-badge">{branches.length}</span>
          </button>
        </div>
      </div>
      {settingsTab === "general" ? (
      <div className="form-grid">
        <label>
          Active Branch ID
          <input value={branchId} onChange={(e) => setBranchId(e.target.value)} />
        </label>
        <button onClick={save}>Save Active Branch</button>
      </div>
      ) : null}
      {settingsTab === "security" ? (
      <>
      <h3 style={{ marginTop: 20 }}>Manager PIN Settings</h3>
      <form onSubmit={saveManagerPin} className="form-grid">
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type={showPins.current ? "text" : "password"}
            placeholder="Current Manager PIN"
            value={managerPinForm.currentPin}
            onChange={(e) => setManagerPinForm((prev) => ({ ...prev, currentPin: e.target.value }))}
            required
          />
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => setShowPins((prev) => ({ ...prev, current: !prev.current }))}
          >
            {showPins.current ? "Hide" : "Show"}
          </button>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type={showPins.next ? "text" : "password"}
            placeholder="New Manager PIN"
            value={managerPinForm.newPin}
            onChange={(e) => setManagerPinForm((prev) => ({ ...prev, newPin: e.target.value }))}
            required
          />
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => setShowPins((prev) => ({ ...prev, next: !prev.next }))}
          >
            {showPins.next ? "Hide" : "Show"}
          </button>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type={showPins.confirm ? "text" : "password"}
            placeholder="Confirm New Manager PIN"
            value={managerPinForm.confirmPin}
            onChange={(e) => setManagerPinForm((prev) => ({ ...prev, confirmPin: e.target.value }))}
            required
          />
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => setShowPins((prev) => ({ ...prev, confirm: !prev.confirm }))}
          >
            {showPins.confirm ? "Hide" : "Show"}
          </button>
        </div>
        <p className="pos-inline-note">{pinStrengthLabel}</p>
        <button type="submit">Update Manager PIN</button>
      </form>
      </>
      ) : null}
      {settingsTab === "branches" ? (
      <>
      <h3 style={{ marginTop: 20 }}>Branch Master (Add/Edit/Delete)</h3>
      <form onSubmit={submitBranch} className="form-grid">
        <input
          placeholder="Branch Code"
          value={branchForm.code}
          onChange={(e) => setBranchForm({ ...branchForm, code: e.target.value })}
          required
        />
        <input
          placeholder="Branch Name"
          value={branchForm.name}
          onChange={(e) => setBranchForm({ ...branchForm, name: e.target.value })}
          required
        />
        <input
          placeholder="Address"
          value={branchForm.address}
          onChange={(e) => setBranchForm({ ...branchForm, address: e.target.value })}
        />
        <input
          placeholder="Phone"
          value={branchForm.phone}
          onChange={(e) => setBranchForm({ ...branchForm, phone: e.target.value })}
        />
        <input
          placeholder="Seller BIN (VAT)"
          value={branchForm.sellerBin}
          onChange={(e) => setBranchForm({ ...branchForm, sellerBin: e.target.value })}
        />
        <input
          placeholder="Trade License Number"
          value={branchForm.tradeLicenseNo}
          onChange={(e) => setBranchForm({ ...branchForm, tradeLicenseNo: e.target.value })}
        />
        <input
          placeholder="VAT Registration Label / Note"
          value={branchForm.vatRegistrationLabel}
          onChange={(e) => setBranchForm({ ...branchForm, vatRegistrationLabel: e.target.value })}
        />
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={branchForm.isActive}
            onChange={(e) => setBranchForm({ ...branchForm, isActive: e.target.checked })}
            style={{ width: "auto" }}
          />
          Active
        </label>
        <button type="submit">{editingBranchId ? "Update Branch" : "Add Branch"}</button>
        {editingBranchId ? (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setEditingBranchId(null);
              setBranchForm({ code: "", name: "", address: "", phone: "", isActive: true, sellerBin: "", tradeLicenseNo: "", vatRegistrationLabel: "" });
            }}
          >
            Cancel
          </button>
        ) : null}
      </form>

      <DataTable
        title="Branch List"
        rows={branches}
        searchableKeys={["code", "name", "address", "phone"]}
        columns={[
          { key: "id", label: "ID" },
          { key: "code", label: "Code" },
          { key: "name", label: "Name" },
          { key: "phone", label: "Phone", render: (v) => v || "-" },
          { key: "address", label: "Address", render: (v) => v || "-" },
          {
            key: "isActive",
            label: "Status",
            render: (v) => (
              <span className={`badge ${v ? "badge-success" : "badge-danger"}`}>
                {v ? "Active" : "Inactive"}
              </span>
            ),
          },
          {
            key: "actions",
            label: "Actions",
            render: (_, row) => (
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" className="btn-secondary btn-sm" onClick={() => editBranch(row)}>
                  Edit
                </button>
                <button type="button" className="btn-danger btn-sm" onClick={() => deleteBranch(row)}>
                  Delete
                </button>
              </div>
            ),
          },
        ]}
      />
      </>
      ) : null}
    </div>
  );
}

export default Settings;
