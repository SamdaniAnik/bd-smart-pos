import { useEffect, useRef, useState } from "react";
import api from "../services/api";
import socket from "../services/socket";
import DataTable from "../components/DataTable";
import ManagerPinModal from "../components/ManagerPinModal";

const OFFLINE_QUEUE_KEY = "bd_pos_offline_queue_v1";
const OFFLINE_LOG_KEY = "bd_pos_offline_log_v1";
const OFFLINE_SYNC_LOCK_KEY = "bd_pos_offline_sync_lock_v1";
const OFFLINE_DISCARD_PIN_KEY = "bd_pos_manager_pin";
const PRICE_OVERRIDE_APPROVAL_PERCENT = 5;
const PRICE_OVERRIDE_APPROVAL_AMOUNT = 50;

const readJsonStorage = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

const writeJsonStorage = (key, value) => {
  localStorage.setItem(key, JSON.stringify(value));
};

function POS() {
  const currentUser = readJsonStorage("bd_pos_user", null);
  const currentUserRole = String(currentUser?.roleName || "").toLowerCase();
  const canDiscardOfflineQueue = currentUserRole === "admin";
  const defaultStoreSettings = {
    storeName: "BD Smart POS",
    storeAddress: "Dhaka, Bangladesh",
    storePhone: "",
    footerMessage: "Thank you",
    logoDataUrl: "",
    receiptLanguage: localStorage.getItem("bd_pos_lang") || "en",
  };
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [paidAmount, setPaidAmount] = useState("");
  const [paymentBreakdown, setPaymentBreakdown] = useState([{ method: "Cash", amount: "", channel: "" }]);
  const [discountType, setDiscountType] = useState("AMOUNT");
  const [discountValue, setDiscountValue] = useState("0");
  const [managerApprovalPin, setManagerApprovalPin] = useState("");
  const [paymentChannel, setPaymentChannel] = useState("");
  const [customer, setCustomer] = useState({
    name: "",
    phone: "",
  });
  const [customerLoyalty, setCustomerLoyalty] = useState(null);
  const [redeemPoints, setRedeemPoints] = useState("");
  const [summary, setSummary] = useState({
    totalSales: 0,
    totalPaid: 0,
    totalDue: 0,
    totalVat: 0,
    billCount: 0,
  });
  const [recentSales, setRecentSales] = useState([]);
  const [barcode, setBarcode] = useState("");
  const [paperSize, setPaperSize] = useState("58");
  const [lastSaleId, setLastSaleId] = useState(null);
  const [showStoreSettings, setShowStoreSettings] = useState(false);
  const [storeSettings, setStoreSettings] = useState(defaultStoreSettings);
  const [previewHtml, setPreviewHtml] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [offlineQueue, setOfflineQueue] = useState(() => readJsonStorage(OFFLINE_QUEUE_KEY, []));
  const [offlineLog, setOfflineLog] = useState(() => readJsonStorage(OFFLINE_LOG_KEY, []));
  const [isSyncingOffline, setIsSyncingOffline] = useState(false);
  const [isOnline, setIsOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [heldCarts, setHeldCarts] = useState([]);
  const [holdSearch, setHoldSearch] = useState("");
  const [holdNote, setHoldNote] = useState("");
  const [showHeldPanel, setShowHeldPanel] = useState(false);
  const [activeHoldAuditLogId, setActiveHoldAuditLogId] = useState(null);
  const [activeQuoteAuditLogId, setActiveQuoteAuditLogId] = useState(null);
  const [quoteLoadNotice, setQuoteLoadNotice] = useState("");
  const [quoteNote, setQuoteNote] = useState("");
  const [pinModal, setPinModal] = useState({ open: false, title: "", message: "" });
  const pinResolveRef = useRef(null);
  const barcodeInputRef = useRef(null);
  const receiptLanguage = storeSettings.receiptLanguage === "bn" ? "bn" : "en";
  const receiptLocale = receiptLanguage === "bn" ? "bn-BD" : "en-US";
  const formatBDT = (value) =>
    new Intl.NumberFormat(receiptLocale, {
      style: "currency",
      currency: "BDT",
      maximumFractionDigits: 2,
    }).format(Number(value || 0));
  const formatBnDateTime = (value) =>
    new Date(value).toLocaleString(receiptLocale, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  const receiptText = receiptLanguage === "bn"
    ? {
        invoice: "ইনভয়েস",
        date: "তারিখ",
        payment: "পেমেন্ট",
        customer: "কাস্টমার",
        walkInCustomer: "ওয়াক-ইন কাস্টমার",
        item: "পণ্য",
        qty: "পরিমাণ",
        rate: "দর",
        amount: "মূল্য",
        subTotal: "সাবটোটাল",
        vat: "ভ্যাট",
        discount: "ডিসকাউন্ট",
        total: "সর্বমোট",
        paid: "পরিশোধিত",
        due: "বাকি",
      }
    : {
        invoice: "Invoice",
        date: "Date",
        payment: "Payment",
        customer: "Customer",
        walkInCustomer: "Walk-in Customer",
        item: "Item",
        qty: "Qty",
        rate: "Rate",
        amount: "Amount",
        subTotal: "Subtotal",
        vat: "VAT",
        discount: "Discount",
        total: "Total",
        paid: "Paid",
        due: "Due",
      };

  const persistOfflineQueue = (updater) => {
    setOfflineQueue((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      writeJsonStorage(OFFLINE_QUEUE_KEY, next);
      return next;
    });
  };

  const persistOfflineLog = (updater) => {
    setOfflineLog((prev) => {
      const nextRaw = typeof updater === "function" ? updater(prev) : updater;
      const next = nextRaw.slice(0, 200);
      writeJsonStorage(OFFLINE_LOG_KEY, next);
      return next;
    });
  };

  const appendOfflineLog = (entry) => {
    persistOfflineLog((prev) => [{ id: `${Date.now()}-${Math.random()}`, ...entry }, ...prev]);
  };

  const fetchProducts = async () => {
    const res = await api.get("/products");
    setProducts(res.data);
  };
  const fetchSummary = async () => {
    const res = await api.get("/sales/summary/today");
    setSummary(res.data);
  };
  const fetchRecentSales = async () => {
    const res = await api.get("/sales/recent");
    setRecentSales(res.data);
  };
  const fetchHeldCarts = async (searchText = "") => {
    const query = searchText ? `?q=${encodeURIComponent(searchText)}` : "";
    const res = await api.get(`/sales/holds${query}`);
    setHeldCarts(res.data || []);
  };

  const closePinModal = () => {
    setPinModal((m) => ({ ...m, open: false }));
    const r = pinResolveRef.current;
    pinResolveRef.current = null;
    r?.(null);
  };

  const askManagerPin = ({ title, message }) =>
    new Promise((resolve) => {
      pinResolveRef.current = resolve;
      setPinModal({
        open: true,
        title: title || "Manager approval",
        message: message || "",
      });
    });

  const confirmPinModal = (pin) => {
    setPinModal((m) => ({ ...m, open: false }));
    const r = pinResolveRef.current;
    pinResolveRef.current = null;
    r?.(pin);
  };

  // fetch initial data
  useEffect(() => {
    fetchProducts();
    fetchSummary();
    fetchRecentSales();
    fetchHeldCarts();
  }, []);

  useEffect(() => {
    barcodeInputRef.current?.focus();
  }, []);

  useEffect(() => {
    try {
      const rawSettings = localStorage.getItem("bd-pos-store-settings");
      if (rawSettings) {
        const parsed = JSON.parse(rawSettings);
        setStoreSettings({
          ...defaultStoreSettings,
          ...parsed,
        });
      }
    } catch (error) {
      console.error("Failed to load store settings:", error);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("bd-pos-store-settings", JSON.stringify(storeSettings));
  }, [storeSettings]);

  const buildCheckoutPayload = () => ({
    cart,
    paymentMethod,
    paymentChannel,
    paidAmount: checkoutPaidAmount,
    paymentBreakdown: useSplitPayment ? paymentBreakdown : [],
    customer,
    discountType,
    discountValue: Number(discountValue || 0),
    managerApprovalPin,
    redeemPoints: appliedRedeemPoints,
    ...(activeHoldAuditLogId != null ? { holdCartAuditLogId: activeHoldAuditLogId } : {}),
    ...(activeQuoteAuditLogId != null ? { quoteAuditLogId: activeQuoteAuditLogId } : {}),
  });

  const syncOfflineQueue = async () => {
    if (readJsonStorage(OFFLINE_SYNC_LOCK_KEY, false)) return;
    const queueSnapshot = readJsonStorage(OFFLINE_QUEUE_KEY, []);
    if (!queueSnapshot.length) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    writeJsonStorage(OFFLINE_SYNC_LOCK_KEY, true);
    setIsSyncingOffline(true);
    try {
      let queue = [...queueSnapshot];
      while (queue.length > 0) {
        const item = queue[0];
        try {
          await api.post("/sales/checkout", item.payload);
          queue.shift();
          writeJsonStorage(OFFLINE_QUEUE_KEY, queue);
          setOfflineQueue(queue);
          appendOfflineLog({
            type: "SYNC_SUCCESS",
            message: `Synced queued sale (${item.localRef})`,
            localRef: item.localRef,
            createdAt: new Date().toISOString(),
          });
        } catch (error) {
          const reason = error?.response?.data?.error || error.message || "Sync failed";
          const updatedItem = {
            ...item,
            status: "FAILED",
            lastError: reason,
            retryCount: Number(item.retryCount || 0) + 1,
            updatedAt: new Date().toISOString(),
          };
          queue[0] = updatedItem;
          writeJsonStorage(OFFLINE_QUEUE_KEY, queue);
          setOfflineQueue(queue);
          appendOfflineLog({
            type: "SYNC_FAILED",
            message: `Failed to sync queued sale (${item.localRef}): ${reason}`,
            localRef: item.localRef,
            createdAt: new Date().toISOString(),
          });
          break;
        }
      }
      fetchProducts();
      fetchSummary();
      fetchRecentSales();
    } finally {
      writeJsonStorage(OFFLINE_SYNC_LOCK_KEY, false);
      setIsSyncingOffline(false);
    }
  };

  const queueOfflineSale = (payload, reason) => {
    const now = new Date().toISOString();
    const localRef = `OFF-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const queued = {
      localRef,
      payload,
      status: "QUEUED",
      retryCount: 0,
      lastError: reason || "Queued by fallback",
      createdAt: now,
      updatedAt: now,
      total: payload?.paidAmount || 0,
    };
    persistOfflineQueue((prev) => [queued, ...prev]);
    appendOfflineLog({
      type: "QUEUED",
      message: `Sale queued for sync (${localRef})`,
      localRef,
      createdAt: now,
    });
    return localRef;
  };

  // live updates for multi-counter usage
  useEffect(() => {
    const onStockUpdated = (updatedProducts) => {
      setProducts(updatedProducts);
    };
    const onSaleCreated = (sale) => {
      setRecentSales((prev) => [sale, ...prev].slice(0, 20));
      setLastSaleId(sale.id);
      fetchSummary();
    };

    socket.on("product:stock-updated", onStockUpdated);
    socket.on("sale:created", onSaleCreated);

    return () => {
      socket.off("product:stock-updated", onStockUpdated);
      socket.off("sale:created", onSaleCreated);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "F2") {
        event.preventDefault();
        if (cart.length > 0) {
          handleCheckout();
        }
      }
      if (event.key === "F4") {
        event.preventDefault();
        if (lastSaleId) {
          printInvoice(lastSaleId);
        }
      }
      if (event.key === "F6") {
        event.preventDefault();
        if (cart.length > 0) {
          handleHoldCart();
        }
      }
      if (event.key === "F7") {
        event.preventDefault();
        setShowHeldPanel((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [cart, lastSaleId, holdNote]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchHeldCarts(holdSearch);
    }, 200);
    return () => clearTimeout(timer);
  }, [holdSearch]);

  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true);
      syncOfflineQueue();
    };
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      syncOfflineQueue();
    }, 15000);
    return () => clearInterval(timer);
  }, [offlineQueue.length]);

  useEffect(() => {
    writeJsonStorage(OFFLINE_SYNC_LOCK_KEY, false);
    syncOfflineQueue();
  }, []);

  // add to cart
  const addToCart = (product) => {
    if (product.stock <= 0) {
      return;
    }
    const existing = cart.find((item) => item.id === product.id);

    if (existing) {
      if (existing.qty >= product.stock) {
        return;
      }
      setCart(
        cart.map((item) =>
          item.id === product.id
            ? { ...item, qty: item.qty + 1 }
            : item
        )
      );
    } else {
      setCart([...cart, { ...product, qty: 1 }]);
    }
  };

  const handleBarcodeAdd = async (e) => {
    e.preventDefault();
    const code = barcode.trim();
    if (!code) {
      return;
    }

    try {
      const res = await api.get(`/products/search/by-code?code=${encodeURIComponent(code)}`);
      addToCart(res.data);
      setBarcode("");
      barcodeInputRef.current?.focus();
    } catch (error) {
      alert(error.response?.data?.error || "Product not found for barcode/SKU");
      barcodeInputRef.current?.focus();
    }
  };

  // update quantity
  const updateQty = (id, qty) => {
    const product = products.find((p) => p.id === id);
    const nextQty = Math.max(1, Number(qty || 1));
    const safeQty = product ? Math.min(nextQty, product.stock) : nextQty;
    setCart(
      cart.map((item) =>
        item.id === id ? { ...item, qty: safeQty } : item
      )
    );
  };

  const updateOverridePrice = (id, value) => {
    setCart(
      cart.map((item) =>
        item.id === id
          ? { ...item, overridePrice: value }
          : item
      )
    );
  };

  const resetOverridePrice = (id) => {
    setCart(
      cart.map((item) =>
        item.id === id
          ? { ...item, overridePrice: "" }
          : item
      )
    );
  };

  // remove item
  const removeItem = (id) => {
    setCart(cart.filter((item) => item.id !== id));
  };

  const getPerUnitPredefinedDiscount = (item) => {
    const type = item.defaultDiscountType || "";
    const value = Number(item.defaultDiscountValue || 0);
    if (!type || value <= 0) return 0;
    if (type === "PERCENT") return (Number(item.price) * value) / 100;
    if (type === "AMOUNT") return value;
    return 0;
  };

  const getUnitSellPrice = (item) => {
    const raw = item.overridePrice;
    const hasOverride = raw !== undefined && raw !== null && String(raw).trim() !== "";
    if (!hasOverride) return Number(item.price);
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return Number(item.price);
    return parsed;
  };

  const priceOverrideSummary = cart.reduce(
    (acc, item) => {
      const base = Number(item.price || 0);
      const unit = getUnitSellPrice(item);
      const reductionPerUnit = Math.max(0, base - unit);
      const reductionPercent = base > 0 ? (reductionPerUnit / base) * 100 : 0;
      if (reductionPerUnit > 0) {
        acc.totalReduction += reductionPerUnit * Number(item.qty || 0);
      }
      if (
        reductionPerUnit > PRICE_OVERRIDE_APPROVAL_AMOUNT ||
        reductionPercent > PRICE_OVERRIDE_APPROVAL_PERCENT
      ) {
        acc.requiresApproval = true;
      }
      return acc;
    },
    { totalReduction: 0, requiresApproval: false }
  );

  const grossSubTotal = cart.reduce(
    (sum, item) => sum + getUnitSellPrice(item) * Number(item.qty),
    0,
  );
  const predefinedDiscount = cart.reduce((sum, item) => {
    const unit = getUnitSellPrice(item);
    const perUnit = Math.min(unit, getPerUnitPredefinedDiscount(item));
    return sum + perUnit * Number(item.qty);
  }, 0);
  const subTotal = Math.max(0, grossSubTotal - predefinedDiscount);
  const vatAmount = cart.reduce(
    (sum, item) => {
      const unit = getUnitSellPrice(item);
      const perUnit = Math.min(unit, getPerUnitPredefinedDiscount(item));
      const netUnit = Math.max(0, unit - perUnit);
      return sum + ((netUnit * Number(item.qty)) * Number(item.vatRate || 0)) / 100;
    },
    0,
  );
  const manualDiscountAmount =
    discountType === "PERCENT"
      ? (subTotal * Number(discountValue || 0)) / 100
      : Number(discountValue || 0);
  const safeRedeemPoints = Math.max(0, Number(redeemPoints || 0));
  const maxRedeemByPoints = Math.max(0, Number(customerLoyalty?.loyaltyPoints || 0));
  const maxRedeemByPercentAmount = subTotal * 0.2;
  const maxRedeemByPercentPoints = Math.floor(maxRedeemByPercentAmount / 1);
  const appliedRedeemPoints = Math.min(safeRedeemPoints, maxRedeemByPoints, maxRedeemByPercentPoints);
  const redeemDiscountAmount = appliedRedeemPoints * 1;
  const tierDiscountPercent =
    customerLoyalty?.loyaltyTier === "GOLD" ? 5 : customerLoyalty?.loyaltyTier === "SILVER" ? 2 : 0;
  const tierDiscountAmount = (subTotal * tierDiscountPercent) / 100;
  const redemptionNeedsManagerApproval = appliedRedeemPoints > 200;
  const totalDiscount = Math.max(
    0,
    predefinedDiscount + Math.max(0, manualDiscountAmount) + tierDiscountAmount + redeemDiscountAmount
  );
  const total = Math.max(
    0,
    subTotal + vatAmount - Math.max(0, manualDiscountAmount) - tierDiscountAmount - redeemDiscountAmount
  );
  const effectivePaid = paidAmount === "" ? total : Number(paidAmount);
  const splitPaidTotal = paymentBreakdown.reduce((sum, line) => sum + Number(line.amount || 0), 0);
  const useSplitPayment = paymentMethod === "Split";
  const checkoutPaidAmount = useSplitPayment ? splitPaidTotal : effectivePaid;
  const checkoutDue = Math.max(0, total - checkoutPaidAmount);
  const creditLimitVal = Number(customerLoyalty?.creditLimit || 0);
  const customerBalance = Number(customerLoyalty?.balance || 0);
  const creditProjected =
    checkoutDue > 0 && creditLimitVal > 0 && customerLoyalty ? customerBalance + checkoutDue : null;
  const creditWouldExceed =
    creditProjected != null && creditProjected > creditLimitVal + 0.01;
  const managerApprovalNeeded =
    (discountType === "PERCENT" && Number(discountValue || 0) > 10) ||
    (discountType === "AMOUNT" && Number(discountValue || 0) > 500) ||
    redemptionNeedsManagerApproval ||
    priceOverrideSummary.requiresApproval ||
    creditWouldExceed;

  const updatePaymentLine = (index, key, value) => {
    setPaymentBreakdown((prev) => prev.map((line, i) => (i === index ? { ...line, [key]: value } : line)));
  };

  const addPaymentLine = () => {
    setPaymentBreakdown((prev) => [...prev, { method: "Cash", amount: "", channel: "" }]);
  };

  const removePaymentLine = (index) => {
    setPaymentBreakdown((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  };

  const parsePaymentInfo = (sale) => {
    try {
      const payload = JSON.parse(sale.notes || "{}");
      if (Array.isArray(payload.paymentBreakdown)) return payload.paymentBreakdown;
      return [];
    } catch {
      return [];
    }
  };

  useEffect(() => {
    const phone = String(customer.phone || "").trim();
    if (phone.length < 6) {
      setCustomerLoyalty(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await api.get(`/master/customers/lookup?phone=${encodeURIComponent(phone)}`);
        setCustomerLoyalty(res.data);
      } catch {
        setCustomerLoyalty(null);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [customer.phone]);

  const handleCheckout = async () => {
    const payload = buildCheckoutPayload();
    try {
      const response = await api.post("/sales/checkout", payload);

      setCart([]);
      setPaidAmount("");
      setDiscountType("AMOUNT");
      setDiscountValue("0");
      setManagerApprovalPin("");
      setPaymentChannel("");
      setCustomer({ name: "", phone: "" });
      setCustomerLoyalty(null);
      setRedeemPoints("");
      setPaymentMethod("Cash");
      setPaymentBreakdown([{ method: "Cash", amount: "", channel: "" }]);
      if (paymentMethod !== "Cash") {
        setPaidAmount("");
      }
      setActiveHoldAuditLogId(null);
      setActiveQuoteAuditLogId(null);

      const loyalty = response?.data?.loyalty;
      if (loyalty) {
        alert(`Sale completed. Loyalty: ${loyalty.points} pts available (${loyalty.tier}).`);
      } else {
        alert("Sale completed");
      }
      fetchProducts();
      fetchSummary();
      fetchRecentSales();
      fetchHeldCarts(holdSearch);
      barcodeInputRef.current?.focus();
    } catch (error) {
      const apiError = error.response?.data?.error;
      const shouldQueue = !error.response || error.code === "ERR_NETWORK";
      if (shouldQueue) {
        const localRef = queueOfflineSale(payload, apiError || "Network unavailable");
        setCart([]);
        setPaidAmount("");
        setDiscountType("AMOUNT");
        setDiscountValue("0");
        setManagerApprovalPin("");
        setPaymentChannel("");
        setCustomer({ name: "", phone: "" });
        setCustomerLoyalty(null);
        setRedeemPoints("");
        setPaymentMethod("Cash");
        setPaymentBreakdown([{ method: "Cash", amount: "", channel: "" }]);
        setActiveHoldAuditLogId(null);
        setActiveQuoteAuditLogId(null);
        alert(`Network unavailable. Sale saved offline (${localRef}) and will auto-sync.`);
      } else {
        alert(apiError || "Checkout failed");
      }
      barcodeInputRef.current?.focus();
    }
  };

  const handleHoldCart = async () => {
    if (!cart.length) return;
    try {
      const payload = buildCheckoutPayload();
      await api.post("/sales/holds", { ...payload, holdNote });
      setActiveHoldAuditLogId(null);
      setActiveQuoteAuditLogId(null);
      setCart([]);
      setPaidAmount("");
      setDiscountType("AMOUNT");
      setDiscountValue("0");
      setManagerApprovalPin("");
      setPaymentChannel("");
      setCustomer({ name: "", phone: "" });
      setCustomerLoyalty(null);
      setRedeemPoints("");
      setPaymentMethod("Cash");
      setPaymentBreakdown([{ method: "Cash", amount: "", channel: "" }]);
      setHoldNote("");
      setShowHeldPanel(true);
      fetchHeldCarts(holdSearch);
      alert("Cart held successfully");
    } catch (error) {
      alert(error?.response?.data?.error || "Unable to hold cart");
    }
  };

  const handleSaveQuote = async () => {
    if (!cart.length) return;
    try {
      const payload = buildCheckoutPayload();
      await api.post("/sales/quotes", { ...payload, quoteNote });
      setQuoteNote("");
      alert("Quotation saved. Open it from the Quotations menu.");
    } catch (error) {
      alert(error?.response?.data?.error || "Unable to save quote");
    }
  };

  const applyHeldDraftToPos = (draft) => {
    if (!Array.isArray(draft?.cart) || !draft.cart.length) {
      alert("Held cart is empty");
      return false;
    }
    setCart(draft.cart);
    setPaymentMethod(draft.paymentMethod || "Cash");
    setPaidAmount(String(draft.paidAmount ?? ""));
    setPaymentBreakdown(Array.isArray(draft.paymentBreakdown) && draft.paymentBreakdown.length ? draft.paymentBreakdown : [{ method: "Cash", amount: "", channel: "" }]);
    setPaymentChannel(draft.paymentChannel || "");
    setCustomer(draft.customer || { name: "", phone: "" });
    setDiscountType(draft.discountType || "AMOUNT");
    setDiscountValue(String(draft.discountValue ?? 0));
    setRedeemPoints(String(draft.redeemPoints ?? ""));
    setHoldNote(draft.holdNote || "");
    setShowHeldPanel(false);
    return true;
  };

  useEffect(() => {
    const raw = localStorage.getItem("bd_pos_load_quote_id");
    if (!raw) return;
    localStorage.removeItem("bd_pos_load_quote_id");
    const id = Number(raw);
    if (Number.isNaN(id)) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.post(`/sales/quotes/${id}/load`);
        if (cancelled) return;
        const draft = res.data?.draft;
        if (!applyHeldDraftToPos(draft)) return;
        setActiveQuoteAuditLogId(id);
        setQuoteLoadNotice(
          `Loaded quotation ${res.data?.quoteNo ? String(res.data.quoteNo) : `#${id}`} into POS.`
        );
        setActiveHoldAuditLogId(null);
        setShowHeldPanel(false);
        barcodeInputRef.current?.focus();
      } catch (error) {
        if (!cancelled) alert(error?.response?.data?.error || "Could not load quotation");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate once from Quotations "Open in POS"
  }, []);

  useEffect(() => {
    if (!quoteLoadNotice) return undefined;
    const timer = setTimeout(() => setQuoteLoadNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [quoteLoadNotice]);

  const resumeHeldCart = async (row) => {
    const holderId = row?.heldByUserId != null ? Number(row.heldByUserId) : null;
    const myId = currentUser?.id != null ? Number(currentUser.id) : null;
    const isOwnHold = holderId != null && myId != null && holderId === myId;
    let resumePinExtra = "";
    if (!isOwnHold) {
      const entered = await askManagerPin({
        title: "Resume another cashier's hold",
        message: "This hold belongs to another cashier. Enter the manager PIN to load it.",
      });
      if (entered == null) return;
      resumePinExtra = String(entered).trim();
    }
    try {
      const res = await api.post(`/sales/holds/${row.id}/resume`, resumePinExtra ? { managerApprovalPin: resumePinExtra } : {});
      const draft = res.data?.draft;
      if (!applyHeldDraftToPos(draft)) return;
      setActiveHoldAuditLogId(row.id);
      setActiveQuoteAuditLogId(null);
    } catch (error) {
      alert(error?.response?.data?.error || "Unable to resume held cart");
    }
  };

  const discardHeldCart = async (row) => {
    if (!window.confirm("Discard this held cart?")) return;
    const holderId = row?.heldByUserId != null ? Number(row.heldByUserId) : null;
    const myId = currentUser?.id != null ? Number(currentUser.id) : null;
    const isOwnHold = holderId != null && myId != null && holderId === myId;
    let discardPinExtra = "";
    if (!isOwnHold) {
      const entered = await askManagerPin({
        title: "Discard another cashier's hold",
        message: "Enter the manager PIN to discard this hold.",
      });
      if (entered == null) return;
      discardPinExtra = String(entered).trim();
    }
    try {
      await api.delete(`/sales/holds/${row.id}`, {
        data: discardPinExtra ? { managerApprovalPin: discardPinExtra } : {},
      });
      setActiveHoldAuditLogId((prev) => (prev === row.id ? null : prev));
      fetchHeldCarts(holdSearch);
    } catch (error) {
      alert(error?.response?.data?.error || "Unable to discard held cart");
    }
  };

  const retryQueuedSale = async (row) => {
    try {
      await api.post("/sales/checkout", row.payload);
      persistOfflineQueue((prev) => prev.filter((x) => x.localRef !== row.localRef));
      appendOfflineLog({
        type: "MANUAL_RETRY_SUCCESS",
        message: `Manual retry synced (${row.localRef})`,
        localRef: row.localRef,
        createdAt: new Date().toISOString(),
      });
      fetchProducts();
      fetchSummary();
      fetchRecentSales();
    } catch (error) {
      const reason = error?.response?.data?.error || error.message || "Retry failed";
      persistOfflineQueue((prev) =>
        prev.map((x) =>
          x.localRef === row.localRef
            ? { ...x, status: "FAILED", lastError: reason, retryCount: Number(x.retryCount || 0) + 1, updatedAt: new Date().toISOString() }
            : x
        )
      );
      appendOfflineLog({
        type: "MANUAL_RETRY_FAILED",
        message: `Manual retry failed (${row.localRef}): ${reason}`,
        localRef: row.localRef,
        createdAt: new Date().toISOString(),
      });
      alert(reason);
    }
  };

  const discardQueuedSale = async (row) => {
    if (!canDiscardOfflineQueue) {
      alert("Only Admin can discard queued sales.");
      return;
    }
    const enteredPin = await askManagerPin({
      title: "Discard offline queued sale",
      message: "Admin only — enter manager PIN from Settings to discard this queued sale.",
    });
    if (enteredPin == null) return;
    const expectedPin = String(localStorage.getItem(OFFLINE_DISCARD_PIN_KEY) || "1234");
    if (String(enteredPin).trim() !== expectedPin) {
      alert("Invalid manager PIN. Discard cancelled.");
      return;
    }
    persistOfflineQueue((prev) => prev.filter((x) => x.localRef !== row.localRef));
    appendOfflineLog({
      type: "DISCARDED",
      message: `Discarded queued sale (${row.localRef})`,
      localRef: row.localRef,
      createdAt: new Date().toISOString(),
    });
  };

  const printInvoice = async (saleId) => {
    const buildReceiptHtml = (sale) => {
      const receiptWidth = paperSize === "80" ? 420 : 300;
      const fontSize = paperSize === "80" ? 13 : 12;
      const escapeHtml = (value) =>
        String(value || "")
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#39;");
      const lines = sale.items
        .map((item) => {
          const name = item.product?.name || `Item ${item.productId}`;
          const originalUnitPrice = Number(item.product?.price || item.price || 0);
          const hasOverride = originalUnitPrice > Number(item.price || 0);
          const rateLabel =
            hasOverride
              ? `${Number(item.price).toFixed(2)} (orig ${originalUnitPrice.toFixed(2)})`
              : Number(item.price).toFixed(2);
          const lineTotal = Number(item.qty) * Number(item.price);
          return `<tr><td>${name}</td><td style="text-align:center;">${item.qty}</td><td style="text-align:right;">${rateLabel}</td><td style="text-align:right;">${lineTotal.toFixed(2)}</td></tr>`;
        })
        .join("");
      const receiptHtml = `
        <html>
          <head>
            <title>Invoice ${sale.invoiceNo || sale.id}</title>
            <style>
              body { font-family: Arial, sans-serif; width: ${receiptWidth}px; margin: 0 auto; padding: 8px; }
              h2, p { margin: 4px 0; }
              table { width: 100%; border-collapse: collapse; font-size: ${fontSize}px; }
              th, td { border-bottom: 1px dashed #aaa; padding: 4px 2px; }
              .total-row td { font-weight: bold; }
              .right { text-align: right; }
            </style>
          </head>
          <body>
            ${
              storeSettings.logoDataUrl
                ? `<div style="text-align:center; margin-bottom:6px;"><img src="${storeSettings.logoDataUrl}" alt="Store Logo" style="max-width:${paperSize === "80" ? "140px" : "100px"}; max-height:60px;" /></div>`
                : ""
            }
            <h2 style="text-align:center;">${escapeHtml(storeSettings.storeName)}</h2>
            <p style="text-align:center;">${escapeHtml(storeSettings.storeAddress)}</p>
            ${storeSettings.storePhone ? `<p style="text-align:center;">${escapeHtml(storeSettings.storePhone)}</p>` : ""}
            <p>${receiptText.invoice}: ${sale.invoiceNo || sale.id}</p>
            <p>${receiptText.date}: ${formatBnDateTime(sale.createdAt)}</p>
            <p>${receiptText.payment}: ${sale.paymentMethod}${sale.paymentChannel ? ` (${sale.paymentChannel})` : ""}</p>
            ${
              parsePaymentInfo(sale).length
                ? `<p>${parsePaymentInfo(sale)
                    .map((line) => `${line.method}: ${formatBDT(line.amount)}${line.channel ? ` (${line.channel})` : ""}`)
                    .join(" | ")}</p>`
                : ""
            }
            <p>${receiptText.customer}: ${sale.customer?.name || receiptText.walkInCustomer}</p>
            <table>
              <thead>
                <tr>
                  <th style="text-align:left;">${receiptText.item}</th>
                  <th>${receiptText.qty}</th>
                  <th class="right">${receiptText.rate}</th>
                  <th class="right">${receiptText.amount}</th>
                </tr>
              </thead>
              <tbody>
                ${lines}
                <tr><td colspan="3" class="right">${receiptText.subTotal}</td><td class="right">${formatBDT(sale.subTotal || 0)}</td></tr>
                <tr><td colspan="3" class="right">${receiptText.vat}</td><td class="right">${formatBDT(sale.vatAmount || 0)}</td></tr>
                <tr><td colspan="3" class="right">${receiptText.discount}</td><td class="right">${formatBDT(sale.discount || 0)}</td></tr>
                <tr class="total-row"><td colspan="3" class="right">${receiptText.total}</td><td class="right">${formatBDT(sale.total)}</td></tr>
                <tr><td colspan="3" class="right">${receiptText.paid}</td><td class="right">${formatBDT(sale.paidAmount)}</td></tr>
                <tr><td colspan="3" class="right">${receiptText.due}</td><td class="right">${formatBDT(sale.dueAmount)}</td></tr>
              </tbody>
            </table>
            <p style="text-align:center; margin-top:10px;">${escapeHtml(storeSettings.footerMessage)}</p>
          </body>
        </html>
      `;

      return receiptHtml;
    };

    const buildAndPrintReceipt = (sale) => {
      const receiptHtml = buildReceiptHtml(sale);
      const printWin = window.open("", "_blank", "width=420,height=700");
      printWin.document.write(receiptHtml);
      printWin.document.close();
      printWin.focus();
      printWin.print();
    };

    try {
      const res = await api.get(`/sales/${saleId}/invoice`);
      const sale = res.data;
      buildAndPrintReceipt(sale);
    } catch (error) {
      alert(error.response?.data?.error || "Unable to print invoice");
    }
  };

  const handleTestPrint = () => {
    const demoSale = {
      id: "TEST-001",
      invoiceNo: "TEST-PRINT",
      createdAt: new Date().toISOString(),
      paymentMethod: "Cash",
      paymentChannel: "",
      customer: { name: receiptText.walkInCustomer },
      subTotal: 450,
      vatAmount: 22.5,
      discount: 10,
      total: 462.5,
      paidAmount: 500,
      dueAmount: 0,
      items: [
        {
          productId: 1,
          qty: 2,
          price: 120,
          product: { name: "Demo Product A" },
        },
        {
          productId: 2,
          qty: 1,
          price: 210,
          product: { name: "Demo Product B" },
        },
      ],
    };

    try {
      const receiptWidth = paperSize === "80" ? 420 : 300;
      const fontSize = paperSize === "80" ? 13 : 12;
      const escapeHtml = (value) =>
        String(value || "")
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#39;");
      const lines = demoSale.items
        .map((item) => {
          const name = item.product?.name || `Item ${item.productId}`;
          const lineTotal = Number(item.qty) * Number(item.price);
          return `<tr><td>${name}</td><td style="text-align:center;">${item.qty}</td><td style="text-align:right;">${Number(
            item.price
          ).toFixed(2)}</td><td style="text-align:right;">${lineTotal.toFixed(2)}</td></tr>`;
        })
        .join("");

      const receiptHtml = `
        <html>
          <head>
            <title>Invoice ${demoSale.invoiceNo}</title>
            <style>
              body { font-family: Arial, sans-serif; width: ${receiptWidth}px; margin: 0 auto; padding: 8px; }
              h2, p { margin: 4px 0; }
              table { width: 100%; border-collapse: collapse; font-size: ${fontSize}px; }
              th, td { border-bottom: 1px dashed #aaa; padding: 4px 2px; }
              .total-row td { font-weight: bold; }
              .right { text-align: right; }
            </style>
          </head>
          <body>
            ${
              storeSettings.logoDataUrl
                ? `<div style="text-align:center; margin-bottom:6px;"><img src="${storeSettings.logoDataUrl}" alt="Store Logo" style="max-width:${paperSize === "80" ? "140px" : "100px"}; max-height:60px;" /></div>`
                : ""
            }
            <h2 style="text-align:center;">${escapeHtml(storeSettings.storeName)}</h2>
            <p style="text-align:center;">${escapeHtml(storeSettings.storeAddress)}</p>
            ${storeSettings.storePhone ? `<p style="text-align:center;">${escapeHtml(storeSettings.storePhone)}</p>` : ""}
            <p>${receiptText.invoice}: ${demoSale.invoiceNo}</p>
            <p>${receiptText.date}: ${formatBnDateTime(demoSale.createdAt)}</p>
            <p>${receiptText.payment}: ${demoSale.paymentMethod}</p>
            <p>${receiptText.customer}: ${demoSale.customer.name}</p>
            <table>
              <thead>
                <tr>
                  <th style="text-align:left;">${receiptText.item}</th>
                  <th>${receiptText.qty}</th>
                  <th class="right">${receiptText.rate}</th>
                  <th class="right">${receiptText.amount}</th>
                </tr>
              </thead>
              <tbody>
                ${lines}
                <tr><td colspan="3" class="right">${receiptText.subTotal}</td><td class="right">${formatBDT(demoSale.subTotal)}</td></tr>
                <tr><td colspan="3" class="right">${receiptText.vat}</td><td class="right">${formatBDT(demoSale.vatAmount)}</td></tr>
                <tr><td colspan="3" class="right">${receiptText.discount}</td><td class="right">${formatBDT(demoSale.discount)}</td></tr>
                <tr class="total-row"><td colspan="3" class="right">${receiptText.total}</td><td class="right">${formatBDT(demoSale.total)}</td></tr>
                <tr><td colspan="3" class="right">${receiptText.paid}</td><td class="right">${formatBDT(demoSale.paidAmount)}</td></tr>
                <tr><td colspan="3" class="right">${receiptText.due}</td><td class="right">${formatBDT(demoSale.dueAmount)}</td></tr>
              </tbody>
            </table>
            <p style="text-align:center; margin-top:10px;">${escapeHtml(storeSettings.footerMessage)}</p>
          </body>
        </html>
      `;

      const printWin = window.open("", "_blank", "width=420,height=700");
      printWin.document.write(receiptHtml);
      printWin.document.close();
      printWin.focus();
      printWin.print();
    } catch (error) {
      alert(error.message || "Unable to print test receipt");
    }
  };

  const handleTestPreview = () => {
    const demoSale = {
      id: "TEST-001",
      invoiceNo: "TEST-PREVIEW",
      createdAt: new Date().toISOString(),
      paymentMethod: "Cash",
      paymentChannel: "",
      customer: { name: receiptText.walkInCustomer },
      subTotal: 450,
      vatAmount: 22.5,
      discount: 10,
      total: 462.5,
      paidAmount: 500,
      dueAmount: 0,
      items: [
        {
          productId: 1,
          qty: 2,
          price: 120,
          product: { name: "Demo Product A" },
        },
        {
          productId: 2,
          qty: 1,
          price: 210,
          product: { name: "Demo Product B" },
        },
      ],
    };
    const receiptWidth = paperSize === "80" ? 420 : 300;
    const fontSize = paperSize === "80" ? 13 : 12;
    const escapeHtml = (value) =>
      String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
    const lines = demoSale.items
      .map((item) => {
        const name = item.product?.name || `Item ${item.productId}`;
        const lineTotal = Number(item.qty) * Number(item.price);
        return `<tr><td>${name}</td><td style="text-align:center;">${item.qty}</td><td style="text-align:right;">${Number(
          item.price
        ).toFixed(2)}</td><td style="text-align:right;">${lineTotal.toFixed(2)}</td></tr>`;
      })
      .join("");
    const html = `
      <html>
        <head>
          <title>Invoice ${demoSale.invoiceNo}</title>
          <style>
            body { font-family: Arial, sans-serif; width: ${receiptWidth}px; margin: 0 auto; padding: 8px; }
            h2, p { margin: 4px 0; }
            table { width: 100%; border-collapse: collapse; font-size: ${fontSize}px; }
            th, td { border-bottom: 1px dashed #aaa; padding: 4px 2px; }
            .total-row td { font-weight: bold; }
            .right { text-align: right; }
          </style>
        </head>
        <body>
          ${
            storeSettings.logoDataUrl
              ? `<div style="text-align:center; margin-bottom:6px;"><img src="${storeSettings.logoDataUrl}" alt="Store Logo" style="max-width:${paperSize === "80" ? "140px" : "100px"}; max-height:60px;" /></div>`
              : ""
          }
          <h2 style="text-align:center;">${escapeHtml(storeSettings.storeName)}</h2>
          <p style="text-align:center;">${escapeHtml(storeSettings.storeAddress)}</p>
          ${storeSettings.storePhone ? `<p style="text-align:center;">${escapeHtml(storeSettings.storePhone)}</p>` : ""}
          <p>${receiptText.invoice}: ${demoSale.invoiceNo}</p>
          <p>${receiptText.date}: ${formatBnDateTime(demoSale.createdAt)}</p>
          <p>${receiptText.payment}: ${demoSale.paymentMethod}</p>
          <p>${receiptText.customer}: ${demoSale.customer.name}</p>
          <table>
            <thead>
              <tr>
                <th style="text-align:left;">${receiptText.item}</th>
                <th>${receiptText.qty}</th>
                <th class="right">${receiptText.rate}</th>
                <th class="right">${receiptText.amount}</th>
              </tr>
            </thead>
            <tbody>
              ${lines}
              <tr><td colspan="3" class="right">${receiptText.subTotal}</td><td class="right">${formatBDT(demoSale.subTotal)}</td></tr>
              <tr><td colspan="3" class="right">${receiptText.vat}</td><td class="right">${formatBDT(demoSale.vatAmount)}</td></tr>
              <tr><td colspan="3" class="right">${receiptText.discount}</td><td class="right">${formatBDT(demoSale.discount)}</td></tr>
              <tr class="total-row"><td colspan="3" class="right">${receiptText.total}</td><td class="right">${formatBDT(demoSale.total)}</td></tr>
              <tr><td colspan="3" class="right">${receiptText.paid}</td><td class="right">${formatBDT(demoSale.paidAmount)}</td></tr>
              <tr><td colspan="3" class="right">${receiptText.due}</td><td class="right">${formatBDT(demoSale.dueAmount)}</td></tr>
            </tbody>
          </table>
          <p style="text-align:center; margin-top:10px;">${escapeHtml(storeSettings.footerMessage)}</p>
        </body>
      </html>
    `;
    setPreviewHtml(html);
    setShowPreview(true);
  };

  const handleSalePreview = async (saleId) => {
    try {
      const res = await api.get(`/sales/${saleId}/invoice`);
      const sale = res.data;
      const receiptWidth = paperSize === "80" ? 420 : 300;
      const fontSize = paperSize === "80" ? 13 : 12;
      const escapeHtml = (value) =>
        String(value || "")
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#39;");
      const lines = sale.items
        .map((item) => {
          const name = item.product?.name || `Item ${item.productId}`;
          const originalUnitPrice = Number(item.product?.price || item.price || 0);
          const hasOverride = originalUnitPrice > Number(item.price || 0);
          const rateLabel =
            hasOverride
              ? `${Number(item.price).toFixed(2)} (orig ${originalUnitPrice.toFixed(2)})`
              : Number(item.price).toFixed(2);
          const lineTotal = Number(item.qty) * Number(item.price);
          return `<tr><td>${name}</td><td style="text-align:center;">${item.qty}</td><td style="text-align:right;">${rateLabel}</td><td style="text-align:right;">${lineTotal.toFixed(2)}</td></tr>`;
        })
        .join("");
      const html = `
        <html>
          <head>
            <title>Invoice ${sale.invoiceNo || sale.id}</title>
            <style>
              body { font-family: Arial, sans-serif; width: ${receiptWidth}px; margin: 0 auto; padding: 8px; }
              h2, p { margin: 4px 0; }
              table { width: 100%; border-collapse: collapse; font-size: ${fontSize}px; }
              th, td { border-bottom: 1px dashed #aaa; padding: 4px 2px; }
              .total-row td { font-weight: bold; }
              .right { text-align: right; }
            </style>
          </head>
          <body>
            ${
              storeSettings.logoDataUrl
                ? `<div style="text-align:center; margin-bottom:6px;"><img src="${storeSettings.logoDataUrl}" alt="Store Logo" style="max-width:${paperSize === "80" ? "140px" : "100px"}; max-height:60px;" /></div>`
                : ""
            }
            <h2 style="text-align:center;">${escapeHtml(storeSettings.storeName)}</h2>
            <p style="text-align:center;">${escapeHtml(storeSettings.storeAddress)}</p>
            ${storeSettings.storePhone ? `<p style="text-align:center;">${escapeHtml(storeSettings.storePhone)}</p>` : ""}
            <p>${receiptText.invoice}: ${sale.invoiceNo || sale.id}</p>
            <p>${receiptText.date}: ${formatBnDateTime(sale.createdAt)}</p>
            <p>${receiptText.payment}: ${sale.paymentMethod}${sale.paymentChannel ? ` (${sale.paymentChannel})` : ""}</p>
            <p>${receiptText.customer}: ${sale.customer?.name || receiptText.walkInCustomer}</p>
            <table>
              <thead>
                <tr>
                  <th style="text-align:left;">${receiptText.item}</th>
                  <th>${receiptText.qty}</th>
                  <th class="right">${receiptText.rate}</th>
                  <th class="right">${receiptText.amount}</th>
                </tr>
              </thead>
              <tbody>
                ${lines}
                <tr><td colspan="3" class="right">${receiptText.subTotal}</td><td class="right">${formatBDT(sale.subTotal || 0)}</td></tr>
                <tr><td colspan="3" class="right">${receiptText.vat}</td><td class="right">${formatBDT(sale.vatAmount || 0)}</td></tr>
                <tr><td colspan="3" class="right">${receiptText.discount}</td><td class="right">${formatBDT(sale.discount || 0)}</td></tr>
                <tr class="total-row"><td colspan="3" class="right">${receiptText.total}</td><td class="right">${formatBDT(sale.total)}</td></tr>
                <tr><td colspan="3" class="right">${receiptText.paid}</td><td class="right">${formatBDT(sale.paidAmount)}</td></tr>
                <tr><td colspan="3" class="right">${receiptText.due}</td><td class="right">${formatBDT(sale.dueAmount)}</td></tr>
              </tbody>
            </table>
            <p style="text-align:center; margin-top:10px;">${escapeHtml(storeSettings.footerMessage)}</p>
          </body>
        </html>
      `;
      setPreviewHtml(html);
      setShowPreview(true);
    } catch (error) {
      alert(error.response?.data?.error || "Unable to preview invoice");
    }
  };

  const handleLogoChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setStoreSettings((prev) => ({
        ...prev,
        logoDataUrl: reader.result,
      }));
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="pos-layout">
      {/* LEFT: PRODUCTS */}
      <div className="pos-panel pos-products">
        <h2>Products</h2>
        <form onSubmit={handleBarcodeAdd} className="pos-barcode-form">
          <input
            ref={barcodeInputRef}
            placeholder="Scan barcode / SKU and press Enter"
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            className="pos-barcode-input"
          />
          <button type="submit">Add</button>
        </form>
        <p className="pos-summary-line">
          Today: {formatBDT(summary.totalSales)} | Paid: {formatBDT(summary.totalPaid)} | Due:{" "}
          {formatBDT(summary.totalDue)} | Bills: {summary.billCount}
        </p>
        <p className="pos-inline-note">
          Network: {isOnline ? "Online" : "Offline"} | Pending Sync: {offlineQueue.length}{" "}
          {isSyncingOffline ? "(Syncing...)" : ""}
        </p>
        <div className="pos-action-row" style={{ marginBottom: 8 }}>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => syncOfflineQueue()}
            disabled={isSyncingOffline || offlineQueue.length === 0}
          >
            Sync All Now
          </button>
          {!canDiscardOfflineQueue ? (
            <span className="pos-inline-note">Discard queued sale is Admin-only.</span>
          ) : null}
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => setShowHeldPanel((prev) => !prev)}
          >
            Held Carts ({heldCarts.length})
          </button>
        </div>
        <div className="pos-product-list">
          {products.map((p) => (
            <button
              key={p.id}
              type="button"
              className="pos-product-card"
              style={{ cursor: p.stock > 0 ? "pointer" : "not-allowed", opacity: p.stock > 0 ? 1 : 0.6 }}
              onClick={() => addToCart(p)}
            >
              <div className="pos-product-name">{p.name}</div>
              <div className="pos-product-meta">
                <span>{formatBDT(p.price)}</span>
                <span>Stock: {p.stock}</span>
                <span>VAT: {p.vatRate}%</span>
                {p.defaultDiscountType ? (
                  <span className="badge badge-primary">
                    Disc:{" "}
                    {p.defaultDiscountType === "PERCENT"
                      ? `${Number(p.defaultDiscountValue || 0)}%`
                      : formatBDT(p.defaultDiscountValue || 0)}
                  </span>
                ) : null}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* RIGHT: CART */}
      <div className="pos-panel pos-cart">
        <h2>Cart</h2>

        {cart.map((item) => (
          <div key={item.id} className="pos-cart-item">
            <strong className="pos-cart-item-name">{item.name}</strong>
            <div className="pos-cart-item-row">
              {formatBDT(getUnitSellPrice(item))} × 
              <input
                type="number"
                value={item.qty}
                onChange={(e) =>
                  updateQty(item.id, e.target.value)
                }
                className="pos-qty-input"
                min={1}
              />
            </div>
            <div className="pos-cart-item-row">
              <span style={{ minWidth: 72 }}>Override:</span>
              <input
                type="number"
                placeholder="Custom price"
                value={item.overridePrice ?? ""}
                onChange={(e) => updateOverridePrice(item.id, e.target.value)}
                className="pos-qty-input"
                min={0}
              />
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => resetOverridePrice(item.id)}
                disabled={String(item.overridePrice ?? "").trim() === ""}
              >
                Reset
              </button>
            </div>
            {String(item.overridePrice ?? "").trim() !== "" ? (
              <div className="pos-inline-note">
                Base: {formatBDT(item.price)} | Override: {formatBDT(getUnitSellPrice(item))}
              </div>
            ) : null}
            {item.defaultDiscountType ? (
              <div className="pos-inline-note">
                Predefined Disc:{" "}
                {item.defaultDiscountType === "PERCENT"
                  ? `${Number(item.defaultDiscountValue || 0)}%`
                  : formatBDT(item.defaultDiscountValue || 0)}
              </div>
            ) : null}

            <button className="btn-danger btn-sm" onClick={() => removeItem(item.id)}>
              Remove
            </button>
          </div>
        ))}

        <hr />

        <p>Subtotal: {formatBDT(subTotal)}</p>
        <p>VAT: {formatBDT(vatAmount)}</p>
        <p>Predefined Product Discount: {formatBDT(predefinedDiscount)}</p>
        <div className="pos-discount-row">
          <select value={discountType} onChange={(e) => setDiscountType(e.target.value)} className="pos-discount-type">
            <option value="AMOUNT">Amount</option>
            <option value="PERCENT">Percent (%)</option>
          </select>
          <input
            type="number"
            placeholder={discountType === "PERCENT" ? "Manual Discount %" : "Manual Discount Amount"}
            value={discountValue}
            onChange={(e) => setDiscountValue(e.target.value)}
            className="pos-discount-value"
          />
        </div>
        <p>Total Discount: {formatBDT(totalDiscount)}</p>
        {priceOverrideSummary.totalReduction > 0 ? (
          <p>Price Override Reduction: {formatBDT(priceOverrideSummary.totalReduction)}</p>
        ) : null}
        <h3>Total: {formatBDT(total)}</h3>

        <select
          value={paymentMethod}
          onChange={(e) => setPaymentMethod(e.target.value)}
        >
          <option value="Cash">Cash</option>
          <option value="bKash">bKash</option>
          <option value="Nagad">Nagad</option>
          <option value="Rocket">Rocket</option>
          <option value="Card">Card</option>
          <option value="Split">Split Payment</option>
          <option value="Due">Due/Baki</option>
        </select>

        {paymentMethod !== "Split" ? (
          <input
            placeholder="Payment channel (optional)"
            value={paymentChannel}
            onChange={(e) => setPaymentChannel(e.target.value)}
          />
        ) : (
          <div className="pos-settings-box">
            {paymentBreakdown.map((line, idx) => (
              <div key={`pay-line-${idx}`} className="pos-discount-row">
                <select value={line.method} onChange={(e) => updatePaymentLine(idx, "method", e.target.value)}>
                  <option value="Cash">Cash</option>
                  <option value="bKash">bKash</option>
                  <option value="Nagad">Nagad</option>
                  <option value="Rocket">Rocket</option>
                  <option value="Card">Card</option>
                </select>
                <input
                  type="number"
                  placeholder="Amount"
                  value={line.amount}
                  onChange={(e) => updatePaymentLine(idx, "amount", e.target.value)}
                />
                <input
                  placeholder="Channel / Ref"
                  value={line.channel}
                  onChange={(e) => updatePaymentLine(idx, "channel", e.target.value)}
                />
                <button type="button" className="btn-danger btn-sm" onClick={() => removePaymentLine(idx)}>
                  Remove
                </button>
              </div>
            ))}
            <div className="pos-action-row">
              <button type="button" className="btn-secondary btn-sm" onClick={addPaymentLine}>
                + Add Payment Line
              </button>
              <span className="pos-inline-note">Split Paid: {formatBDT(splitPaidTotal)}</span>
            </div>
          </div>
        )}

        <div className="pos-receipt-row">
          <label>
            Receipt:
            <select
              value={paperSize}
              onChange={(e) => setPaperSize(e.target.value)}
              className="pos-receipt-size"
            >
              <option value="58">58mm</option>
              <option value="80">80mm</option>
            </select>
          </label>
        </div>
        <div className="pos-action-row">
          <button type="button" onClick={() => setShowStoreSettings((prev) => !prev)}>
            {showStoreSettings ? "Hide" : "Show"} Invoice Settings
          </button>
          <button type="button" className="btn-secondary" onClick={handleTestPrint}>
            Test Print
          </button>
          <button type="button" className="btn-secondary" onClick={handleTestPreview}>
            Preview
          </button>
        </div>
        {showStoreSettings && (
          <div className="pos-settings-box">
            <input
              placeholder="Store name"
              value={storeSettings.storeName}
              onChange={(e) =>
                setStoreSettings((prev) => ({ ...prev, storeName: e.target.value }))
              }
            />
            <input
              placeholder="Store address"
              value={storeSettings.storeAddress}
              onChange={(e) =>
                setStoreSettings((prev) => ({ ...prev, storeAddress: e.target.value }))
              }
            />
            <input
              placeholder="Store phone"
              value={storeSettings.storePhone}
              onChange={(e) =>
                setStoreSettings((prev) => ({ ...prev, storePhone: e.target.value }))
              }
            />
            <input
              placeholder="Footer message"
              value={storeSettings.footerMessage}
              onChange={(e) =>
                setStoreSettings((prev) => ({ ...prev, footerMessage: e.target.value }))
              }
            />
            <select
              value={storeSettings.receiptLanguage || "en"}
              onChange={(e) =>
                setStoreSettings((prev) => ({ ...prev, receiptLanguage: e.target.value }))
              }
            >
              <option value="en">Receipt Language: English</option>
              <option value="bn">Receipt Language: Bangla</option>
            </select>
            <input type="file" accept="image/*" onChange={handleLogoChange} />
            {storeSettings.logoDataUrl ? (
              <div className="pos-logo-preview">
                <img
                  src={storeSettings.logoDataUrl}
                  alt="Invoice Logo Preview"
                  className="pos-logo-image"
                />
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => setStoreSettings((prev) => ({ ...prev, logoDataUrl: "" }))}
                >
                  Remove Logo
                </button>
              </div>
            ) : null}
          </div>
        )}

        <input
          placeholder="Hold note (optional)"
          value={holdNote}
          onChange={(e) => setHoldNote(e.target.value)}
        />
        <input
          placeholder="Quote note (optional — for Save quote)"
          value={quoteNote}
          onChange={(e) => setQuoteNote(e.target.value)}
        />

        <input
          type="number"
          placeholder="Paid amount"
          value={paidAmount}
          onChange={(e) => setPaidAmount(e.target.value)}
        />

        <input
          placeholder="Customer name (optional, needed for loyalty)"
          value={customer.name}
          onChange={(e) => setCustomer({ ...customer, name: e.target.value })}
        />
        <input
          placeholder="Customer phone (optional)"
          value={customer.phone}
          onChange={(e) => setCustomer({ ...customer, phone: e.target.value })}
        />
        {customerLoyalty ? (
          <div className="page-card">
            <p><strong>Loyalty Tier:</strong> {customerLoyalty.loyaltyTier}</p>
            <p><strong>Available Points:</strong> {Number(customerLoyalty.loyaltyPoints || 0).toFixed(0)}</p>
            <p><strong>Tier Discount:</strong> {tierDiscountPercent}% ({formatBDT(tierDiscountAmount)})</p>
            <p><strong>Max Redeem (20% rule):</strong> {maxRedeemByPercentPoints.toFixed(0)} points</p>
            <input
              type="number"
              placeholder="Redeem points"
              value={redeemPoints}
              onChange={(e) => setRedeemPoints(e.target.value)}
            />
            <p>Redeem Discount: {formatBDT(redeemDiscountAmount)}</p>
            {safeRedeemPoints > appliedRedeemPoints ? (
              <p className="pos-inline-note">Requested redeem adjusted to allowed limit.</p>
            ) : null}
            {creditLimitVal > 0 ? (
              <>
                <p><strong>Credit limit:</strong> {formatBDT(creditLimitVal)} · <strong>Current due:</strong> {formatBDT(customerBalance)}</p>
                {checkoutDue > 0 ? (
                  <p>
                    <strong>After this bill:</strong> {formatBDT(customerBalance + checkoutDue)}
                    {creditWouldExceed ? (
                      <span style={{ color: "#b91c1c", marginLeft: 8 }}>Over limit — manager PIN required at checkout.</span>
                    ) : null}
                  </p>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
        {managerApprovalNeeded ? (
          <input
            placeholder="Manager Approval PIN"
            value={managerApprovalPin}
            onChange={(e) => setManagerApprovalPin(e.target.value)}
          />
        ) : null}
        {checkoutDue > 0 ? <p>Due: {formatBDT(checkoutDue)}</p> : null}
        {activeHoldAuditLogId != null ? (
          <p className="pos-inline-note">Checkout will close held cart #{activeHoldAuditLogId}.</p>
        ) : null}
        {activeQuoteAuditLogId != null ? (
          <p className="pos-inline-note">Checkout will mark quotation #{activeQuoteAuditLogId} as converted.</p>
        ) : null}
        <button className="btn-secondary" disabled={cart.length === 0} onClick={handleHoldCart}>
          Hold Sale
        </button>
        <button type="button" className="btn-secondary" disabled={cart.length === 0} onClick={handleSaveQuote}>
          Save quote
        </button>
        <button disabled={cart.length === 0} onClick={handleCheckout}>
          Checkout
        </button>

        <hr />
        <h4>Recent Sales</h4>
        <p className="pos-inline-note">
          Shortcuts: F2 = Checkout, F4 = Print last invoice, F6 = Hold sale, F7 = Toggle held carts
        </p>
        {recentSales.slice(0, 5).map((sale) => (
          <div key={sale.id} className="pos-recent-sale-row">
            {sale.invoiceNo} — {formatBDT(sale.total)} ({sale.paymentMethod})
            <button className="btn-secondary btn-sm" onClick={() => printInvoice(sale.id)}>
              Print
            </button>
            <button className="btn-secondary btn-sm" onClick={() => handleSalePreview(sale.id)}>
              Preview
            </button>
          </div>
        ))}
        {showHeldPanel ? (
          <div className="page-card" style={{ marginTop: 10 }}>
            <h4>Held Carts</h4>
            <input
              placeholder="Search held cart by customer/phone/note"
              value={holdSearch}
              onChange={(e) => setHoldSearch(e.target.value)}
            />
            <DataTable
              rows={heldCarts.map((row) => ({
                ...row,
                createdAtLabel: new Date(row.createdAt).toLocaleString(),
              }))}
              pageSize={5}
              allowExport={false}
              columns={[
                { key: "id", label: "ID" },
                { key: "heldByName", label: "Held By", render: (v) => v || "-" },
                { key: "customerName", label: "Customer", render: (v) => v || "-" },
                { key: "customerPhone", label: "Phone", render: (v) => v || "-" },
                { key: "cartCount", label: "Items" },
                { key: "totalQty", label: "Qty" },
                { key: "holdNote", label: "Note", render: (v) => v || "-" },
                { key: "createdAtLabel", label: "Held At" },
                {
                  key: "actions",
                  label: "Actions",
                  render: (_, row) => (
                    <div style={{ display: "flex", gap: 6 }}>
                      <button type="button" className="btn-secondary btn-sm" onClick={() => resumeHeldCart(row)}>
                        Resume
                      </button>
                      <button type="button" className="btn-danger btn-sm" onClick={() => discardHeldCart(row)}>
                        Discard
                      </button>
                    </div>
                  ),
                },
              ]}
            />
          </div>
        ) : null}
        <DataTable
          title="Offline Sync Queue"
          rows={offlineQueue.map((q, idx) => ({
            rowNo: idx + 1,
            ...q,
            createdAtLabel: new Date(q.createdAt).toLocaleString(),
            updatedAtLabel: new Date(q.updatedAt || q.createdAt).toLocaleString(),
          }))}
          pageSize={5}
          allowExport={false}
          columns={[
            { key: "rowNo", label: "ID" },
            { key: "localRef", label: "Local Ref" },
            { key: "status", label: "Status" },
            { key: "retryCount", label: "Retries", render: (v) => Number(v || 0) },
            { key: "lastError", label: "Last Error", render: (v) => v || "-" },
            { key: "createdAtLabel", label: "Queued At" },
            {
              key: "actions",
              label: "Actions",
              render: (_, row) => (
                <div style={{ display: "flex", gap: 6 }}>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => retryQueuedSale(row)}>
                    Retry
                  </button>
                  <button
                    type="button"
                    className="btn-danger btn-sm"
                    disabled={!canDiscardOfflineQueue}
                    onClick={() => discardQueuedSale(row)}
                  >
                    Discard
                  </button>
                </div>
              ),
            },
          ]}
        />
        <DataTable
          title="Offline Sync Log"
          rows={offlineLog.map((x, idx) => ({ rowNo: idx + 1, ...x, createdAtLabel: new Date(x.createdAt).toLocaleString() }))}
          pageSize={5}
          allowExport={false}
          columns={[
            { key: "rowNo", label: "ID" },
            { key: "type", label: "Type" },
            { key: "localRef", label: "Local Ref", render: (v) => v || "-" },
            { key: "message", label: "Message" },
            { key: "createdAtLabel", label: "Time" },
          ]}
        />
      </div>
      <ManagerPinModal
        open={pinModal.open}
        title={pinModal.title}
        message={pinModal.message}
        onConfirm={(p) => confirmPinModal(p)}
        onClose={closePinModal}
      />
      {quoteLoadNotice ? <div className="pos-success-toast">{quoteLoadNotice}</div> : null}
      {showPreview && (
        <div className="pos-preview-overlay">
          <div className="pos-preview-modal">
            <div className="pos-preview-actions">
              <button type="button" onClick={() => setShowPreview(false)}>
                Close Preview
              </button>
            </div>
            <iframe
              title="Receipt Preview"
              srcDoc={previewHtml}
              className="pos-preview-frame"
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default POS;