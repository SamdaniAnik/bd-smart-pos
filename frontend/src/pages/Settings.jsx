import { useEffect, useMemo, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";
import SubmitButton from "../components/SubmitButton";
import { notifyActionRequired, notifySuccess, notifyPermissionRequired } from "../utils/notify";
import usePermissions from "../hooks/usePermissions";
import PermissionBanner from "../components/PermissionBanner";
import { queryClient } from "../queryClient";
import { CUSTOMER_DISPLAY_ROUTE } from "../services/customerDisplay";
import { buildStorefrontUrl } from "../services/storefront";
import QrCodeImage from "../components/QrCodeImage";
import { getLang, t } from "../i18n";
import { BUSINESS_PROFILE_OPTIONS, GROCERY_CATEGORY_CHIPS, normalizeBusinessProfile } from "../constants/retailDepartments";
import { parseLoyaltyAisleBonusJson, stringifyLoyaltyAisleBonus } from "../utils/loyaltyAisleBonus";
import { normalizePluDigits, setStoredPluDigits } from "../utils/pluBarcode";
import SearchSelect from "../components/SearchSelect";
import {
  getPrintBridgeUrl,
  setPrintBridgeUrl,
  kickCashDrawer,
  printTestReceipt,
  getAutoPrintReceipt,
  setAutoPrintReceipt,
} from "../utils/printBridge";
import { getTouchMode, setTouchMode } from "../utils/touchMode";
import { formatBDT } from "../utils/currency";

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
  const { hasPermission } = usePermissions();
  const canManageBranch = hasPermission("branch.manage");

  const requireBranchManage = () => {
    if (canManageBranch) return true;
    notifyPermissionRequired(tt("permNeedCode", { code: "branch.manage" }));
    return false;
  };

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
    businessProfile: "MIXED",
    costingMethod: "WEIGHTED_AVG",
    scalePluDigits: 5,
  });
  const [activeScalePluDigits, setActiveScalePluDigits] = useState(5);
  const [savingScalePlu, setSavingScalePlu] = useState(false);
  const [loyaltyAisleBonus, setLoyaltyAisleBonus] = useState({});
  const [loyaltyPointsExpiryDays, setLoyaltyPointsExpiryDays] = useState("");
  const [savingLoyaltyBonus, setSavingLoyaltyBonus] = useState(false);
  const [editingBranchId, setEditingBranchId] = useState(null);
  const [settingsTab, setSettingsTab] = useState("general");
  const [submittingBranch, setSubmittingBranch] = useState(false);
  const [featureReadiness, setFeatureReadiness] = useState({
    loading: false,
    error: "",
    data: null,
  });

  const loadBranches = async () => {
    const res = await api.get("/branches");
    setBranches(res.data);
  };

  const loadFeatureReadiness = async () => {
    setFeatureReadiness((p) => ({ ...p, loading: true, error: "" }));
    try {
      const res = await api.get("/master/feature-readiness");
      setFeatureReadiness({ loading: false, error: "", data: res.data || null });
    } catch (err) {
      setFeatureReadiness({
        loading: false,
        error: err?.response?.data?.error || tt("settingsFeatureReadinessLoadFailed"),
        data: null,
      });
    }
  };

  useEffect(() => {
    loadBranches();
    loadFeatureReadiness();
    loadSubscription();
    loadFcommerceConfig();
  }, []);

  const loadFcommerceConfig = async () => {
    try {
      const res = await api.get("/fcommerce/config", { skipGlobalErrorToast: true });
      const cfg = res.data?.config || {};
      setFcommerceMeta({ provider: res.data?.provider, live: res.data?.live, webhookUrl: res.data?.webhookUrl });
      setFcommerceForm((prev) => ({
        ...prev,
        enabled: cfg.enabled !== false,
        autoReplyEnabled: cfg.autoReplyEnabled !== false,
        smsFallback: cfg.smsFallback !== false,
        metaVerifyToken: "",
        metaAccessToken: "",
        whatsappPhoneNumberId: cfg.whatsappPhoneNumberId || "",
        messengerPageId: cfg.messengerPageId || "",
      }));
    } catch {
      setFcommerceMeta(null);
    }
  };

  const saveFcommerceConfig = async () => {
    if (!requireBranchManage()) return;
    setSavingFcommerce(true);
    try {
      const payload = {
        enabled: fcommerceForm.enabled,
        autoReplyEnabled: fcommerceForm.autoReplyEnabled,
        smsFallback: fcommerceForm.smsFallback,
        whatsappPhoneNumberId: fcommerceForm.whatsappPhoneNumberId.trim(),
        messengerPageId: fcommerceForm.messengerPageId.trim(),
      };
      if (fcommerceForm.metaVerifyToken.trim()) payload.metaVerifyToken = fcommerceForm.metaVerifyToken.trim();
      if (fcommerceForm.metaAccessToken.trim()) payload.metaAccessToken = fcommerceForm.metaAccessToken.trim();
      await api.put("/fcommerce/config", { config: payload });
      await loadFcommerceConfig();
      notifySuccess(tt("settingsFcommerceSaved"));
    } catch (err) {
      notifyActionRequired(err?.response?.data?.error || tt("settingsFcommerceSaveFailed"));
    } finally {
      setSavingFcommerce(false);
    }
  };

  const loadSubscription = async () => {
    if (!canManageBranch) return;
    setLoadingSubscription(true);
    try {
      const res = await api.get("/billing/subscription");
      setSubscriptionInfo(res.data || null);
    } catch {
      setSubscriptionInfo(null);
    } finally {
      setLoadingSubscription(false);
    }
  };

  const upgradePlan = async (planCode) => {
    if (!requireBranchManage()) return;
    const liveBilling = String(subscriptionInfo?.billingProvider || "log").toLowerCase() === "bkash";
    if (liveBilling) {
      setBillingBusy(true);
      try {
        const res = await api.post("/billing/subscription/checkout", { planCode });
        setBillingCheckout(res.data || null);
        setBillingTrxId("");
        if (res.data?.paymentUrl) {
          window.open(res.data.paymentUrl, "_blank", "noopener,noreferrer");
        }
        notifySuccess(tt("settingsBillingCheckoutStarted"));
      } catch (err) {
        notifyActionRequired(err?.response?.data?.error || tt("settingsBillingUpgradeFailed"));
      } finally {
        setBillingBusy(false);
      }
      return;
    }
    try {
      const res = await api.post("/billing/subscription/upgrade", { planCode });
      setSubscriptionInfo(res.data || null);
      notifySuccess(tt("settingsBillingUpgraded", { plan: planCode }));
    } catch (err) {
      notifyActionRequired(err?.response?.data?.error || tt("settingsBillingUpgradeFailed"));
    }
  };

  const completeBillingCheckout = async () => {
    if (!billingCheckout?.checkoutId) return;
    setBillingBusy(true);
    try {
      const res = await api.post("/billing/subscription/complete", {
        checkoutId: billingCheckout.checkoutId,
        paymentId: billingCheckout.paymentId,
        trxId: billingTrxId.trim(),
      });
      setSubscriptionInfo({
        organization: res.data?.organization,
        evaluation: res.data?.evaluation,
        billingProvider: subscriptionInfo?.billingProvider || "bkash",
      });
      setBillingCheckout(null);
      setBillingTrxId("");
      notifySuccess(tt("settingsBillingUpgraded", { plan: res.data?.organization?.planCode || "" }));
    } catch (err) {
      notifyActionRequired(err?.response?.data?.error || tt("settingsBillingUpgradeFailed"));
    } finally {
      setBillingBusy(false);
    }
  };

  const saveScaleOpsSettings = async () => {
    if (!requireBranchManage()) return;
    const active = branches.find((b) => String(b.id) === String(branchId));
    if (!active) return;
    setSavingScaleOps(true);
    try {
      await api.put(`/branches/${active.id}`, {
        code: active.code,
        name: active.name,
        address: active.address,
        phone: active.phone,
        isActive: active.isActive,
        sellerBin: active.sellerBin,
        tradeLicenseNo: active.tradeLicenseNo,
        vatRegistrationLabel: active.vatRegistrationLabel,
        businessProfile: active.businessProfile,
        costingMethod: active.costingMethod,
        scalePluDigits: active.scalePluDigits,
        ownerPhone: ownerPhone.trim() || null,
        digestEnabled,
        digestHour: Number(digestHour) || 21,
        courierProvider: courierProvider || null,
        courierStoreId: courierStoreId.trim() || null,
      });
      await loadBranches();
      notifySuccess(tt("settingsScaleOpsSaved"));
    } catch (err) {
      notifyActionRequired(err?.response?.data?.error || tt("settingsScaleOpsSaveFailed"));
    } finally {
      setSavingScaleOps(false);
    }
  };

  const sendDigestNow = async () => {
    if (!requireBranchManage()) return;
    setSendingDigest(true);
    try {
      const res = await api.post("/reports/owner-digest/send");
      notifySuccess(tt("settingsDigestSent", { status: res.data?.result?.status || "sent" }));
    } catch (err) {
      notifyActionRequired(err?.response?.data?.error || tt("settingsDigestSendFailed"));
    } finally {
      setSendingDigest(false);
    }
  };

  useEffect(() => {
    const active = branches.find((b) => String(b.id) === String(branchId));
    const digits = normalizePluDigits(active?.scalePluDigits ?? 5);
    setActiveScalePluDigits(digits);
    setStoredPluDigits(digits);
    setLoyaltyAisleBonus(parseLoyaltyAisleBonusJson(active?.loyaltyAisleBonusJson));
    setLoyaltyPointsExpiryDays(
      active?.loyaltyPointsExpiryDays != null && active.loyaltyPointsExpiryDays !== ""
        ? String(active.loyaltyPointsExpiryDays)
        : ""
    );
    setOwnerPhone(active?.ownerPhone || "");
    setDigestEnabled(Boolean(active?.digestEnabled));
    setDigestHour(Number(active?.digestHour ?? 21));
    setCourierProvider(active?.courierProvider || "log");
    setCourierStoreId(active?.courierStoreId || "");
    setStorefrontToken(active?.storefrontToken || "");
  }, [branches, branchId]);

  const generateStorefrontToken = async () => {
    if (!requireBranchManage()) return;
    setGeneratingStorefront(true);
    try {
      const res = await api.post("/restaurant/storefront-token");
      const token = res.data?.storefrontToken || "";
      setStorefrontToken(token);
      await loadBranches();
      notifySuccess(tt("settingsStorefrontGenerated"));
    } catch (err) {
      notifyActionRequired(err?.response?.data?.error || tt("settingsStorefrontGenerateFailed"));
    } finally {
      setGeneratingStorefront(false);
    }
  };

  const copyStorefrontToken = async () => {
    if (!storefrontToken) return;
    try {
      await navigator.clipboard.writeText(storefrontToken);
      notifySuccess(tt("settingsStorefrontCopied"));
    } catch {
      notifyActionRequired(tt("settingsClipboardUnavailable"));
    }
  };

  const copyStorefrontUrl = async () => {
    if (!storefrontToken) return;
    const url = buildStorefrontUrl(storefrontToken);
    try {
      await navigator.clipboard.writeText(url);
      notifySuccess(tt("settingsStorefrontUrlCopied"));
    } catch {
      notifyActionRequired(tt("settingsClipboardUnavailable"));
    }
  };

  const openStorefrontPreview = () => {
    if (!storefrontToken) return;
    window.open(buildStorefrontUrl(storefrontToken), "_blank", "noopener,noreferrer");
  };

  const toggleTouchMode = (enabled) => {
    setTouchMode(enabled);
    setTouchModeEnabled(enabled);
  };

  const save = () => {
    localStorage.setItem("bd_pos_branch_id", branchId);
    const active = branches.find((b) => String(b.id) === String(branchId));
    if (active?.businessProfile) {
      const profile = normalizeBusinessProfile(active.businessProfile);
      localStorage.setItem("bd_pos_business_profile", profile);
    }
    if (active?.scalePluDigits != null) {
      setStoredPluDigits(active.scalePluDigits);
    }
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
    if (!requireBranchManage()) return;
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
    if (!requireBranchManage()) return;
    const payload = {
      code: branchForm.code.trim(),
      name: branchForm.name.trim(),
      address: branchForm.address || null,
      phone: branchForm.phone || null,
      isActive: branchForm.isActive,
      sellerBin: branchForm.sellerBin?.trim() || null,
      tradeLicenseNo: branchForm.tradeLicenseNo?.trim() || null,
      vatRegistrationLabel: branchForm.vatRegistrationLabel?.trim() || null,
      businessProfile: normalizeBusinessProfile(branchForm.businessProfile),
      costingMethod: branchForm.costingMethod || "WEIGHTED_AVG",
      scalePluDigits: normalizePluDigits(branchForm.scalePluDigits),
    };
    setSubmittingBranch(true);
    try {
      const wasEdit = Boolean(editingBranchId);
      const editedId = editingBranchId;
      if (editingBranchId) {
        await api.put(`/branches/${editingBranchId}`, payload);
      } else {
        await api.post("/branches", payload);
      }
      setBranchForm({
        code: "",
        name: "",
        address: "",
        phone: "",
        isActive: true,
        sellerBin: "",
        tradeLicenseNo: "",
        vatRegistrationLabel: "",
        businessProfile: "MIXED",
        costingMethod: "WEIGHTED_AVG",
        scalePluDigits: 5,
      });
      setEditingBranchId(null);
      await loadBranches();
      if (String(editedId) === String(branchId)) {
        setStoredPluDigits(branchForm.scalePluDigits);
      }
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
      businessProfile: normalizeBusinessProfile(b.businessProfile),
      costingMethod: b.costingMethod || "WEIGHTED_AVG",
      scalePluDigits: normalizePluDigits(b.scalePluDigits),
    });
  };

  const saveLoyaltyAisleBonus = async () => {
    if (!requireBranchManage()) return;
    const active = branches.find((b) => String(b.id) === String(branchId));
    if (!active) return;
    setSavingLoyaltyBonus(true);
    try {
      await api.put(`/branches/${active.id}`, {
        code: active.code,
        name: active.name,
        address: active.address,
        phone: active.phone,
        isActive: active.isActive,
        sellerBin: active.sellerBin,
        tradeLicenseNo: active.tradeLicenseNo,
        vatRegistrationLabel: active.vatRegistrationLabel,
        businessProfile: active.businessProfile,
        costingMethod: active.costingMethod,
        scalePluDigits: active.scalePluDigits,
        loyaltyAisleBonusJson: stringifyLoyaltyAisleBonus(loyaltyAisleBonus) || null,
        loyaltyPointsExpiryDays:
          loyaltyPointsExpiryDays !== "" && loyaltyPointsExpiryDays != null
            ? Number(loyaltyPointsExpiryDays)
            : null,
      });
      await loadBranches();
      notifySuccess(tt("settingsLoyaltyAisleSaved"));
    } catch (err) {
      notifyActionRequired(err?.response?.data?.error || tt("settingsLoyaltyAisleSaveFailed"));
    } finally {
      setSavingLoyaltyBonus(false);
    }
  };

  const saveActiveScalePluDigits = async () => {
    if (!requireBranchManage()) return;
    const active = branches.find((b) => String(b.id) === String(branchId));
    if (!active) return;
    setSavingScalePlu(true);
    try {
      const digits = normalizePluDigits(activeScalePluDigits);
      await api.put(`/branches/${active.id}`, {
        code: active.code,
        name: active.name,
        address: active.address,
        phone: active.phone,
        isActive: active.isActive,
        sellerBin: active.sellerBin,
        tradeLicenseNo: active.tradeLicenseNo,
        vatRegistrationLabel: active.vatRegistrationLabel,
        businessProfile: active.businessProfile,
        costingMethod: active.costingMethod,
        scalePluDigits: digits,
      });
      setStoredPluDigits(digits);
      await loadBranches();
      notifySuccess(tt("settingsScalePluSaved"));
    } catch (err) {
      notifyActionRequired(err?.response?.data?.error || tt("settingsScalePluSaveFailed"));
    } finally {
      setSavingScalePlu(false);
    }
  };

  const deleteBranch = async (row) => {
    if (!requireBranchManage()) return;
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
      setBranchForm({
        code: "",
        name: "",
        address: "",
        phone: "",
        isActive: true,
        sellerBin: "",
        tradeLicenseNo: "",
        vatRegistrationLabel: "",
        businessProfile: "MIXED",
        costingMethod: "WEIGHTED_AVG",
      });
    }
    loadBranches();
  };

  const [printBridgeUrlValue, setPrintBridgeUrlValue] = useState(() => getPrintBridgeUrl());
  const [autoPrintReceipt, setAutoPrintReceiptState] = useState(() => getAutoPrintReceipt());
  const [testingDrawer, setTestingDrawer] = useState(false);
  const [testingReceipt, setTestingReceipt] = useState(false);
  const [subscriptionInfo, setSubscriptionInfo] = useState(null);
  const [loadingSubscription, setLoadingSubscription] = useState(false);
  const [billingCheckout, setBillingCheckout] = useState(null);
  const [billingTrxId, setBillingTrxId] = useState("");
  const [billingBusy, setBillingBusy] = useState(false);
  const [ownerPhone, setOwnerPhone] = useState("");
  const [digestEnabled, setDigestEnabled] = useState(false);
  const [digestHour, setDigestHour] = useState(21);
  const [courierProvider, setCourierProvider] = useState("log");
  const [courierStoreId, setCourierStoreId] = useState("");
  const [storefrontToken, setStorefrontToken] = useState("");
  const [generatingStorefront, setGeneratingStorefront] = useState(false);
  const [fcommerceForm, setFcommerceForm] = useState({
    enabled: true,
    autoReplyEnabled: true,
    smsFallback: true,
    metaVerifyToken: "",
    metaAccessToken: "",
    whatsappPhoneNumberId: "",
    messengerPageId: "",
  });
  const [fcommerceMeta, setFcommerceMeta] = useState(null);
  const [savingFcommerce, setSavingFcommerce] = useState(false);
  const [touchModeEnabled, setTouchModeEnabled] = useState(() => getTouchMode());
  const [savingScaleOps, setSavingScaleOps] = useState(false);
  const [sendingDigest, setSendingDigest] = useState(false);

  const savePrintBridge = () => {
    setPrintBridgeUrl(printBridgeUrlValue);
    notifySuccess(tt("settingsPrintBridgeSaved"));
  };

  const testDrawerKick = async () => {
    setPrintBridgeUrl(printBridgeUrlValue);
    setTestingDrawer(true);
    try {
      const ok = await kickCashDrawer();
      if (ok) notifySuccess(tt("settingsPrintBridgeTestOk"));
      else notifyActionRequired(tt("settingsPrintBridgeTestFail"));
    } finally {
      setTestingDrawer(false);
    }
  };

  const receiptLabels = useMemo(() => {
    let receiptLang = uiLang;
    try {
      const raw = localStorage.getItem("bd-pos-store-settings");
      if (raw) receiptLang = JSON.parse(raw).receiptLanguage === "bn" ? "bn" : "en";
    } catch {
      /* ignore */
    }
    const L = (key) => t(receiptLang, key);
    return {
      invoice: L("receiptInvoice"),
      date: L("receiptDate"),
      payment: L("receiptPayment"),
      customer: L("receiptCustomer"),
      walkInCustomer: L("receiptWalkIn"),
      subTotal: L("receiptSubTotal"),
      vat: L("receiptVat"),
      discount: L("receiptDiscount"),
      total: L("receiptTotal"),
      paid: L("receiptPaid"),
      due: L("receiptDue"),
    };
  }, [uiLang]);

  const testReceiptPrint = async () => {
    setPrintBridgeUrl(printBridgeUrlValue);
    setTestingReceipt(true);
    try {
      const mode = await printTestReceipt({
        labels: receiptLabels,
        formatMoney: (n) => formatBDT(n, { lang: uiLang, decimals: 2 }),
      });
      if (mode === "failed") notifyActionRequired(tt("settingsPrintBridgeTestReceiptFail"));
      else if (mode === "bridge") notifySuccess(tt("settingsPrintBridgeTestReceiptOkBridge"));
      else notifySuccess(tt("settingsPrintBridgeTestReceiptOkBrowser"));
    } finally {
      setTestingReceipt(false);
    }
  };

  const toggleAutoPrintReceipt = (enabled) => {
    setAutoPrintReceiptState(enabled);
    setAutoPrintReceipt(enabled);
    notifySuccess(enabled ? tt("settingsAutoPrintOn") : tt("settingsAutoPrintOff"));
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
    <div className="page-stack settings-page">
      <div className="page-header">
        <div>
          <div className="page-title">{tt("settingsTitle")}</div>
          <div className="page-subtitle">{tt("settingsSubtitle")}</div>
        </div>
      </div>
      <PermissionBanner show={!canManageBranch} code="branch.manage" tt={tt} messageKey="permBannerManage" />
      <div className="pos-tabs settings-tabs-sticky">
        <div className="pos-tablist settings-tablist" role="tablist" aria-label={tt("settingsTabsAria")}>
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
        <h4 style={{ marginTop: 0 }}>{tt("settingsScalePluDigits")}</h4>
        <p className="text-muted" style={{ marginTop: 0, fontSize: 13 }}>
          {tt("settingsScalePluDigitsHelp")}
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 10 }}>
          <SearchSelect
            className="form-select-sm"
            value={String(activeScalePluDigits)}
            onChange={(val) => setActiveScalePluDigits(Number(val || activeScalePluDigits))}
            options={[4, 5, 6, 7].map((n) => ({ value: String(n), label: String(n) }))}
            isClearable={false}
          />
          <button type="button" className="btn-secondary btn-sm" onClick={saveActiveScalePluDigits} disabled={savingScalePlu || !canManageBranch}>
            {savingScalePlu ? tt("settingsSaving") : tt("settingsSaveScalePlu")}
          </button>
        </div>
      </div>
      <div className="page-card" style={{ marginTop: 16 }}>
        <h4 style={{ marginTop: 0 }}>{tt("settingsLoyaltyExpiryTitle")}</h4>
        <p className="text-muted" style={{ marginTop: 0, fontSize: 13 }}>
          {tt("settingsLoyaltyExpiryHelp")}
        </p>
        <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, marginTop: 10 }}>
          <span style={{ minWidth: 160 }}>{tt("settingsLoyaltyExpiryDays")}</span>
          <input
            type="number"
            min={0}
            max={1095}
            placeholder={tt("settingsLoyaltyExpiryPlaceholder")}
            value={loyaltyPointsExpiryDays}
            onChange={(e) => setLoyaltyPointsExpiryDays(e.target.value)}
            style={{ width: 100 }}
          />
        </label>
      </div>
      <div className="page-card" style={{ marginTop: 16 }}>
        <h4 style={{ marginTop: 0 }}>{tt("settingsLoyaltyAisleTitle")}</h4>
        <p className="text-muted" style={{ marginTop: 0, fontSize: 13 }}>
          {tt("settingsLoyaltyAisleHelp")}
        </p>
        <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
          {GROCERY_CATEGORY_CHIPS.map((cat) => (
            <label key={cat.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
              <span style={{ minWidth: 120 }}>{tt(cat.labelKey)}</span>
              <SearchSelect
                className="form-select-sm"
                value={String(loyaltyAisleBonus[cat.id] || "")}
                onChange={(val) => {
                  setLoyaltyAisleBonus((prev) => {
                    const next = { ...prev };
                    if (!val || Number(val) <= 1) delete next[cat.id];
                    else next[cat.id] = Number(val);
                    return next;
                  });
                }}
                placeholder={tt("settingsLoyaltyMultDefault")}
                options={[
                  { value: "1.5", label: "1.5×" },
                  { value: "2", label: "2×" },
                  { value: "3", label: "3×" },
                ]}
              />
            </label>
          ))}
        </div>
        <button
          type="button"
          className="btn-secondary btn-sm"
          style={{ marginTop: 10 }}
          onClick={saveLoyaltyAisleBonus}
          disabled={savingLoyaltyBonus}
        >
          {savingLoyaltyBonus ? tt("settingsSaving") : tt("settingsLoyaltyAisleSave")}
        </button>
      </div>
      <div className="page-card" style={{ marginTop: 16 }}>
        <h4 style={{ marginTop: 0 }}>{tt("settingsRetailStoreTitle")}</h4>
        <p className="text-muted" style={{ marginTop: 0, fontSize: 13 }}>
          {tt("settingsRetailStoreHelp")}
        </p>
        <p style={{ margin: "8px 0 0", fontSize: 13 }}>
          <strong>{tt("settingsRetailProfileLabel")}:</strong>{" "}
          {tt(
            BUSINESS_PROFILE_OPTIONS.find(
              (o) => o.value === normalizeBusinessProfile(
                branches.find((b) => String(b.id) === String(branchId))?.businessProfile
              )
            )?.labelKey || "retailProfileMixed"
          )}
        </p>
      </div>
      <div className="page-card" style={{ marginTop: 16 }}>
        <h4 style={{ marginTop: 0 }}>{tt("settingsPrintBridgeTitle")}</h4>
        <p className="text-muted" style={{ marginTop: 0, fontSize: 12 }}>
          {tt("settingsPrintBridgeHelp")}
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input
            placeholder={tt("settingsPrintBridgePlaceholder")}
            value={printBridgeUrlValue}
            onChange={(e) => setPrintBridgeUrlValue(e.target.value)}
            style={{ flex: 1, minWidth: 260 }}
          />
          <button type="button" className="btn-secondary btn-sm" onClick={savePrintBridge}>
            {tt("settingsPrintBridgeSave")}
          </button>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={testDrawerKick}
            disabled={testingDrawer || !printBridgeUrlValue.trim()}
          >
            {testingDrawer ? "…" : tt("settingsPrintBridgeTest")}
          </button>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={testReceiptPrint}
            disabled={testingReceipt}
          >
            {testingReceipt ? "…" : tt("settingsPrintBridgeTestReceipt")}
          </button>
        </div>
        <label
          style={{ display: "flex", alignItems: "flex-start", gap: 10, marginTop: 12, fontSize: 13, cursor: "pointer" }}
        >
          <input
            type="checkbox"
            checked={autoPrintReceipt}
            onChange={(e) => toggleAutoPrintReceipt(e.target.checked)}
            style={{ marginTop: 2 }}
          />
          <span>
            <strong>{tt("settingsAutoPrintReceipt")}</strong>
            <span className="text-muted" style={{ display: "block", marginTop: 4, fontSize: 12 }}>
              {tt("settingsAutoPrintReceiptHelp")}
            </span>
          </span>
        </label>
      </div>
      <div className="page-card" style={{ marginTop: 16 }}>
        <h4 style={{ marginTop: 0 }}>{tt("settingsBillingTitle")}</h4>
        <p className="text-muted" style={{ marginTop: 0, fontSize: 12 }}>
          {tt("settingsBillingHelp")}
        </p>
        {loadingSubscription ? (
          <p className="text-muted">{tt("settingsLoading")}</p>
        ) : subscriptionInfo?.organization ? (
          <div style={{ fontSize: 13, display: "grid", gap: 6 }}>
            <div>
              <strong>{tt("settingsBillingPlan")}:</strong> {subscriptionInfo.organization.planCode}{" "}
              ({subscriptionInfo.evaluation?.status || subscriptionInfo.organization.subscriptionStatus})
            </div>
            {subscriptionInfo.organization.trialEndsAt ? (
              <div>
                {tt("settingsBillingTrialEnds")}: {new Date(subscriptionInfo.organization.trialEndsAt).toLocaleDateString()}
              </div>
            ) : null}
            {subscriptionInfo.organization.currentPeriodEnd ? (
              <div>
                {tt("settingsBillingPeriodEnds")}:{" "}
                {new Date(subscriptionInfo.organization.currentPeriodEnd).toLocaleDateString()}
              </div>
            ) : null}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
              <button type="button" className="btn-secondary btn-sm" disabled={!canManageBranch || billingBusy} onClick={() => upgradePlan("starter")}>
                {tt("settingsBillingStarter")}
              </button>
              <button type="button" className="btn-secondary btn-sm" disabled={!canManageBranch || billingBusy} onClick={() => upgradePlan("pro")}>
                {tt("settingsBillingPro")}
              </button>
            </div>
            {subscriptionInfo?.billingProvider === "bkash" ? (
              <p className="text-muted" style={{ fontSize: 12, margin: "8px 0 0" }}>
                {tt("settingsBillingLiveHelp")}
              </p>
            ) : null}
            {billingCheckout ? (
              <div className="storefront-mfs-panel" style={{ marginTop: 10 }}>
                <div>{tt("settingsBillingAwaitingPayment", { amount: billingCheckout.amount, plan: billingCheckout.planCode })}</div>
                {billingCheckout.qrPayload ? (
                  <QrCodeImage value={billingCheckout.qrPayload} size={140} alt={tt("settingsBillingQrAlt")} />
                ) : null}
                {billingCheckout.paymentUrl ? (
                  <a href={billingCheckout.paymentUrl} target="_blank" rel="noopener noreferrer">
                    {tt("settingsBillingOpenBkash")}
                  </a>
                ) : null}
                <div className="storefront-mfs-trx">
                  <input
                    placeholder={tt("storefrontPhTrxId")}
                    value={billingTrxId}
                    onChange={(e) => setBillingTrxId(e.target.value)}
                  />
                  <button type="button" className="btn-primary btn-sm" disabled={billingBusy} onClick={completeBillingCheckout}>
                    {tt("settingsBillingConfirmPayment")}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-muted">{tt("settingsBillingUnavailable")}</p>
        )}
      </div>
      <div className="page-card" style={{ marginTop: 16 }}>
        <h4 style={{ marginTop: 0 }}>{tt("settingsOwnerDigestTitle")}</h4>
        <p className="text-muted" style={{ marginTop: 0, fontSize: 12 }}>
          {tt("settingsOwnerDigestHelp")}
        </p>
        <div style={{ display: "grid", gap: 8, maxWidth: 420 }}>
          <input
            placeholder={tt("settingsOwnerPhonePh")}
            value={ownerPhone}
            onChange={(e) => setOwnerPhone(e.target.value)}
          />
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={digestEnabled} onChange={(e) => setDigestEnabled(e.target.checked)} />
            {tt("settingsDigestEnabled")}
          </label>
          <label style={{ fontSize: 13 }}>
            {tt("settingsDigestHour")}{" "}
            <input
              type="number"
              min={0}
              max={23}
              value={digestHour}
              onChange={(e) => setDigestHour(e.target.value)}
              style={{ width: 64, marginLeft: 8 }}
            />
          </label>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          <button type="button" className="btn-secondary btn-sm" disabled={savingScaleOps || !canManageBranch} onClick={saveScaleOpsSettings}>
            {savingScaleOps ? "…" : tt("settingsScaleOpsSave")}
          </button>
          <button type="button" className="btn-secondary btn-sm" disabled={sendingDigest || !canManageBranch} onClick={sendDigestNow}>
            {sendingDigest ? "…" : tt("settingsDigestSendNow")}
          </button>
        </div>
      </div>
      <div className="page-card" style={{ marginTop: 16 }}>
        <h4 style={{ marginTop: 0 }}>{tt("settingsCourierTitle")}</h4>
        <p className="text-muted" style={{ marginTop: 0, fontSize: 12 }}>
          {tt("settingsCourierHelp")}
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <SearchSelect
            className="form-select-sm"
            value={courierProvider}
            onChange={(val) => setCourierProvider(val || "log")}
            options={[
              { value: "log", label: tt("settingsCourierManual") },
              { value: "pathao", label: "Pathao" },
              { value: "redx", label: "RedX" },
              { value: "steadfast", label: "Steadfast" },
              { value: "paperfly", label: "Paperfly" },
            ]}
            isClearable={false}
          />
          <input
            placeholder={tt("settingsCourierStoreIdPh")}
            value={courierStoreId}
            onChange={(e) => setCourierStoreId(e.target.value)}
            style={{ flex: 1, minWidth: 180 }}
          />
        </div>
      </div>
      <div className="page-card" style={{ marginTop: 16 }}>
        <h4 style={{ marginTop: 0 }}>{tt("settingsStorefrontTitle")}</h4>
        <p className="text-muted" style={{ marginTop: 0, fontSize: 12 }}>
          {tt("settingsStorefrontHelp")}
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input
            readOnly
            placeholder={tt("settingsStorefrontTokenPh")}
            value={storefrontToken ? `${storefrontToken.slice(0, 8)}…${storefrontToken.slice(-6)}` : ""}
            style={{ flex: 1, minWidth: 220 }}
          />
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={generatingStorefront || !canManageBranch}
            onClick={generateStorefrontToken}
          >
            {generatingStorefront ? "…" : tt("settingsStorefrontGenerate")}
          </button>
          {storefrontToken ? (
            <>
              <button type="button" className="btn-secondary btn-sm" onClick={copyStorefrontToken}>
                {tt("settingsCopyToken")}
              </button>
              <button type="button" className="btn-secondary btn-sm" onClick={copyStorefrontUrl}>
                {tt("settingsCopyStoreUrl")}
              </button>
              <button type="button" className="btn-secondary btn-sm" onClick={openStorefrontPreview}>
                {tt("settingsOpenStorefront")}
              </button>
            </>
          ) : null}
        </div>
        {storefrontToken ? (
          <div className="storefront-settings-qr" style={{ marginTop: 16 }}>
            <div>
              <div className="text-muted" style={{ fontSize: 12, marginBottom: 8 }}>
                {tt("settingsStorefrontQrHelp")}
              </div>
              <QrCodeImage
                value={buildStorefrontUrl(storefrontToken)}
                size={180}
                alt={tt("settingsStorefrontQrAlt")}
              />
            </div>
            <div style={{ fontSize: 12, maxWidth: 320 }}>
              <code style={{ wordBreak: "break-all" }}>{buildStorefrontUrl(storefrontToken)}</code>
            </div>
          </div>
        ) : null}
      </div>
      <div className="page-card" style={{ marginTop: 16 }}>
        <h4 style={{ marginTop: 0 }}>{tt("settingsFcommerceTitle")}</h4>
        <p className="text-muted" style={{ marginTop: 0, fontSize: 12 }}>
          {tt("settingsFcommerceHelp")}
        </p>
        {fcommerceMeta ? (
          <p className="text-muted" style={{ fontSize: 12 }}>
            {tt("settingsFcommerceMode", { mode: fcommerceMeta.live ? tt("settingsModeLive") : tt("settingsModeSimulated") })}
            {" · "}
            {tt("settingsFcommerceWebhook")}: <code>{fcommerceMeta.webhookUrl}</code>
          </p>
        ) : null}
        <div className="form-grid" style={{ maxWidth: 720 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={fcommerceForm.enabled}
              onChange={(e) => setFcommerceForm({ ...fcommerceForm, enabled: e.target.checked })}
              disabled={!canManageBranch}
            />
            {tt("settingsFcommerceEnabled")}
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={fcommerceForm.autoReplyEnabled}
              onChange={(e) => setFcommerceForm({ ...fcommerceForm, autoReplyEnabled: e.target.checked })}
              disabled={!canManageBranch}
            />
            {tt("settingsFcommerceAutoReply")}
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={fcommerceForm.smsFallback}
              onChange={(e) => setFcommerceForm({ ...fcommerceForm, smsFallback: e.target.checked })}
              disabled={!canManageBranch}
            />
            {tt("settingsFcommerceSmsFallback")}
          </label>
          <label>
            {tt("settingsFcommerceVerifyToken")}
            <input
              type="password"
              placeholder="Meta hub.verify_token"
              value={fcommerceForm.metaVerifyToken}
              onChange={(e) => setFcommerceForm({ ...fcommerceForm, metaVerifyToken: e.target.value })}
              disabled={!canManageBranch}
            />
          </label>
          <label>
            {tt("settingsFcommerceAccessToken")}
            <input
              type="password"
              placeholder="Meta Graph access token"
              value={fcommerceForm.metaAccessToken}
              onChange={(e) => setFcommerceForm({ ...fcommerceForm, metaAccessToken: e.target.value })}
              disabled={!canManageBranch}
            />
          </label>
          <label>
            {tt("settingsFcommerceWhatsAppPhoneId")}
            <input
              value={fcommerceForm.whatsappPhoneNumberId}
              onChange={(e) => setFcommerceForm({ ...fcommerceForm, whatsappPhoneNumberId: e.target.value })}
              disabled={!canManageBranch}
            />
          </label>
          <label>
            {tt("settingsFcommerceMessengerPageId")}
            <input
              value={fcommerceForm.messengerPageId}
              onChange={(e) => setFcommerceForm({ ...fcommerceForm, messengerPageId: e.target.value })}
              disabled={!canManageBranch}
            />
          </label>
        </div>
        <div style={{ marginTop: 10 }}>
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={savingFcommerce || !canManageBranch}
            onClick={saveFcommerceConfig}
          >
            {savingFcommerce ? "…" : tt("settingsFcommerceSave")}
          </button>
        </div>
      </div>
      <div className="page-card" style={{ marginTop: 16 }}>
        <h4 style={{ marginTop: 0 }}>{tt("settingsTouchModeTitle")}</h4>
        <p className="text-muted" style={{ marginTop: 0, fontSize: 12 }}>
          {tt("settingsTouchModeHelp")}
        </p>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={touchModeEnabled}
            onChange={(e) => toggleTouchMode(e.target.checked)}
          />
          {tt("settingsTouchModeEnabled")}
        </label>
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
      <div className="page-card" style={{ marginTop: 16 }}>
        <h4 style={{ marginTop: 0 }}>{tt("settingsFeatureReadinessTitle")}</h4>
        <p className="text-muted" style={{ marginTop: 0, fontSize: 12 }}>
          {tt("settingsFeatureReadinessHelp")}
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span
            className="badge"
            style={{
              background: featureReadiness.data?.ok ? "#dcfce7" : "#fef3c7",
              color: featureReadiness.data?.ok ? "#166534" : "#92400e",
              border: "1px solid " + (featureReadiness.data?.ok ? "#86efac" : "#fcd34d"),
            }}
          >
            {featureReadiness.data?.ok ? tt("settingsFeatureReady") : tt("settingsFeaturePartial")}
          </span>
          <button type="button" className="btn-secondary btn-sm" onClick={loadFeatureReadiness} disabled={featureReadiness.loading}>
            {featureReadiness.loading ? tt("settingsLoading") : tt("settingsRefreshReadiness")}
          </button>
        </div>
        {featureReadiness.error ? (
          <p style={{ color: "#b42318", margin: 0 }}>{featureReadiness.error}</p>
        ) : null}
        {featureReadiness.data ? (
          <ul style={{ margin: "8px 0 0 18px", padding: 0 }}>
            <li>
              {tt("settingsProductColumnsReady")}:{" "}
              {featureReadiness.data?.productMaster?.productColumnsReady ? tt("settingsYes") : tt("settingsNo")}
            </li>
            <li>
              {tt("settingsBarcodeAliasTableReady")}:{" "}
              {featureReadiness.data?.productMaster?.productBarcodeAliasTableReady ? tt("settingsYes") : tt("settingsNo")}
            </li>
            {Array.isArray(featureReadiness.data?.productMaster?.missingProductColumns) &&
            featureReadiness.data.productMaster.missingProductColumns.length > 0 ? (
              <li>
                {tt("settingsMissingColumns")}:{" "}
                {featureReadiness.data.productMaster.missingProductColumns.join(", ")}
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>
      <div className="page-card" style={{ marginTop: 16 }}>
        <h4 style={{ marginTop: 0 }}>{tt("settingsIntegrationsTitle")}</h4>
        <p className="text-muted" style={{ marginTop: 0, fontSize: 12 }}>
          {tt("settingsIntegrationsHelp")}
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <button type="button" className="btn-secondary btn-sm" onClick={loadFeatureReadiness} disabled={featureReadiness.loading}>
            {featureReadiness.loading ? tt("settingsLoading") : tt("settingsRefreshReadiness")}
          </button>
        </div>
        {featureReadiness.error ? (
          <p style={{ color: "#b42318", margin: 0 }}>{featureReadiness.error}</p>
        ) : null}
        {featureReadiness.data?.integrations ? (
          <div style={{ display: "grid", gap: 12, marginTop: 8 }}>
            {(() => {
              const intg = featureReadiness.data.integrations;
              const modeBadge = (mode) => {
                const isLive = mode === "live";
                return (
                  <span
                    className="badge"
                    style={{
                      background: isLive ? "#dcfce7" : "#f1f5f9",
                      color: isLive ? "#166534" : "#475569",
                      border: "1px solid " + (isLive ? "#86efac" : "#cbd5e1"),
                      fontSize: 11,
                    }}
                  >
                    {isLive ? tt("settingsIntModeLive") : tt("settingsIntModeSimulated")}
                  </span>
                );
              };
              const yesNo = (ok) => (ok ? tt("settingsYes") : tt("settingsNo"));
              return (
                <>
                  <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <strong>{tt("settingsIntSms")}</strong>
                      {modeBadge(intg.sms?.mode)}
                    </div>
                    <p style={{ margin: "6px 0 0", fontSize: 13, color: "#475569" }}>
                      {tt("settingsIntProvider")}: {intg.sms?.provider || "—"}
                      {intg.sms?.senderId ? ` · ${intg.sms.senderId}` : ""}
                    </p>
                  </div>
                  <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <strong>{tt("settingsIntMfs")}</strong>
                      {modeBadge(intg.mfs?.bkashLive || intg.mfs?.nagadLive ? "live" : "simulated")}
                    </div>
                    <ul style={{ margin: "8px 0 0 18px", padding: 0, fontSize: 13, color: "#475569" }}>
                      <li>
                        {tt("settingsIntProvider")}: {intg.mfs?.defaultProvider || "—"}
                        {intg.mfs?.bkashProvider ? ` (${intg.mfs.bkashProvider})` : ""}
                      </li>
                      <li>
                        {tt("settingsIntBkashLive")}: {yesNo(intg.mfs?.bkashLive)}
                        {intg.mfs?.bkashMerchantNumber ? ` · ${tt("settingsIntMerchant")}: ${intg.mfs.bkashMerchantNumber}` : ""}
                      </li>
                      <li>
                        {tt("settingsIntNagadLive")}: {yesNo(intg.mfs?.nagadLive)}
                        {intg.mfs?.nagadMerchantNumber ? ` · ${tt("settingsIntMerchant")}: ${intg.mfs.nagadMerchantNumber}` : ""}
                      </li>
                      {intg.mfs?.rocketMerchantNumber ? (
                        <li>Rocket · {tt("settingsIntMerchant")}: {intg.mfs.rocketMerchantNumber}</li>
                      ) : null}
                      {intg.mfs?.upayMerchantNumber ? (
                        <li>Upay · {tt("settingsIntMerchant")}: {intg.mfs.upayMerchantNumber}</li>
                      ) : null}
                    </ul>
                  </div>
                  <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <strong>{tt("settingsIntEfd")}</strong>
                      {modeBadge(intg.efd?.mode)}
                    </div>
                    <ul style={{ margin: "8px 0 0 18px", padding: 0, fontSize: 13, color: "#475569" }}>
                      <li>
                        {tt("settingsIntProvider")}: {intg.efd?.provider || "—"}
                      </li>
                      {intg.efd?.deviceId ? (
                        <li>
                          {tt("settingsIntDeviceId")}: {intg.efd.deviceId}
                        </li>
                      ) : null}
                      <li>
                        {tt("settingsIntGenexUrl")}: {yesNo(intg.efd?.genexUrlConfigured)}
                      </li>
                    </ul>
                  </div>
                  <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <strong>{tt("settingsIntPwa")}</strong>
                      <span
                        className="badge"
                        style={{
                          background: "#dbeafe",
                          color: "#1e40af",
                          border: "1px solid #93c5fd",
                          fontSize: 11,
                        }}
                      >
                        {tt("settingsIntModeLive")}
                      </span>
                    </div>
                    <ul style={{ margin: "8px 0 0 18px", padding: 0, fontSize: 13, color: "#475569" }}>
                      <li>Service worker: {yesNo(intg.pwa?.serviceWorker)}</li>
                      <li>IndexedDB catalog: {yesNo(intg.pwa?.indexedDbCatalog)}</li>
                      <li>Offline sale queue: {yesNo(intg.pwa?.offlineSaleQueue)}</li>
                    </ul>
                  </div>
                </>
              );
            })()}
          </div>
        ) : featureReadiness.loading ? (
          <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>{tt("settingsLoading")}</p>
        ) : (
          <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>{tt("settingsFeatureReadinessHelp")}</p>
        )}
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
        <button type="submit" disabled={!canManageBranch}>{tt("settingsUpdateMgrPin")}</button>
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
        <SearchSelect
          className="form-select-sm"
          value={branchForm.businessProfile}
          onChange={(val) => setBranchForm({ ...branchForm, businessProfile: val })}
          options={BUSINESS_PROFILE_OPTIONS.map((opt) => ({
            value: opt.value,
            label: tt(opt.labelKey),
          }))}
          isClearable={false}
          aria-label={tt("settingsBusinessProfileHelp")}
        />
        <SearchSelect
          className="form-select-sm"
          value={branchForm.costingMethod || "WEIGHTED_AVG"}
          onChange={(val) => setBranchForm({ ...branchForm, costingMethod: val || "WEIGHTED_AVG" })}
          options={[
            { value: "WEIGHTED_AVG", label: tt("settingsCostingWeightedAvg") },
            { value: "LAST_LANDED", label: tt("settingsCostingLastLanded") },
          ]}
          isClearable={false}
          aria-label={tt("settingsCostingMethodHelp")}
        />
        <SearchSelect
          className="form-select-sm"
          value={String(branchForm.scalePluDigits ?? 5)}
          onChange={(val) => setBranchForm({ ...branchForm, scalePluDigits: Number(val || 5) })}
          options={[4, 5, 6, 7].map((n) => ({
            value: String(n),
            label: `${tt("settingsScalePluDigits")}: ${n}`,
          }))}
          isClearable={false}
          aria-label={tt("settingsScalePluDigitsHelp")}
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
        <SubmitButton loading={submittingBranch} loadingLabel={editingBranchId ? tt("settingsUpdating") : tt("settingsSaving")} disabled={!canManageBranch}>
          {editingBranchId ? tt("settingsUpdateBranch") : tt("settingsAddBranch")}
        </SubmitButton>
        {editingBranchId ? (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setEditingBranchId(null);
              setBranchForm({
        code: "",
        name: "",
        address: "",
        phone: "",
        isActive: true,
        sellerBin: "",
        tradeLicenseNo: "",
        vatRegistrationLabel: "",
        businessProfile: "MIXED",
        costingMethod: "WEIGHTED_AVG",
        scalePluDigits: 5,
      });
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
          {
            key: "businessProfile",
            label: tt("settingsRetailProfileLabel"),
            render: (v) => {
              const profile = normalizeBusinessProfile(v);
              const opt = BUSINESS_PROFILE_OPTIONS.find((o) => o.value === profile);
              return opt ? tt(opt.labelKey) : tt("retailProfileMixed");
            },
          },
          {
            key: "costingMethod",
            label: tt("settingsCostingMethodLabel"),
            render: (v) =>
              String(v || "WEIGHTED_AVG") === "LAST_LANDED"
                ? tt("settingsCostingLastLanded")
                : tt("settingsCostingWeightedAvg"),
          },
          {
            key: "scalePluDigits",
            label: tt("settingsScalePluDigits"),
            render: (v) => normalizePluDigits(v),
          },
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
