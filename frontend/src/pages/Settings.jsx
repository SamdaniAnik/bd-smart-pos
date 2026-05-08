import { useEffect, useMemo, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";
import SubmitButton from "../components/SubmitButton";
import { notifyActionRequired, notifySuccess } from "../utils/notify";
import { queryClient } from "../queryClient";
import { CUSTOMER_DISPLAY_ROUTE } from "../services/customerDisplay";
import { getLang, t } from "../i18n";

function Settings() {
  const [uiLang, setUiLang] = useState(() => getLang());
  useEffect(() => {
    const sync = () => setUiLang(getLang());
    window.addEventListener("bd_pos_lang_changed", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("bd_pos_lang_changed", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const tt = useMemo(() => (key, params) => t(uiLang, key, params), [uiLang]);
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
  const [submittingBranch, setSubmittingBranch] = useState(false);

  const loadBranches = async () => {
    const res = await api.get("/branches");
    setBranches(res.data);
  };

  useEffect(() => {
    loadBranches();
  }, []);

  const save = () => {
    localStorage.setItem("bd_pos_branch_id", branchId);
    queryClient.invalidateQueries();
    window.dispatchEvent(new CustomEvent("bd_pos_branch_changed", { detail: { branchId } }));
    notifySuccess(tt("branchUpdated"));
  };

  const setInterfaceLanguage = (next) => {
    const v = next === "bn" ? "bn" : "en";
    localStorage.setItem("bd_pos_lang", v);
    setUiLang(v);
    window.dispatchEvent(new CustomEvent("bd_pos_lang_changed", { detail: { lang: v } }));
  };

  const saveManagerPin = (e) => {
    e.preventDefault();
    const expectedCurrentPin = String(localStorage.getItem("bd_pos_manager_pin") || "1234");
    if (String(managerPinForm.currentPin).trim() !== expectedCurrentPin) {
      notifyActionRequired(tt("settingsErrPinCurrent"));
      return;
    }
    const nextPin = String(managerPinForm.newPin || "").trim();
    if (nextPin.length < 4) {
      notifyActionRequired(tt("settingsErrPinLen"));
      return;
    }
    if (nextPin !== String(managerPinForm.confirmPin || "").trim()) {
      notifyActionRequired(tt("settingsErrPinConfirm"));
      return;
    }
    localStorage.setItem("bd_pos_manager_pin", nextPin);
    setManagerPinForm({ currentPin: "", newPin: "", confirmPin: "" });
    notifySuccess(tt("settingsNotifyPinUpdated"));
  };

  const pinStrengthLabel = useMemo(() => {
    const pin = String(managerPinForm.newPin || "");
    if (!pin) return tt("settingsPinStrengthNa");
    if (!/^\d+$/.test(pin)) return tt("settingsPinStrengthWeakDigits");
    if (pin.length < 4) return tt("settingsPinStrengthWeak");
    if (pin.length >= 6 && /(\d)(?!\1)(\d)(?!\1|\2)(\d)/.test(pin)) return tt("settingsPinStrengthStrong");
    return tt("settingsPinStrengthMedium");
  }, [managerPinForm.newPin, tt]);

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
    setSubmittingBranch(true);
    try {
      const wasEdit = Boolean(editingBranchId);
      if (editingBranchId) {
        await api.put(`/branches/${editingBranchId}`, payload);
      } else {
        await api.post("/branches", payload);
      }
      setBranchForm({ code: "", name: "", address: "", phone: "", isActive: true, sellerBin: "", tradeLicenseNo: "", vatRegistrationLabel: "" });
      setEditingBranchId(null);
      await loadBranches();
      notifySuccess(wasEdit ? tt("branchUpdated") : tt("branchCreated"));
    } finally {
      setSubmittingBranch(false);
    }
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
    if (!window.confirm(tt("settingsDeleteBranchConfirm", { name: row.name }))) return;
    await api.delete(`/branches/${row.id}`);
    if (String(row.id) === String(branchId)) {
      localStorage.setItem("bd_pos_branch_id", "1");
      setBranchId("1");
      queryClient.invalidateQueries();
      window.dispatchEvent(new CustomEvent("bd_pos_branch_changed", { detail: { branchId: "1" } }));
    }
    if (editingBranchId === row.id) {
      setEditingBranchId(null);
      setBranchForm({ code: "", name: "", address: "", phone: "", isActive: true, sellerBin: "", tradeLicenseNo: "", vatRegistrationLabel: "" });
    }
    loadBranches();
  };

  const customerDisplayUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    const b = encodeURIComponent(String(branchId || "1").trim() || "1");
    return `${window.location.origin}${window.location.pathname}${CUSTOMER_DISPLAY_ROUTE}?branch=${b}`;
  }, [branchId]);

  const copyCustomerDisplayUrl = async () => {
    try {
      await navigator.clipboard.writeText(customerDisplayUrl);
      notifySuccess(tt("settingsCustomerDisplayCopied"));
    } catch {
      notifyActionRequired(tt("settingsClipboardUnavailable"));
    }
  };

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <div className="page-title">{tt("settingsTitle")}</div>
          <div className="page-subtitle">{tt("settingsSubtitle")}</div>
        </div>
      </div>
      <div className="pos-tabs">
        <div className="pos-tablist" role="tablist" aria-label={tt("settingsTabsAria")}>
          <button
            type="button"
            role="tab"
            aria-selected={settingsTab === "general"}
            className={`pos-tab ${settingsTab === "general" ? "pos-tab-active" : ""}`}
            onClick={() => setSettingsTab("general")}
          >
            {tt("settingsTabGeneral")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={settingsTab === "security"}
            className={`pos-tab ${settingsTab === "security" ? "pos-tab-active" : ""}`}
            onClick={() => setSettingsTab("security")}
          >
            {tt("settingsTabSecurity")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={settingsTab === "branches"}
            className={`pos-tab ${settingsTab === "branches" ? "pos-tab-active" : ""}`}
            onClick={() => setSettingsTab("branches")}
          >
            {tt("settingsTabBranches")}
            <span className="pos-tab-badge">{branches.length}</span>
          </button>
        </div>
      </div>
      {settingsTab === "general" ? (
      <>
      <div className="page-card" style={{ marginBottom: 16 }}>
        <h4 style={{ marginTop: 0 }}>{tt("displayLanguage")}</h4>
        <p className="text-muted" style={{ marginTop: 6, fontSize: 13 }}>
          {tt("displayLanguageHelp")}
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
          <button
            type="button"
            className="btn-secondary btn-sm"
            style={uiLang === "en" ? { borderColor: "var(--primary)", color: "var(--primary)", fontWeight: 600 } : undefined}
            onClick={() => setInterfaceLanguage("en")}
          >
            {tt("langEnglish")}
          </button>
          <button
            type="button"
            className="btn-secondary btn-sm"
            style={uiLang === "bn" ? { borderColor: "var(--primary)", color: "var(--primary)", fontWeight: 600 } : undefined}
            onClick={() => setInterfaceLanguage("bn")}
          >
            {tt("langBangla")}
          </button>
        </div>
      </div>
      <div className="form-grid">
        <label>
          {tt("activeBranchId")}
          <input value={branchId} onChange={(e) => setBranchId(e.target.value)} />
        </label>
        <button onClick={save}>{tt("saveActiveBranch")}</button>
      </div>
      <div className="page-card" style={{ marginTop: 16 }}>
        <h4 style={{ marginTop: 0 }}>{tt("settingsCustDisplayTitle")}</h4>
        <p className="text-muted" style={{ marginTop: 0, fontSize: 12 }}>
          {tt("settingsCustDisplayHelp")}
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input readOnly value={customerDisplayUrl} style={{ flex: 1, minWidth: 260 }} />
          <button type="button" className="btn-secondary btn-sm" onClick={copyCustomerDisplayUrl}>
            {tt("settingsCopyUrl")}
          </button>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => window.open(customerDisplayUrl, "_blank", "noopener,noreferrer")}
          >
            {tt("settingsOpen")}
          </button>
        </div>
      </div>
      </>
      ) : null}
      {settingsTab === "security" ? (
      <>
      <h3 style={{ marginTop: 20 }}>{tt("settingsMgrPinHeading")}</h3>
      <form onSubmit={saveManagerPin} className="form-grid">
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type={showPins.current ? "text" : "password"}
            placeholder={tt("settingsPhCurrentPin")}
            value={managerPinForm.currentPin}
            onChange={(e) => setManagerPinForm((prev) => ({ ...prev, currentPin: e.target.value }))}
            required
          />
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => setShowPins((prev) => ({ ...prev, current: !prev.current }))}
          >
            {showPins.current ? tt("settingsHide") : tt("settingsShow")}
          </button>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type={showPins.next ? "text" : "password"}
            placeholder={tt("settingsPhNewPin")}
            value={managerPinForm.newPin}
            onChange={(e) => setManagerPinForm((prev) => ({ ...prev, newPin: e.target.value }))}
            required
          />
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => setShowPins((prev) => ({ ...prev, next: !prev.next }))}
          >
            {showPins.next ? tt("settingsHide") : tt("settingsShow")}
          </button>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type={showPins.confirm ? "text" : "password"}
            placeholder={tt("settingsPhConfirmPin")}
            value={managerPinForm.confirmPin}
            onChange={(e) => setManagerPinForm((prev) => ({ ...prev, confirmPin: e.target.value }))}
            required
          />
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => setShowPins((prev) => ({ ...prev, confirm: !prev.confirm }))}
          >
            {showPins.confirm ? tt("settingsHide") : tt("settingsShow")}
          </button>
        </div>
        <p className="pos-inline-note">{pinStrengthLabel}</p>
        <button type="submit">{tt("settingsUpdateMgrPin")}</button>
      </form>
      </>
      ) : null}
      {settingsTab === "branches" ? (
      <>
      <h3 style={{ marginTop: 20 }}>{tt("settingsBranchMasterHeading")}</h3>
      <form onSubmit={submitBranch} className="form-grid">
        <input
          placeholder={tt("settingsPhBranchCode")}
          value={branchForm.code}
          onChange={(e) => setBranchForm({ ...branchForm, code: e.target.value })}
          required
        />
        <input
          placeholder={tt("settingsPhBranchName")}
          value={branchForm.name}
          onChange={(e) => setBranchForm({ ...branchForm, name: e.target.value })}
          required
        />
        <input
          placeholder={tt("settingsPhAddress")}
          value={branchForm.address}
          onChange={(e) => setBranchForm({ ...branchForm, address: e.target.value })}
        />
        <input
          placeholder={tt("settingsPhPhone")}
          value={branchForm.phone}
          onChange={(e) => setBranchForm({ ...branchForm, phone: e.target.value })}
        />
        <input
          placeholder={tt("settingsPhSellerBin")}
          value={branchForm.sellerBin}
          onChange={(e) => setBranchForm({ ...branchForm, sellerBin: e.target.value })}
        />
        <input
          placeholder={tt("settingsPhTradeLicense")}
          value={branchForm.tradeLicenseNo}
          onChange={(e) => setBranchForm({ ...branchForm, tradeLicenseNo: e.target.value })}
        />
        <input
          placeholder={tt("settingsPhVatLabel")}
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
          {tt("settingsBranchActive")}
        </label>
        <SubmitButton loading={submittingBranch} loadingLabel={editingBranchId ? tt("settingsUpdating") : tt("settingsSaving")}>
          {editingBranchId ? tt("settingsUpdateBranch") : tt("settingsAddBranch")}
        </SubmitButton>
        {editingBranchId ? (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setEditingBranchId(null);
              setBranchForm({ code: "", name: "", address: "", phone: "", isActive: true, sellerBin: "", tradeLicenseNo: "", vatRegistrationLabel: "" });
            }}
          >
            {tt("settingsCancel")}
          </button>
        ) : null}
      </form>

      <DataTable
        title={tt("settingsBranchListTitle")}
        rows={branches}
        searchableKeys={["code", "name", "address", "phone"]}
        columns={[
          { key: "id", label: tt("colId") },
          { key: "code", label: tt("colCode") },
          { key: "name", label: tt("colName") },
          { key: "phone", label: tt("colPhone"), render: (v) => v || "-" },
          { key: "address", label: tt("colAddress"), render: (v) => v || "-" },
          {
            key: "isActive",
            label: tt("colStatus"),
            render: (v) => (
              <span className={`badge ${v ? "badge-success" : "badge-danger"}`}>
                {v ? tt("statusActive") : tt("statusInactive")}
              </span>
            ),
          },
          {
            key: "actions",
            label: tt("colActions"),
            render: (_, row) => (
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" className="btn-secondary btn-sm" onClick={() => editBranch(row)}>
                  {tt("actionEdit")}
                </button>
                <button type="button" className="btn-danger btn-sm" onClick={() => deleteBranch(row)}>
                  {tt("actionDelete")}
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
