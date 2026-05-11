import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Select from "react-select";
import api from "../services/api";
import socket from "../services/socket";
import {
  CUSTOMER_DISPLAY_STATUS,
  openCustomerDisplayWindow,
  publishCustomerDisplayCleared,
  publishCustomerDisplayCompleted,
  publishCustomerDisplayState,
} from "../services/customerDisplay";
import { downloadMushak63XmlWithCompletenessHint } from "../services/nbrMushak63";
import { getLang, t } from "../i18n";
import DataTable from "../components/DataTable";
import ManagerPinModal from "../components/ManagerPinModal";
import { getStoredPermissions, hasAnyPermission } from "../utils/permissions";
import { createSearchSelectStyles } from "../utils/selectStyles";
import {
  consumeGlobalSubmitError,
  notifyActionRequired,
  notifyError,
  notifyPermissionRequired,
  notifySuccess,
} from "../utils/notify";
import { formatBDT as formatBdtBd } from "../utils/currency";

const OFFLINE_QUEUE_KEY = "bd_pos_offline_queue_v1";
const OFFLINE_LOG_KEY = "bd_pos_offline_log_v1";
const OFFLINE_SYNC_LOCK_KEY = "bd_pos_offline_sync_lock_v1";
const OFFLINE_DISCARD_PIN_KEY = "bd_pos_manager_pin";
const CART_TEMPLATE_KEY = "bd_pos_cart_templates_v1";
const PRODUCTS_OFFLINE_CACHE_KEY = "bd_pos_products_offline_cache_v1";
const PRICE_OVERRIDE_APPROVAL_PERCENT = 5;
const PRICE_OVERRIDE_APPROVAL_AMOUNT = 50;
const DIGITAL_METHODS = new Set(["bKash", "Nagad", "Rocket", "Card"]);
const SEARCH_SELECT_STYLES = createSearchSelectStyles(34);

const EMPTY_POS_SUMMARY = {
  totalSales: 0,
  totalPaid: 0,
  totalDue: 0,
  totalVat: 0,
  billCount: 0,
};

function newCartLineId() {
  return `cl-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function getBillingUnitsForItem(item) {
  if (item.sellByWeight) return Math.max(0, Number(item.weightKg || 0));
  return Math.max(0, Number(item.qty || 0));
}

function getCartLineBaseUnitPrice(item) {
  if (
    item.variantId &&
    item.matchedVariant &&
    item.matchedVariant.priceOverride != null &&
    item.matchedVariant.priceOverride !== ""
  ) {
    return Number(item.matchedVariant.priceOverride);
  }
  if (item.tierPriceResolved != null && item.tierPriceResolved !== "") {
    return Number(item.tierPriceResolved);
  }
  return Number(item.price || 0);
}

function resolveTierPrice(product, tier = "RETAIL", asOf = new Date()) {
  const list = Array.isArray(product?.priceLists) ? product.priceLists : [];
  const target = String(tier || "RETAIL").toUpperCase();
  const date = asOf instanceof Date ? asOf : new Date(asOf);
  const active = list
    .filter((r) => String(r?.priceType || "").toUpperCase() === target)
    .filter((r) => {
      const from = r?.effectiveFrom ? new Date(r.effectiveFrom) : null;
      const to = r?.effectiveTo ? new Date(r.effectiveTo) : null;
      if (!from || Number.isNaN(from.getTime())) return false;
      if (date < from) return false;
      if (to && !Number.isNaN(to.getTime()) && date > to) return false;
      return true;
    })
    .sort((a, b) => new Date(b.effectiveFrom).getTime() - new Date(a.effectiveFrom).getTime());
  if (!active.length) return null;
  return Number(active[0].amount || 0);
}

function maxQtyOrWeightForCartLine(item) {
  if (item.sellByWeight) return Math.max(0, Number(item.stockKg || 0));
  if (item.variantId && item.matchedVariant) return Math.max(0, Number(item.matchedVariant.stock || 0));
  return Math.max(0, Number(item.stock || 0));
}

function parseVariantAttributes(label) {
  const text = String(label || "").trim();
  if (!text) return { size: "", color: "", others: [] };
  const parts = text
    .split(/[|,;/]/)
    .map((x) => x.trim())
    .filter(Boolean);
  let size = "";
  let color = "";
  const others = [];
  for (const part of parts) {
    const m = part.match(/^([a-zA-Z ]+)\s*[:=-]\s*(.+)$/);
    if (!m) continue;
    const rawKey = m[1].trim();
    const key = rawKey.toLowerCase();
    const val = m[2].trim();
    if (!val) continue;
    if (!size && key.includes("size")) size = val;
    else if (!color && (key.includes("color") || key.includes("colour"))) color = val;
    else others.push(`${rawKey}: ${val}`);
  }
  return { size, color, others };
}

function joinVariantMetaParts({
  size = "",
  color = "",
  others = [],
  sku = "",
  barcode = "",
  includeFallbackSizeColor = false,
}) {
  const ordered = [];
  if (size) ordered.push(`Size: ${size}`);
  else if (includeFallbackSizeColor) ordered.push("Size: -");
  if (color) ordered.push(`Color: ${color}`);
  else if (includeFallbackSizeColor) ordered.push("Color: -");
  for (const x of others) ordered.push(x);
  if (sku) ordered.push(`SKU: ${sku}`);
  if (barcode) ordered.push(`Barcode: ${barcode}`);
  return Array.from(new Set(ordered.filter(Boolean))).join(" • ");
}

function getVariantDisplayMeta(variant) {
  if (!variant) return "";
  const parsed = parseVariantAttributes(variant.label);
  return joinVariantMetaParts({
    ...parsed,
    sku: variant.sku || "",
    barcode: variant.barcode || "",
    includeFallbackSizeColor: true,
  });
}

function getVariantMetaFromLine(line) {
  if (!line) return "";
  const fromVariantLabel = parseVariantAttributes(line.variantLabel || "");
  const fromLineLabel = parseVariantAttributes(line.label || "");
  const hasVariantSignal = Boolean(
    String(line.variantLabel || "").trim() ||
      line.variantSku ||
      line.variantBarcode ||
      Number(line.productVariantId || 0) > 0
  );
  return joinVariantMetaParts({
    size: fromVariantLabel.size || fromLineLabel.size,
    color: fromVariantLabel.color || fromLineLabel.color,
    others: [...fromVariantLabel.others, ...fromLineLabel.others],
    sku: line.variantSku || "",
    barcode: line.variantBarcode || "",
    includeFallbackSizeColor: hasVariantSignal,
  });
}

function getVariantMetaFromSaleItem(item) {
  if (!item) return "";
  if (item.productVariant) return getVariantDisplayMeta(item.productVariant);
  return getVariantMetaFromLine(item);
}

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
  const permissions = getStoredPermissions();
  const currentUser = readJsonStorage("bd_pos_user", null);
  const currentUserRole = String(currentUser?.roleName || "").toLowerCase();
  const canManageSettings = hasAnyPermission(["branch.manage", "rbac.manage"], permissions);
  const canDiscardOfflineQueue =
    canManageSettings || currentUserRole === "admin";
  const defaultStoreSettings = {
    storeName: "BD Smart POS",
    storeAddress: "Dhaka, Bangladesh",
    storePhone: "",
    footerMessage: "Thank you",
    logoDataUrl: "",
    receiptLanguage: localStorage.getItem("bd_pos_lang") || "en",
  };
  const [productSearch, setProductSearch] = useState("");
  const [cart, setCart] = useState([]);
  const [variantChoiceByProduct, setVariantChoiceByProduct] = useState({});
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [priceTier, setPriceTier] = useState("RETAIL");
  const [paidAmount, setPaidAmount] = useState("");
  const [paymentBreakdown, setPaymentBreakdown] = useState([{ method: "Cash", amount: "", channel: "" }]);
  const [discountType, setDiscountType] = useState("AMOUNT");
  const [discountValue, setDiscountValue] = useState("0");
  const [managerApprovalPin, setManagerApprovalPin] = useState("");
  const [approvalReason, setApprovalReason] = useState("");
  const [paymentChannel, setPaymentChannel] = useState("");
  const [customer, setCustomer] = useState({
    name: "",
    phone: "",
  });
  const [buyerBinOrNidNote, setBuyerBinOrNidNote] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [giftCardCode, setGiftCardCode] = useState("");
  const [giftCardAmount, setGiftCardAmount] = useState("");
  const [walletRedeemAmount, setWalletRedeemAmount] = useState("");
  const [debouncedCustomerPhone, setDebouncedCustomerPhone] = useState("");
  const [expandedHistorySaleId, setExpandedHistorySaleId] = useState(null);
  const [redeemPoints, setRedeemPoints] = useState("");
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
  const [offlineConflictFilter, setOfflineConflictFilter] = useState("ALL");
  const [offlineStatusFilter, setOfflineStatusFilter] = useState("ALL");
  const [bulkConflictTag, setBulkConflictTag] = useState("");
  const [holdSearch, setHoldSearch] = useState("");
  const [holdNote, setHoldNote] = useState("");
  const [showHeldPanel, setShowHeldPanel] = useState(false);
  const [posProductsTab, setPosProductsTab] = useState("catalog");
  const [posCartTab, setPosCartTab] = useState("payment");
  const [activeHoldAuditLogId, setActiveHoldAuditLogId] = useState(null);
  const [activeQuoteAuditLogId, setActiveQuoteAuditLogId] = useState(null);
  const [quoteLoadNotice, setQuoteLoadNotice] = useState("");
  const [quoteNote, setQuoteNote] = useState("");
  const [cartTemplateName, setCartTemplateName] = useState("");
  const [cartTemplates, setCartTemplates] = useState(() => readJsonStorage(CART_TEMPLATE_KEY, []));
  const [pinModal, setPinModal] = useState({ open: false, title: "", message: "" });
  const pinResolveRef = useRef(null);
  const barcodeInputRef = useRef(null);

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

  const queryClient = useQueryClient();
  const invalidatePosQueries = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["pos"] });
  }, [queryClient]);

  const { data: products = [] } = useQuery({
    queryKey: ["pos", "products"],
    queryFn: async () => {
      try {
        const res = await api.get("/products?include=variants,pricelists");
        if (Array.isArray(res.data)) {
          writeJsonStorage(PRODUCTS_OFFLINE_CACHE_KEY, {
            data: res.data,
            cachedAt: Date.now(),
          });
        }
        return res.data;
      } catch (error) {
        const cached = readJsonStorage(PRODUCTS_OFFLINE_CACHE_KEY, null);
        if (cached && Array.isArray(cached.data)) return cached.data;
        throw error;
      }
    },
    initialData: () => {
      const cached = readJsonStorage(PRODUCTS_OFFLINE_CACHE_KEY, null);
      if (cached && Array.isArray(cached.data)) return cached.data;
      return undefined;
    },
    staleTime: 15_000,
  });

  const { data: summary = EMPTY_POS_SUMMARY } = useQuery({
    queryKey: ["pos", "summary", "today"],
    queryFn: async () => (await api.get("/sales/summary/today")).data,
    staleTime: 10_000,
  });

  const { data: recentSales = [] } = useQuery({
    queryKey: ["pos", "sales", "recent"],
    queryFn: async () => (await api.get("/sales/recent")).data,
    staleTime: 10_000,
  });

  const { data: promotionRules = [] } = useQuery({
    queryKey: ["pos", "promotions"],
    queryFn: async () => {
      try {
        const res = await api.get("/promotions");
        return Array.isArray(res.data) ? res.data : [];
      } catch {
        return [];
      }
    },
    staleTime: 60_000,
  });

  const { data: heldCarts = [] } = useQuery({
    queryKey: ["pos", "holds", holdSearch],
    queryFn: async () => {
      const q = holdSearch ? `?q=${encodeURIComponent(holdSearch)}` : "";
      const res = await api.get(`/sales/holds${q}`);
      return res.data || [];
    },
    staleTime: 5_000,
  });

  const branchIdForFiscal = typeof window !== "undefined" ? localStorage.getItem("bd_pos_branch_id") || "1" : "1";
  const { data: fiscalGateData } = useQuery({
    queryKey: ["fiscal-gate", branchIdForFiscal],
    queryFn: async () => (await api.get("/fiscal/fiscal-period-status")).data,
    staleTime: 45_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
  const fiscalBlocked = Boolean(fiscalGateData && fiscalGateData.ok === false);

  const customerPhoneReady = debouncedCustomerPhone.length >= 6;

  const { data: customerLoyaltyData, isSuccess: loyaltyLookupOk } = useQuery({
    queryKey: ["pos", "customer-lookup", debouncedCustomerPhone],
    queryFn: async () => (await api.get(`/master/customers/lookup?phone=${encodeURIComponent(debouncedCustomerPhone)}`)).data,
    enabled: customerPhoneReady,
    staleTime: 30_000,
  });

  const {
    data: customerRecentSalesData,
    isFetching: customerHistoryLoading,
    isSuccess: recentSalesOk,
  } = useQuery({
    queryKey: ["pos", "customer-recent-sales", debouncedCustomerPhone],
    queryFn: async () => {
      const res = await api.get(
        `/sales/customer/recent-sales?phone=${encodeURIComponent(debouncedCustomerPhone)}&limit=10`
      );
      return Array.isArray(res.data) ? res.data : [];
    },
    enabled: customerPhoneReady,
    staleTime: 15_000,
  });

  const customerLoyalty = customerPhoneReady && loyaltyLookupOk ? customerLoyaltyData ?? null : null;
  const customerRecentSales = customerPhoneReady && recentSalesOk ? customerRecentSalesData ?? [] : [];

  const receiptLanguage = storeSettings.receiptLanguage === "bn" ? "bn" : "en";
  const receiptLocale = receiptLanguage === "bn" ? "bn-BD" : "en-US";
  const formatBDT = (value) =>
    formatBdtBd(value, { lang: receiptLanguage, decimals: 2 });
  const filteredProducts = useMemo(() => {
    const q = String(productSearch || "").trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => {
      const variantBlob = (p.variants || [])
        .map((v) => [v.label, v.sku, v.barcode].filter(Boolean).join(" "))
        .join(" ");
      const haystack = [p.name, p.sku, p.category, variantBlob]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [products, productSearch]);
  const formatBnDateTime = (value) =>
    new Date(value).toLocaleString(receiptLocale, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  const receiptText = useMemo(
    () => ({
      invoice: t(receiptLanguage, "receiptInvoice"),
      date: t(receiptLanguage, "receiptDate"),
      payment: t(receiptLanguage, "receiptPayment"),
      customer: t(receiptLanguage, "receiptCustomer"),
      walkInCustomer: t(receiptLanguage, "receiptWalkIn"),
      item: t(receiptLanguage, "receiptItem"),
      qty: t(receiptLanguage, "receiptQty"),
      rate: t(receiptLanguage, "receiptRate"),
      amount: t(receiptLanguage, "receiptAmount"),
      subTotal: t(receiptLanguage, "receiptSubTotal"),
      vat: t(receiptLanguage, "receiptVat"),
      discount: t(receiptLanguage, "receiptDiscount"),
      total: t(receiptLanguage, "receiptTotal"),
      paid: t(receiptLanguage, "receiptPaid"),
      due: t(receiptLanguage, "receiptDue"),
    }),
    [receiptLanguage]
  );

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
        title: title || tt("posPinManagerApproval"),
        message: message || "",
      });
    });

  const confirmPinModal = (pin) => {
    setPinModal((m) => ({ ...m, open: false }));
    const r = pinResolveRef.current;
    pinResolveRef.current = null;
    r?.(pin);
  };

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
    cart: cart.map((item) => ({
      id: item.id,
      qty: Number(item.qty ?? 1),
      ...(Number(item.variantId || 0) ? { variantId: Number(item.variantId) } : {}),
      ...(item.sellByWeight ? { weightKg: Number(item.weightKg || 0) } : {}),
      overridePrice: item.overridePrice,
    })),
    paymentMethod,
    paymentChannel,
    paidAmount: checkoutPaidAmount,
    paymentBreakdown: useSplitPayment ? paymentBreakdown : [],
    customer,
    buyerBinOrNidNote: buyerBinOrNidNote.trim(),
    couponCode: couponCode.trim(),
    giftCardRedemptions: giftCardCode.trim()
      ? [
          {
            code: giftCardCode.trim(),
            ...(giftCardAmount !== "" && giftCardAmount != null
              ? { amount: Number(giftCardAmount) }
              : {}),
          },
        ]
      : [],
    walletRedeemAmount: Number(walletRedeemAmount || 0),
    discountType,
    discountValue: Number(discountValue || 0),
    managerApprovalPin,
    approvalReason,
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
      invalidatePosQueries();
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
      queryClient.setQueryData(["pos", "products"], updatedProducts);
    };
    const onSaleCreated = (sale) => {
      queryClient.setQueryData(["pos", "sales", "recent"], (prev) => {
        const old = Array.isArray(prev) ? prev : [];
        return [sale, ...old].slice(0, 20);
      });
      setLastSaleId(sale.id);
      queryClient.invalidateQueries({ queryKey: ["pos", "summary", "today"] });
    };

    socket.on("product:stock-updated", onStockUpdated);
    socket.on("sale:created", onSaleCreated);

    return () => {
      socket.off("product:stock-updated", onStockUpdated);
      socket.off("sale:created", onSaleCreated);
    };
  }, [queryClient]);

  useEffect(() => {
    if (!cart.some((item) => !item.lineId)) return;
    setCart((prev) => prev.map((x) => (x.lineId ? x : { ...x, lineId: newCartLineId() })));
  }, [cart]);

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

  const mergeCartLineKey = (line) =>
    `${line.id}|${line.variantId || ""}|${line.sellByWeight ? "w" : ""}`;

  const addToCart = (product, opts = {}) => {
    const selectedVariantId =
      opts.variantId != null && opts.variantId !== ""
        ? Number(opts.variantId)
        : null;
    const scannedVariant = product.matchedVariant || null;
    const variantId = scannedVariant?.id ?? selectedVariantId ?? null;

    if (product.hasVariants && !variantId) {
      notifyActionRequired(tt("posNotifyVariantScanTile"));
      return;
    }
    if (product.sellByWeight && variantId) {
      return;
    }

    let matchedVariant = scannedVariant;
    if (variantId && product.variants && !matchedVariant) {
      const vhit = product.variants.find((v) => Number(v.id) === Number(variantId));
      matchedVariant = vhit
        ? {
            id: vhit.id,
            label: vhit.label,
            sku: vhit.sku,
            barcode: vhit.barcode,
            stock: vhit.stock,
            priceOverride: vhit.priceOverride,
          }
        : null;
    }
    if (product.hasVariants && (!matchedVariant || !matchedVariant.id)) {
      notifyError(tt("posNotifyVariantUnavailable"));
      return;
    }

    const { variants: _omitVariants, matchedVariant: _omitMv, ...productBase } = product;

    if (product.hasVariants && matchedVariant.stock <= 0) {
      return;
    }
    if (!product.hasVariants && !product.sellByWeight && product.stock <= 0) {
      return;
    }
    if (product.sellByWeight && Number(product.stockKg || 0) <= 0) {
      return;
    }

    const newLine = {
      ...productBase,
      lineId: newCartLineId(),
      qty: product.sellByWeight ? 1 : 1,
      weightKg: product.sellByWeight ? Math.min(1, Math.max(0.001, Number(product.stockKg || 1))) : undefined,
      variantId,
      matchedVariant,
      selectedPriceTier: priceTier,
      tierPriceResolved:
        matchedVariant && matchedVariant.priceOverride != null && matchedVariant.priceOverride !== ""
          ? null
          : resolveTierPrice(product, priceTier, new Date()),
      originalBasePrice: Number(product.price || 0),
      overridePrice: "",
    };

    setCart((prev) => {
      if (newLine.sellByWeight) {
        return [...prev, newLine];
      }
      const key = mergeCartLineKey(newLine);
      const idx = prev.findIndex((item) => mergeCartLineKey(item) === key);
      if (idx === -1) {
        return [...prev, newLine];
      }
      const existing = prev[idx];
      const cap = maxQtyOrWeightForCartLine(existing);
      if (existing.qty >= cap) {
        return prev;
      }
      return prev.map((item, i) =>
        i === idx ? { ...item, qty: Math.min(Number(item.qty || 1) + 1, cap) } : item
      );
    });
  };

  const applyPriceTierToCart = useCallback(
    (tier) => {
      const normalizedTier = ["RETAIL", "WHOLESALE", "DEALER"].includes(String(tier || "").toUpperCase())
        ? String(tier).toUpperCase()
        : "RETAIL";
      setCart((prev) =>
        prev.map((item) => {
          if (item.variantId && item.matchedVariant && item.matchedVariant.priceOverride != null && item.matchedVariant.priceOverride !== "") {
            return { ...item, selectedPriceTier: normalizedTier, tierPriceResolved: null };
          }
          const resolved = resolveTierPrice(item, normalizedTier, new Date());
          return {
            ...item,
            selectedPriceTier: normalizedTier,
            tierPriceResolved: resolved,
          };
        })
      );
    },
    [setCart]
  );

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
      notifyError(error.response?.data?.error || tt("posNotifyProductNotFound"));
      barcodeInputRef.current?.focus();
    }
  };

  const updateQty = (lineId, qty) => {
    setCart((prev) =>
      prev.map((item) => {
        if (item.lineId !== lineId) return item;
        if (item.sellByWeight) return item;
        const nextQty = Math.max(1, Number(qty || 1));
        const cap = maxQtyOrWeightForCartLine(item);
        return { ...item, qty: Math.min(nextQty, cap) };
      })
    );
  };

  const updateWeightKgLine = (lineId, kg) => {
    setCart((prev) =>
      prev.map((item) => {
        if (item.lineId !== lineId || !item.sellByWeight) return item;
        const cap = maxQtyOrWeightForCartLine(item);
        const next = Math.min(Math.max(Number(kg) || 0, 0.001), cap > 0 ? cap : 99999);
        return { ...item, weightKg: next };
      })
    );
  };

  const updateOverridePrice = (lineId, value) => {
    setCart((prev) =>
      prev.map((item) => (item.lineId === lineId ? { ...item, overridePrice: value } : item))
    );
  };

  const resetOverridePrice = (lineId) => {
    setCart((prev) =>
      prev.map((item) => (item.lineId === lineId ? { ...item, overridePrice: "" } : item))
    );
  };

  const removeItem = (lineId) => {
    setCart((prev) => prev.filter((item) => item.lineId !== lineId));
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
    const base = getCartLineBaseUnitPrice(item);
    const hasOverride = raw !== undefined && raw !== null && String(raw).trim() !== "";
    if (!hasOverride) return base;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return base;
    return parsed;
  };

  const priceOverrideSummary = cart.reduce(
    (acc, item) => {
      const base = getCartLineBaseUnitPrice(item);
      const unit = getUnitSellPrice(item);
      const reductionPerUnit = Math.max(0, base - unit);
      const reductionPercent = base > 0 ? (reductionPerUnit / base) * 100 : 0;
      if (reductionPerUnit > 0) {
        acc.totalReduction += reductionPerUnit * getBillingUnitsForItem(item);
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
    (sum, item) => sum + getUnitSellPrice(item) * getBillingUnitsForItem(item),
    0,
  );
  const predefinedDiscount = cart.reduce((sum, item) => {
    const unit = getUnitSellPrice(item);
    const perUnit = Math.min(unit, getPerUnitPredefinedDiscount(item));
    return sum + perUnit * getBillingUnitsForItem(item);
  }, 0);
  const subTotal = Math.max(0, grossSubTotal - predefinedDiscount);
  const now = new Date();
  const activePromotionRules = promotionRules.filter((rule) => {
    if (!rule?.isActive) return false;
    if (rule.startsAt && new Date(rule.startsAt) > now) return false;
    if (rule.endsAt && new Date(rule.endsAt) < now) return false;
    return true;
  });
  const productQtyMap = new Map();
  cart.forEach((item) => {
    const pid = Number(item.id);
    const bill = getBillingUnitsForItem(item);
    productQtyMap.set(pid, (productQtyMap.get(pid) || 0) + bill);
  });
  const promotionEstimate = activePromotionRules.reduce(
    (acc, rule) => {
      if (rule.type === "CART_PERCENT") {
        const minBasket = Number(rule.minBasketAmount || 0);
        const pct = Number(rule.discountValue || 0);
        if (pct > 0 && subTotal >= minBasket) {
          const amount = (subTotal * pct) / 100;
          if (amount > 0) {
            acc.total += amount;
            acc.applied.push({ id: rule.id, name: rule.name, amount });
          }
        }
        return acc;
      }
      if (rule.type === "CATEGORY_PERCENT") {
        const pct = Number(rule.discountValue || 0);
        const category = String(rule.category || "").trim().toLowerCase();
        if (pct <= 0 || !category) return acc;
        const categorySubtotal = cart.reduce((sum, item) => {
          if (String(item.category || "").trim().toLowerCase() !== category) return sum;
          return sum + getUnitSellPrice(item) * getBillingUnitsForItem(item);
        }, 0);
        if (categorySubtotal > 0) {
          const amount = (categorySubtotal * pct) / 100;
          if (amount > 0) {
            acc.total += amount;
            acc.applied.push({ id: rule.id, name: rule.name, amount });
          }
        }
        return acc;
      }
      if (rule.type === "BOGO_PRODUCT") {
        const productId = Number(rule.productId || 0);
        const buyQty = Math.max(1, Number(rule.buyQty || 1));
        const getQty = Math.max(1, Number(rule.getQty || 1));
        const qty = Number(productQtyMap.get(productId) || 0);
        const row = cart.find((x) => Number(x.id) === productId);
        if (!row || qty < buyQty) return acc;
        const freeQty = Math.floor(qty / buyQty) * getQty;
        const amount = Math.max(0, Math.min(qty, freeQty) * getUnitSellPrice(row));
        if (amount > 0) {
          acc.total += amount;
          acc.applied.push({ id: rule.id, name: rule.name, amount });
        }
        return acc;
      }
      if (rule.type === "BUNDLE_FIXED") {
        const bundlePrice = Number(rule.bundlePrice || rule.discountValue || 0);
        const ids = String(rule.bundleProductIds || "")
          .split(",")
          .map((x) => Number(x.trim()))
          .filter((x) => !Number.isNaN(x) && x > 0);
        if (ids.length < 2 || bundlePrice <= 0) return acc;
        const bundleCount = ids.reduce((minV, pid) => {
          const bill = Number(productQtyMap.get(pid) || 0);
          return Math.min(minV, Math.floor(bill + 1e-9));
        }, Number.MAX_SAFE_INTEGER);
        if (!Number.isFinite(bundleCount) || bundleCount <= 0) return acc;
        const regular = ids.reduce((sum, pid) => {
          const row = cart.find((x) => Number(x.id) === pid);
          return sum + (row ? getUnitSellPrice(row) : 0);
        }, 0);
        const amount = Math.max(0, (regular - bundlePrice) * bundleCount);
        if (amount > 0) {
          acc.total += amount;
          acc.applied.push({ id: rule.id, name: rule.name, amount });
        }
        return acc;
      }
      if (rule.type === "CATEGORY_BUNDLE_FIXED") {
        const bundleSize = Math.max(2, Number(rule.buyQty || 2));
        const bundlePrice = Number(rule.bundlePrice || rule.discountValue || 0);
        const category = String(rule.category || "").trim().toLowerCase();
        if (!category || bundlePrice <= 0) return acc;
        const unitPrices = [];
        cart.forEach((row) => {
          if (String(row.category || "").trim().toLowerCase() !== category) return;
          const unit = getUnitSellPrice(row);
          const slots = Math.max(0, Math.floor(getBillingUnitsForItem(row) + 1e-9));
          for (let i = 0; i < slots; i += 1) unitPrices.push(unit);
        });
        if (unitPrices.length < bundleSize) return acc;
        unitPrices.sort((a, b) => b - a);
        const bundleCount = Math.floor(unitPrices.length / bundleSize);
        let amount = 0;
        for (let i = 0; i < bundleCount; i += 1) {
          const regular = unitPrices.slice(i * bundleSize, (i + 1) * bundleSize).reduce((sum, x) => sum + Number(x || 0), 0);
          if (regular > bundlePrice) amount += regular - bundlePrice;
        }
        if (amount > 0) {
          acc.total += amount;
          acc.applied.push({ id: rule.id, name: rule.name, amount });
        }
      }
      return acc;
    },
    { total: 0, applied: [] },
  );
  const promotionDiscountAmount = Math.min(Math.max(0, promotionEstimate.total), Math.max(0, subTotal));
  const vatAmount = cart.reduce(
    (sum, item) => {
      const unit = getUnitSellPrice(item);
      const perUnit = Math.min(unit, getPerUnitPredefinedDiscount(item));
      const netUnit = Math.max(0, unit - perUnit);
      return sum + ((netUnit * getBillingUnitsForItem(item)) * Number(item.vatRate || 0)) / 100;
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
    predefinedDiscount +
      promotionDiscountAmount +
      Math.max(0, manualDiscountAmount) +
      tierDiscountAmount +
      redeemDiscountAmount
  );
  const total = Math.max(
    0,
    subTotal +
      vatAmount -
      promotionDiscountAmount -
      Math.max(0, manualDiscountAmount) -
      tierDiscountAmount -
      redeemDiscountAmount
  );
  const walletVal = Math.max(0, Number(walletRedeemAmount || 0));
  const giftVal = giftCardCode.trim()
    ? Math.max(0, Number(giftCardAmount === "" ? 0 : giftCardAmount || 0))
    : 0;
  const billAfterWalletGift = Math.max(0, total - walletVal - giftVal);
  const effectivePaid = paidAmount === "" ? billAfterWalletGift : Number(paidAmount);
  const splitPaidTotal = paymentBreakdown.reduce((sum, line) => sum + Number(line.amount || 0), 0);
  const useSplitPayment = paymentMethod === "Split";
  const checkoutPaidAmount = useSplitPayment ? splitPaidTotal : effectivePaid;
  const checkoutDue = Math.max(0, billAfterWalletGift - checkoutPaidAmount);
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
    if (Array.isArray(sale.salePayments) && sale.salePayments.length) {
      return sale.salePayments.map((p) => ({
        method: p.method,
        amount: p.amount,
        channel: p.channel || "",
      }));
    }
    try {
      const payload = JSON.parse(sale.notes || "{}");
      if (Array.isArray(payload.paymentBreakdown)) return payload.paymentBreakdown;
      return [];
    } catch {
      return [];
    }
  };

  const persistCartTemplates = (next) => {
    setCartTemplates(next);
    writeJsonStorage(CART_TEMPLATE_KEY, next);
  };

  const saveCartTemplate = () => {
    if (!cart.length) {
      notifyActionRequired(tt("posNotifyTplCartEmpty"));
      return;
    }
    const name = String(cartTemplateName || "").trim();
    if (!name) {
      notifyActionRequired(tt("posNotifyTplName"));
      return;
    }
    const template = {
      id: `${Date.now()}-${Math.random()}`,
      name,
      createdAt: new Date().toISOString(),
      cart: cart.map((item) => ({
        ...item,
        qty: Number(item.qty || 1),
      })),
    };
    const deduped = cartTemplates.filter((x) => x.name.toLowerCase() !== name.toLowerCase());
    persistCartTemplates([template, ...deduped].slice(0, 30));
    setCartTemplateName("");
  };

  const loadCartTemplate = (template) => {
    if (!Array.isArray(template?.cart) || !template.cart.length) return;
    setCart(template.cart);
    setShowHeldPanel(false);
    barcodeInputRef.current?.focus();
  };

  const deleteCartTemplate = (templateId) => {
    persistCartTemplates(cartTemplates.filter((x) => x.id !== templateId));
  };

  const quickApplyPaymentMode = (mode) => {
    const map = {
      cash: { paymentMethod: "Cash", paymentChannel: "", paidAmount: String(total.toFixed(2)) },
      bkash: { paymentMethod: "bKash", paymentChannel: "bKash", paidAmount: String(total.toFixed(2)) },
      nagad: { paymentMethod: "Nagad", paymentChannel: "Nagad", paidAmount: String(total.toFixed(2)) },
      card: { paymentMethod: "Card", paymentChannel: "Card", paidAmount: String(total.toFixed(2)) },
      due: { paymentMethod: "Due", paymentChannel: "", paidAmount: "0" },
    };
    const preset = map[mode];
    if (!preset) return;
    setPaymentMethod(preset.paymentMethod);
    setPaymentChannel(preset.paymentChannel);
    setPaidAmount(preset.paidAmount);
    if (preset.paymentMethod !== "Split") {
      setPaymentBreakdown([{ method: "Cash", amount: "", channel: "" }]);
    }
  };

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
        setShowHeldPanel((prev) => {
          const next = !prev;
          if (next) setPosCartTab("activity");
          return next;
        });
      }
      if (event.altKey && event.key === "1") {
        event.preventDefault();
        quickApplyPaymentMode("cash");
      }
      if (event.altKey && event.key === "2") {
        event.preventDefault();
        quickApplyPaymentMode("bkash");
      }
      if (event.altKey && event.key === "3") {
        event.preventDefault();
        quickApplyPaymentMode("card");
      }
      if (event.altKey && event.key === "4") {
        event.preventDefault();
        quickApplyPaymentMode("due");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [cart, lastSaleId, holdNote, total]);

  useEffect(() => {
    setExpandedHistorySaleId(null);
  }, [customer.phone]);

  useEffect(() => {
    const phone = String(customer.phone || "").trim();
    if (phone.length < 6) {
      setDebouncedCustomerPhone("");
      return;
    }
    const timer = setTimeout(() => setDebouncedCustomerPhone(phone), 280);
    return () => clearTimeout(timer);
  }, [customer.phone]);

  useEffect(() => {
    if (!customerLoyalty) return;
    const custTier = String(customerLoyalty.priceTier || "RETAIL").toUpperCase();
    if (!["RETAIL", "WHOLESALE", "DEALER"].includes(custTier)) return;
    setPriceTier(custTier);
    applyPriceTierToCart(custTier);
  }, [customerLoyalty?.id, customerLoyalty?.priceTier, applyPriceTierToCart]);

  const handleCheckout = async () => {
    if (fiscalBlocked) {
      notifyActionRequired(fiscalGateData?.message || tt("posNotifyFiscalCheckout"));
      return;
    }
    if (cart.some((x) => x.sellByWeight && !(Number(x.weightKg) > 0))) {
      notifyActionRequired(tt("posNotifyWeightCheckout"));
      return;
    }
    if (paymentMethod !== "Split" && DIGITAL_METHODS.has(paymentMethod) && !String(paymentChannel || "").trim()) {
      notifyActionRequired(tt("posNotifyTxnRef", { method: paymentMethod }));
      return;
    }
    if (paymentMethod === "Split") {
      const missingRef = paymentBreakdown.find(
        (line) => DIGITAL_METHODS.has(String(line.method || "")) && !String(line.channel || "").trim()
      );
      if (missingRef) {
        notifyActionRequired(tt("posNotifyTxnRefSplitLine", { method: missingRef.method }));
        return;
      }
    }
    if (managerApprovalNeeded && !String(approvalReason || "").trim()) {
      notifyActionRequired(tt("posNotifyApprovalReason"));
      return;
    }
    const payload = buildCheckoutPayload();
    try {
      const response = await api.post("/sales/checkout", payload, { skipGlobalErrorToast: true });

      setCart([]);
      setPaidAmount("");
      setDiscountType("AMOUNT");
      setDiscountValue("0");
      setManagerApprovalPin("");
      setApprovalReason("");
      setPaymentChannel("");
      setCustomer({ name: "", phone: "" });
      setPriceTier("RETAIL");
      setBuyerBinOrNidNote("");
      setCouponCode("");
      setGiftCardCode("");
      setGiftCardAmount("");
      setWalletRedeemAmount("");
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
        notifySuccess(
          tt("posNotifySaleDoneLoyalty", {
            points: loyalty.points,
            tier: loyalty.tier,
          })
        );
      } else {
        notifySuccess(tt("posNotifySaleCompleted"));
      }
      const completedSale = response?.data?.sale || response?.data || {};
      publishCustomerDisplayCompleted({
        invoice: {
          id: completedSale.id || null,
          number: completedSale.invoiceNo || null,
          date: completedSale.createdAt || new Date().toISOString(),
        },
        totals: {
          subTotal,
          vatAmount,
          totalDiscount,
          total,
          paid: checkoutPaidAmount,
          due: checkoutDue,
        },
      });
      invalidatePosQueries();
      barcodeInputRef.current?.focus();
    } catch (error) {
      const raw = error.response?.data;
      const apiError =
        typeof raw === "string"
          ? raw
          : raw && typeof raw === "object" && raw.error != null
            ? String(raw.error)
            : "";
      const apiCode =
        raw && typeof raw === "object" && raw.code != null ? String(raw.code) : "";
      const message =
        String(apiError || "").trim() || error.message || tt("posNotifyCheckoutFailed");
      const shouldQueue = !error.response || error.code === "ERR_NETWORK";
      if (shouldQueue) {
        if (managerApprovalNeeded) {
          notifyActionRequired(tt("posNotifyOfflineNeedsApproval"));
          return;
        }
        const localRef = queueOfflineSale(payload, apiError || tt("posNotifyNetworkUnavailable"));
        setCart([]);
        setPaidAmount("");
        setDiscountType("AMOUNT");
        setDiscountValue("0");
        setManagerApprovalPin("");
        setApprovalReason("");
        setPaymentChannel("");
        setCustomer({ name: "", phone: "" });
        setPriceTier("RETAIL");
        setBuyerBinOrNidNote("");
        setCouponCode("");
        setGiftCardCode("");
        setGiftCardAmount("");
        setWalletRedeemAmount("");
        setRedeemPoints("");
        setPaymentMethod("Cash");
        setPaymentBreakdown([{ method: "Cash", amount: "", channel: "" }]);
        setActiveHoldAuditLogId(null);
        setActiveQuoteAuditLogId(null);
        notifySuccess(tt("posNotifyOfflineQueued", { n: localRef }));
      } else {
        queryClient.invalidateQueries({ queryKey: ["fiscal-gate"] });
        if (apiCode === "FISCAL_PERIOD_BLOCKED") {
          notifyActionRequired(message);
        } else {
          notifyError(message);
        }
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
      setPriceTier("RETAIL");
      setBuyerBinOrNidNote("");
      setCouponCode("");
      setGiftCardCode("");
      setGiftCardAmount("");
      setWalletRedeemAmount("");
      setRedeemPoints("");
      setPaymentMethod("Cash");
      setPaymentBreakdown([{ method: "Cash", amount: "", channel: "" }]);
      setHoldNote("");
      setShowHeldPanel(true);
      invalidatePosQueries();
      notifySuccess(tt("posNotifyCartHeld"));
    } catch {
      consumeGlobalSubmitError();
    }
  };

  const handleSaveQuote = async () => {
    if (!cart.length) return;
    try {
      const payload = buildCheckoutPayload();
      await api.post("/sales/quotes", { ...payload, quoteNote });
      setQuoteNote("");
      notifySuccess(tt("posNotifyQuoteSaved"));
    } catch {
      consumeGlobalSubmitError();
    }
  };

  const applyHeldDraftToPos = (draft) => {
    if (!Array.isArray(draft?.cart) || !draft.cart.length) {
      notifyActionRequired(tt("posNotifyHoldEmpty"));
      return false;
    }
    setCart(
      draft.cart.map((item) => ({
        ...item,
        lineId: item.lineId || newCartLineId(),
      }))
    );
    setPaymentMethod(draft.paymentMethod || "Cash");
    setPaidAmount(String(draft.paidAmount ?? ""));
    setPaymentBreakdown(Array.isArray(draft.paymentBreakdown) && draft.paymentBreakdown.length ? draft.paymentBreakdown : [{ method: "Cash", amount: "", channel: "" }]);
    setPaymentChannel(draft.paymentChannel || "");
    setCustomer(draft.customer || { name: "", phone: "" });
    const g0 = Array.isArray(draft.giftCardRedemptions) && draft.giftCardRedemptions.length ? draft.giftCardRedemptions[0] : null;
    setGiftCardCode(g0?.code || "");
    setGiftCardAmount(g0?.amount != null && g0?.amount !== "" ? String(g0.amount) : "");
    setWalletRedeemAmount(draft.walletRedeemAmount != null && draft.walletRedeemAmount !== "" ? String(draft.walletRedeemAmount) : "");
    setBuyerBinOrNidNote(String(draft.buyerBinOrNidNote || ""));
    setCouponCode(String(draft.couponCode || ""));
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
        if (!cancelled) notifyError(error?.response?.data?.error || tt("posNotifyQuoteLoadFail"));
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
        title: tt("posPinResumeTitle"),
        message: tt("posPinResumeMsg"),
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
    } catch {
      consumeGlobalSubmitError();
    }
  };

  const discardHeldCart = async (row) => {
    if (!window.confirm(tt("posConfirmDiscardHold"))) return;
    const holderId = row?.heldByUserId != null ? Number(row.heldByUserId) : null;
    const myId = currentUser?.id != null ? Number(currentUser.id) : null;
    const isOwnHold = holderId != null && myId != null && holderId === myId;
    let discardPinExtra = "";
    if (!isOwnHold) {
      const entered = await askManagerPin({
        title: tt("posPinDiscardTitle"),
        message: tt("posPinDiscardMsg"),
      });
      if (entered == null) return;
      discardPinExtra = String(entered).trim();
    }
    try {
      await api.delete(`/sales/holds/${row.id}`, {
        data: discardPinExtra ? { managerApprovalPin: discardPinExtra } : {},
      });
      setActiveHoldAuditLogId((prev) => (prev === row.id ? null : prev));
      invalidatePosQueries();
    } catch {
      consumeGlobalSubmitError();
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
      invalidatePosQueries();
    } catch (error) {
      const reason = error?.response?.data?.error || error.message || "Retry Failed";
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
      notifyError(reason);
    }
  };

  const classifyOfflineConflict = (row) => {
    const err = String(row?.lastError || "").toLowerCase();
    if (!err) return { type: "UNKNOWN", hint: "No error details available." };
    if (err.includes("insufficient stock") || err.includes("stock")) {
      return {
        type: "STOCK_MISMATCH",
        hint: "Stock changed while offline. Edit qty/remove item, then retry.",
      };
    }
    if (err.includes("manager approval") || err.includes("pin")) {
      return {
        type: "APPROVAL_REQUIRED",
        hint: "Manager approval is required. Retry online with manager PIN.",
      };
    }
    if (err.includes("customer") || err.includes("credit")) {
      return {
        type: "CUSTOMER_CREDIT_RULE",
        hint: "Customer/credit validation failed. Edit customer or payment and retry.",
      };
    }
    if (err.includes("validation") || err.includes("invalid")) {
      return {
        type: "PAYLOAD_VALIDATION",
        hint: "Some payload values are invalid. Edit payload before retry.",
      };
    }
    return {
      type: "SYNC_CONFLICT",
      hint: "Review payload and retry manually.",
    };
  };

  const resolveQueuedSaleConflict = async (row) => {
    const conflict = classifyOfflineConflict(row);
    const choice = window.prompt(
      `Conflict: ${conflict.type}\n${conflict.hint}\n\nChoose action:\n1 = Retry now\n2 = Edit payload and requeue\n3 = Mark for later\n\nEnter 1/2/3`
    );
    if (!choice) return;
    const action = String(choice).trim();
    if (action === "1") {
      await retryQueuedSale(row);
      return;
    }
    if (action === "2") {
      const initial = JSON.stringify(row.payload || {}, null, 2);
      const edited = window.prompt(
        "Edit queued checkout payload JSON.\nTip: adjust cart qty/payment/customer fields as needed.",
        initial
      );
      if (!edited) return;
      let parsed;
      try {
        parsed = JSON.parse(edited);
      } catch {
        notifyError(tt("posNotifyJsonInvalid"));
        return;
      }
      persistOfflineQueue((prev) =>
        prev.map((x) =>
          x.localRef === row.localRef
            ? {
                ...x,
                payload: parsed,
                status: "QUEUED",
                lastError: "",
                updatedAt: new Date().toISOString(),
              }
            : x
        )
      );
      appendOfflineLog({
        type: "CONFLICT_RESOLVED_EDIT",
        message: `Updated queued payload for conflict (${row.localRef})`,
        localRef: row.localRef,
        createdAt: new Date().toISOString(),
      });
      return;
    }
    if (action === "3") {
      persistOfflineQueue((prev) =>
        prev.map((x) =>
          x.localRef === row.localRef
            ? {
                ...x,
                status: "FAILED",
                updatedAt: new Date().toISOString(),
              }
            : x
        )
      );
      appendOfflineLog({
        type: "CONFLICT_MARKED_LATER",
        message: `Marked conflict for later review (${row.localRef})`,
        localRef: row.localRef,
        createdAt: new Date().toISOString(),
      });
    }
  };

  const autoResolveStockConflicts = () => {
    const stockByProductId = new Map((products || []).map((p) => [Number(p.id), Number(p.stock || 0)]));
    let resolvedCount = 0;
    let skippedCount = 0;
    persistOfflineQueue((prev) =>
      prev.map((row) => {
        const isFailed = String(row.status || "").toUpperCase() === "FAILED";
        const conflict = classifyOfflineConflict(row);
        if (!isFailed || conflict.type !== "STOCK_MISMATCH") return row;
        const sourceCart = Array.isArray(row.payload?.cart) ? row.payload.cart : [];
        const nextCart = sourceCart
          .map((item) => {
            const id = Number(item.id || 0);
            const qty = Math.max(0, Number(item.qty || 0));
            const stock = Math.max(0, Number(stockByProductId.get(id) || 0));
            const nextQty = Math.min(qty, stock);
            if (!id || nextQty <= 0) return null;
            return { ...item, qty: nextQty };
          })
          .filter(Boolean);
        if (!nextCart.length) {
          skippedCount += 1;
          return row;
        }
        const nextSubTotal = nextCart.reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.price || 0), 0);
        const oldPaid = Number(row.payload?.paidAmount || 0);
        const nextPayload = {
          ...(row.payload || {}),
          cart: nextCart,
          paidAmount: Math.max(0, Math.min(oldPaid, Number(nextSubTotal.toFixed(2)))),
        };
        resolvedCount += 1;
        return {
          ...row,
          payload: nextPayload,
          status: "QUEUED",
          lastError: "",
          updatedAt: new Date().toISOString(),
        };
      })
    );
    appendOfflineLog({
      type: "AUTO_CONFLICT_RESOLVE_STOCK",
      message: `Auto-resolved ${resolvedCount} stock conflict item(s), skipped ${skippedCount}.`,
      createdAt: new Date().toISOString(),
    });
    notifySuccess(tt("posNotifyAutoResolveStock", { n: resolvedCount, m: skippedCount }));
  };

  const autoResolveFilteredConflicts = () => {
    const targetRows = (offlineQueue || []).filter((row) => {
      const conflictType = classifyOfflineConflict(row).type;
      const isFailed = String(row.status || "").toUpperCase() === "FAILED";
      return isFailed && (offlineConflictFilter === "ALL" ? true : conflictType === offlineConflictFilter);
    });
    if (!targetRows.length) {
      notifyActionRequired(tt("posNotifyNoFailedConflicts"));
      return;
    }
    const stockByProductId = new Map((products || []).map((p) => [Number(p.id), Number(p.stock || 0)]));
    const targetRefs = new Set(targetRows.map((x) => String(x.localRef)));
    let resolvedCount = 0;
    let skippedCount = 0;
    persistOfflineQueue((prev) =>
      prev.map((row) => {
        if (!targetRefs.has(String(row.localRef))) return row;
        const conflict = classifyOfflineConflict(row);
        if (conflict.type === "STOCK_MISMATCH") {
          const sourceCart = Array.isArray(row.payload?.cart) ? row.payload.cart : [];
          const nextCart = sourceCart
            .map((item) => {
              const id = Number(item.id || 0);
              const qty = Math.max(0, Number(item.qty || 0));
              const stock = Math.max(0, Number(stockByProductId.get(id) || 0));
              const nextQty = Math.min(qty, stock);
              if (!id || nextQty <= 0) return null;
              return { ...item, qty: nextQty };
            })
            .filter(Boolean);
          if (!nextCart.length) {
            skippedCount += 1;
            return row;
          }
          const nextSubTotal = nextCart.reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.price || 0), 0);
          const oldPaid = Number(row.payload?.paidAmount || 0);
          resolvedCount += 1;
          return {
            ...row,
            payload: {
              ...(row.payload || {}),
              cart: nextCart,
              paidAmount: Math.max(0, Math.min(oldPaid, Number(nextSubTotal.toFixed(2)))),
            },
            status: "QUEUED",
            lastError: "",
            updatedAt: new Date().toISOString(),
          };
        }
        if (conflict.type === "PAYLOAD_VALIDATION") {
          const nextPayload = {
            ...(row.payload || {}),
            paymentChannel: String(row.payload?.paymentChannel || "").trim(),
            managerApprovalPin: String(row.payload?.managerApprovalPin || "").trim(),
            approvalReason: String(row.payload?.approvalReason || "").trim(),
          };
          resolvedCount += 1;
          return {
            ...row,
            payload: nextPayload,
            status: "QUEUED",
            lastError: "",
            updatedAt: new Date().toISOString(),
          };
        }
        skippedCount += 1;
        return row;
      })
    );
    appendOfflineLog({
      type: "AUTO_CONFLICT_RESOLVE_FILTERED",
      message: `Auto-resolved ${resolvedCount} filtered conflict(s), skipped ${skippedCount}.`,
      createdAt: new Date().toISOString(),
    });
    notifySuccess(tt("posNotifyFilteredResolver", { n: resolvedCount, m: skippedCount }));
  };

  const retryFilteredFailedItems = async () => {
    const filteredRows = offlineQueueRows.filter((row) => String(row.status || "").toUpperCase() === "FAILED");
    if (!filteredRows.length) {
      notifyActionRequired(tt("posNotifyNoFailedRows"));
      return;
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      notifyActionRequired(tt("posNotifyOnlineRequired"));
      return;
    }
    const ok = window.confirm(`Retry ${filteredRows.length} failed row(s) in current filter now?`);
    if (!ok) return;
    for (const row of filteredRows) {
      // eslint-disable-next-line no-await-in-loop
      await retryQueuedSale(row);
    }
  };

  const exportFilteredConflictReport = () => {
    const rows = offlineQueueRows.map((row) => ({
      local_ref: row.localRef,
      status: String(row.status || ""),
      conflict_type: String(row.conflictType || ""),
      resolver_hint: String(row.conflictHint || ""),
      retries: Number(row.retryCount || 0),
      last_error: String(row.lastError || ""),
      queued_at: String(row.createdAtLabel || ""),
      updated_at: String(row.updatedAtLabel || ""),
    }));
    if (!rows.length) {
      notifyActionRequired(tt("posNotifyNoQueueRows"));
      return;
    }
    const headers = Object.keys(rows[0]);
    const csv = [headers.join(",")]
      .concat(
        rows.map((r) =>
          headers
            .map((h) => `"${String(r[h] ?? "").replaceAll('"', '""')}"`)
            .join(",")
        )
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `offline-conflicts-${String(offlineConflictFilter || "ALL").toLowerCase()}-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const loadQueuedSaleToCart = (row) => {
    const payload = row?.payload || {};
    const payloadCart = Array.isArray(payload.cart) ? payload.cart : [];
    if (!payloadCart.length) {
      notifyError(tt("posNotifyQueueNoCartLines"));
      return;
    }
    setCart(
      payloadCart.map((item) => ({
        ...item,
        qty: Math.max(1, Number(item.qty || 1)),
        price: Number(item.price || 0),
      }))
    );
    setPaymentMethod(String(payload.paymentMethod || "Cash"));
    setPaymentChannel(String(payload.paymentChannel || ""));
    setPaidAmount(String(Number(payload.paidAmount || 0)));
    setPaymentBreakdown(
      Array.isArray(payload.paymentBreakdown) && payload.paymentBreakdown.length
        ? payload.paymentBreakdown.map((line) => ({
            method: String(line.method || "Cash"),
            amount: String(Number(line.amount || 0)),
            channel: String(line.channel || ""),
          }))
        : [{ method: "Cash", amount: "", channel: "" }]
    );
    setCustomer({
      name: String(payload.customer?.name || ""),
      phone: String(payload.customer?.phone || ""),
    });
    if (!String(payload.customer?.phone || "").trim()) {
      setPriceTier("RETAIL");
    }
    setDiscountType(String(payload.discountType || "AMOUNT").toUpperCase() === "PERCENT" ? "PERCENT" : "AMOUNT");
    setDiscountValue(String(Number(payload.discountValue || 0)));
    setManagerApprovalPin(String(payload.managerApprovalPin || ""));
    setApprovalReason(String(payload.approvalReason || ""));
    setRedeemPoints(String(Number(payload.redeemPoints || 0)));
    setActiveHoldAuditLogId(null);
    setActiveQuoteAuditLogId(null);
    persistOfflineQueue((prev) =>
      prev.map((x) =>
        x.localRef === row.localRef
          ? { ...x, status: "REVIEWING", updatedAt: new Date().toISOString() }
          : x
      )
    );
    appendOfflineLog({
      type: "CONFLICT_LOAD_TO_CART",
      message: `Loaded queued sale into POS cart (${row.localRef})`,
      localRef: row.localRef,
      createdAt: new Date().toISOString(),
    });
    notifySuccess(tt("posNotifyQueueLoaded"));
  };

  const markQueuedSaleResolved = (row) => {
    persistOfflineQueue((prev) =>
      prev.map((x) =>
        x.localRef === row.localRef
          ? { ...x, status: "RESOLVED", updatedAt: new Date().toISOString() }
          : x
      )
    );
    appendOfflineLog({
      type: "CONFLICT_MARKED_RESOLVED",
      message: `Marked queued sale resolved (${row.localRef})`,
      localRef: row.localRef,
      createdAt: new Date().toISOString(),
    });
  };

  const clearFilteredResolvedQueue = () => {
    const filteredResolved = offlineQueueRows.filter((row) =>
      ["RESOLVED", "REVIEWING"].includes(String(row.status || "").toUpperCase())
    );
    if (!filteredResolved.length) {
      notifyActionRequired(tt("posNotifyNoReviewResolved"));
      return;
    }
    const ok = window.confirm(`Remove ${filteredResolved.length} REVIEWING/RESOLVED row(s) from queue?`);
    if (!ok) return;
    const refs = new Set(filteredResolved.map((x) => String(x.localRef)));
    persistOfflineQueue((prev) => prev.filter((x) => !refs.has(String(x.localRef))));
    appendOfflineLog({
      type: "QUEUE_CLEANUP_FILTERED",
      message: `Cleaned ${filteredResolved.length} resolved/reviewing queue row(s)`,
      createdAt: new Date().toISOString(),
    });
  };

  const tagQueuedSale = (row) => {
    const current = String(row?.resolverTag || "");
    const nextTag = window.prompt("Set resolver tag/note for this queued row:", current);
    if (nextTag == null) return;
    persistOfflineQueue((prev) =>
      prev.map((x) =>
        x.localRef === row.localRef
          ? { ...x, resolverTag: String(nextTag).trim(), updatedAt: new Date().toISOString() }
          : x
      )
    );
    appendOfflineLog({
      type: "QUEUE_TAG_UPDATED",
      message: `Updated resolver tag for ${row.localRef}`,
      localRef: row.localRef,
      createdAt: new Date().toISOString(),
    });
  };

  const applyBulkTagToFiltered = () => {
    const tag = String(bulkConflictTag || "").trim();
    if (!tag) {
      notifyActionRequired(tt("posNotifyEnterTagFirst"));
      return;
    }
    if (!offlineQueueRows.length) {
      notifyActionRequired(tt("posNotifyNoRowsInFilter"));
      return;
    }
    const refs = new Set(offlineQueueRows.map((x) => String(x.localRef)));
    persistOfflineQueue((prev) =>
      prev.map((x) =>
        refs.has(String(x.localRef))
          ? { ...x, resolverTag: tag, updatedAt: new Date().toISOString() }
          : x
      )
    );
    appendOfflineLog({
      type: "QUEUE_TAG_BULK_APPLY",
      message: `Applied bulk tag "${tag}" to ${offlineQueueRows.length} filtered row(s)`,
      createdAt: new Date().toISOString(),
    });
  };

  const markFilteredFailedAsReviewing = () => {
    const targets = offlineQueueRows.filter((row) => String(row.status || "").toUpperCase() === "FAILED");
    if (!targets.length) {
      notifyActionRequired(tt("posNotifyNoFailedInFilter"));
      return;
    }
    const refs = new Set(targets.map((x) => String(x.localRef)));
    persistOfflineQueue((prev) =>
      prev.map((x) =>
        refs.has(String(x.localRef))
          ? { ...x, status: "REVIEWING", updatedAt: new Date().toISOString() }
          : x
      )
    );
    appendOfflineLog({
      type: "QUEUE_MARK_REVIEWING_FILTERED",
      message: `Marked ${targets.length} filtered FAILED row(s) as REVIEWING`,
      createdAt: new Date().toISOString(),
    });
  };

  const offlineConflictSummary = (offlineQueue || []).reduce(
    (acc, row) => {
      const key = classifyOfflineConflict(row).type;
      acc.total += 1;
      acc[key] = Number(acc[key] || 0) + 1;
      if (String(row.status || "").toUpperCase() === "FAILED") acc.failed += 1;
      if (String(row.status || "").toUpperCase() === "REVIEWING") acc.reviewing += 1;
      if (String(row.status || "").toUpperCase() === "RESOLVED") acc.resolved += 1;
      return acc;
    },
    { total: 0, failed: 0, reviewing: 0, resolved: 0 }
  );

  const offlineQueueRows = (offlineQueue || [])
    .map((q, idx) => ({
      rowNo: idx + 1,
      ...q,
      conflictType: classifyOfflineConflict(q).type,
      conflictHint: classifyOfflineConflict(q).hint,
      resolverTag: String(q.resolverTag || ""),
      createdAtLabel: new Date(q.createdAt).toLocaleString(),
      updatedAtLabel: new Date(q.updatedAt || q.createdAt).toLocaleString(),
    }))
    .filter((row) => (offlineConflictFilter === "ALL" ? true : String(row.conflictType || "") === String(offlineConflictFilter)))
    .filter((row) =>
      offlineStatusFilter === "ALL"
        ? true
        : String(row.status || "").toUpperCase() === String(offlineStatusFilter || "").toUpperCase()
    );

  const retryFailedQueuedSales = async () => {
    const failedRows = offlineQueue.filter((x) => String(x.status || "").toUpperCase() === "FAILED");
    if (!failedRows.length) {
      notifyActionRequired(tt("posNotifyNoFailedToRetry"));
      return;
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      notifyActionRequired(tt("posNotifyOnlineForRetryFailed"));
      return;
    }
    const ok = window.confirm(`Retry ${failedRows.length} failed queued sale(s) now?`);
    if (!ok) return;

    let successCount = 0;
    const failedResults = [];

    for (const row of failedRows) {
      try {
        await api.post("/sales/checkout", row.payload);
        persistOfflineQueue((prev) => prev.filter((x) => x.localRef !== row.localRef));
        appendOfflineLog({
          type: "MANUAL_BULK_RETRY_SUCCESS",
          message: `Bulk retry synced (${row.localRef})`,
          localRef: row.localRef,
          createdAt: new Date().toISOString(),
        });
        successCount += 1;
      } catch (error) {
        const reason = error?.response?.data?.error || error.message || "Retry Failed";
        persistOfflineQueue((prev) =>
          prev.map((x) =>
            x.localRef === row.localRef
              ? {
                  ...x,
                  status: "FAILED",
                  lastError: reason,
                  retryCount: Number(x.retryCount || 0) + 1,
                  updatedAt: new Date().toISOString(),
                }
              : x
          )
        );
        appendOfflineLog({
          type: "MANUAL_BULK_RETRY_FAILED",
          message: `Bulk retry failed (${row.localRef}): ${reason}`,
          localRef: row.localRef,
          createdAt: new Date().toISOString(),
        });
        failedResults.push({ localRef: row.localRef, reason });
      }
    }

    invalidatePosQueries();

    if (!failedResults.length) {
      notifySuccess(tt("posNotifyBulkRetryOk", { n: successCount, m: failedRows.length }));
      return;
    }
    const topFailures = failedResults
      .slice(0, 3)
      .map((x) => `${x.localRef}: ${x.reason}`)
      .join("\n");
    notifyError(
      tt("posNotifyBulkRetryPartial", {
        success: successCount,
        stillFailed: failedResults.length,
        topErrors: topFailures,
      })
    );
  };

  const discardQueuedSale = async (row) => {
    if (!canDiscardOfflineQueue) {
      notifyPermissionRequired(tt("posNotifyPermDiscardQueue"));
      return;
    }
    const enteredPin = await askManagerPin({
      title: tt("posPinDiscardQueueTitle"),
      message: tt("posPinDiscardQueueMsg"),
    });
    if (enteredPin == null) return;
    const expectedPin = String(localStorage.getItem(OFFLINE_DISCARD_PIN_KEY) || "1234");
    if (String(enteredPin).trim() !== expectedPin) {
      notifyError(tt("posNotifyInvalidPinDiscard"));
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
          const vl = item.productVariant?.label;
          const baseName = item.product?.name || `Item ${item.productId}`;
          const name = vl && String(vl).trim() ? `${baseName} (${String(vl).trim()})` : baseName;
          const variantMeta = getVariantMetaFromSaleItem(item);
          const w = Number(item.weightKg ?? 0);
          const qtyLabel =
            Number.isFinite(w) && w > 1e-9 ? `${w.toFixed(3)} kg` : String(item.qty ?? "");
          const originalUnitPrice = Number(item.product?.price || item.price || 0);
          const unitPrice = Number(item.price || 0);
          const hasOverride =
            vl == null &&
            Number(item.productVariantId || 0) === 0 &&
            originalUnitPrice > unitPrice + 1e-9;
          const rateLabel = hasOverride
            ? `${unitPrice.toFixed(2)} (orig ${originalUnitPrice.toFixed(2)})`
            : unitPrice.toFixed(2);
          const lineTotal =
            Number.isFinite(w) && w > 1e-9 ? unitPrice * w : Number(item.qty ?? 0) * unitPrice;
          return `<tr><td>${name}${variantMeta ? `<br/><span style="font-size:11px;color:#64748b;">${variantMeta}</span>` : ""}</td><td style="text-align:center;">${qtyLabel}</td><td style="text-align:right;">${rateLabel}</td><td style="text-align:right;">${lineTotal.toFixed(2)}</td></tr>`;
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
            ${sale.mushakDocumentNo ? `<p>VAT (Mushak ref): ${escapeHtml(sale.mushakDocumentNo)}</p>` : ""}
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
      notifyError(error.response?.data?.error || tt("posErrPrintInvoice"));
    }
  };

  const openMushakPdf = async (saleId) => {
    try {
      const res = await api.get(`/sales/${saleId}/mushak-pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      notifyError(error.response?.data?.error || tt("posErrMushakPdf"));
    }
  };

  const downloadMushak63Xml = async (sale) => {
    const saleId = sale?.id;
    if (!saleId) return;
    try {
      await downloadMushak63XmlWithCompletenessHint(saleId, sale?.mushakDocumentNo);
    } catch (error) {
      notifyError(error.response?.data?.error || tt("posErrMushakXml"));
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
      notifyError(error.message || tt("posErrTestReceipt"));
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
          const vl = item.productVariant?.label;
          const baseName = item.product?.name || `Item ${item.productId}`;
          const name = vl && String(vl).trim() ? `${baseName} (${String(vl).trim()})` : baseName;
          const variantMeta = getVariantMetaFromSaleItem(item);
          const w = Number(item.weightKg ?? 0);
          const qtyLabel =
            Number.isFinite(w) && w > 1e-9 ? `${w.toFixed(3)} kg` : String(item.qty ?? "");
          const originalUnitPrice = Number(item.product?.price || item.price || 0);
          const unitPrice = Number(item.price || 0);
          const hasOverride =
            vl == null &&
            Number(item.productVariantId || 0) === 0 &&
            originalUnitPrice > unitPrice + 1e-9;
          const rateLabel = hasOverride
            ? `${unitPrice.toFixed(2)} (orig ${originalUnitPrice.toFixed(2)})`
            : unitPrice.toFixed(2);
          const lineTotal =
            Number.isFinite(w) && w > 1e-9 ? unitPrice * w : Number(item.qty ?? 0) * unitPrice;
          return `<tr><td>${name}${variantMeta ? `<br/><span style="font-size:11px;color:#64748b;">${variantMeta}</span>` : ""}</td><td style="text-align:center;">${qtyLabel}</td><td style="text-align:right;">${rateLabel}</td><td style="text-align:right;">${lineTotal.toFixed(2)}</td></tr>`;
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
      notifyError(error.response?.data?.error || tt("posErrPreviewInvoice"));
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

  const failedQueueCount = offlineQueue.filter(
    (x) => String(x.status || "").toUpperCase() === "FAILED"
  ).length;
  const stockConflictCount = offlineQueue.filter(
    (x) =>
      String(x.status || "").toUpperCase() === "FAILED" &&
      classifyOfflineConflict(x).type === "STOCK_MISMATCH"
  ).length;
  const hasMissingWeight = cart.some((x) => x.sellByWeight && !(Number(x.weightKg) > 0));
  const hasMissingDigitalRef =
    paymentMethod !== "Split" &&
    DIGITAL_METHODS.has(paymentMethod) &&
    !String(paymentChannel || "").trim();
  const hasMissingSplitRef =
    paymentMethod === "Split" &&
    paymentBreakdown.some(
      (line) => DIGITAL_METHODS.has(String(line.method || "")) && !String(line.channel || "").trim()
    );
  const hasMissingApprovalReason = managerApprovalNeeded && !String(approvalReason || "").trim();
  const checkoutRequirements = useMemo(
    () => [
      {
        label: t(uiLang, "posReqCartItems"),
        ok: cart.length > 0,
        hint: t(uiLang, "posReqCartItemsHintAdd"),
      },
      {
        label: t(uiLang, "posReqFiscal"),
        ok: !fiscalBlocked,
        hint: fiscalGateData?.message || t(uiLang, "posReqFiscalHintFb"),
      },
      {
        label: t(uiLang, "posReqWeight"),
        ok: !hasMissingWeight,
        hint: t(uiLang, "posReqWeightHint"),
      },
      {
        label: t(uiLang, "posReqPayRef"),
        ok: !hasMissingDigitalRef && !hasMissingSplitRef,
        hint: t(uiLang, "posReqPayRefHint"),
      },
      {
        label: t(uiLang, "posReqApproval"),
        ok: !hasMissingApprovalReason,
        hint: t(uiLang, "posReqApprovalHint"),
        optional: !managerApprovalNeeded,
      },
    ],
    [
      uiLang,
      cart.length,
      fiscalBlocked,
      fiscalGateData?.message,
      hasMissingWeight,
      hasMissingDigitalRef,
      hasMissingSplitRef,
      hasMissingApprovalReason,
      managerApprovalNeeded,
    ]
  );
  const checkoutBlockers = checkoutRequirements.filter((x) => !x.ok && !x.optional);
  const holdRequirements = useMemo(
    () => [
      {
        label: t(uiLang, "posReqCartItems"),
        ok: cart.length > 0,
        hint: t(uiLang, "posHoldNeedItems"),
      },
    ],
    [uiLang, cart.length]
  );
  const holdBlockers = holdRequirements.filter((x) => !x.ok);
  const quoteRequirements = useMemo(
    () => [
      {
        label: t(uiLang, "posReqCartItems"),
        ok: cart.length > 0,
        hint: t(uiLang, "posQuoteNeedItems"),
      },
    ],
    [uiLang, cart.length]
  );
  const quoteBlockers = quoteRequirements.filter((x) => !x.ok);

  useEffect(() => {
    const storeForDisplay = {
      name: storeSettings.storeName,
      address: storeSettings.storeAddress,
      phone: storeSettings.storePhone,
      logoDataUrl: storeSettings.logoDataUrl,
    };
    const customerForDisplay =
      customer.name || customer.phone
        ? { name: customer.name, phone: customer.phone }
        : null;
    if (cart.length === 0) {
      publishCustomerDisplayCleared({
        store: storeForDisplay,
        lang: receiptLanguage,
        customer: customerForDisplay,
        paymentMethod,
      });
      return;
    }
    publishCustomerDisplayState({
      status: CUSTOMER_DISPLAY_STATUS.SHOPPING,
      store: storeForDisplay,
      lang: receiptLanguage,
      cart: cart.map((item) => {
        const unit = getUnitSellPrice(item);
        const units = getBillingUnitsForItem(item);
        return {
          lineId: item.lineId || `${item.id}`,
          id: item.id,
          name: item.name,
          variantLabel: item.matchedVariant?.label || "",
          sellByWeight: !!item.sellByWeight,
          qty: Number(item.qty || 0),
          weightKg: Number(item.weightKg || 0),
          unitPrice: unit,
          lineTotal: unit * units,
          vatRate: Number(item.vatRate || 0),
        };
      }),
      totals: {
        subTotal,
        vatAmount,
        totalDiscount,
        total,
        paid: checkoutPaidAmount,
        due: checkoutDue,
      },
      customer: customerForDisplay,
      paymentMethod,
    });
  }, [
    cart,
    subTotal,
    vatAmount,
    totalDiscount,
    total,
    checkoutPaidAmount,
    checkoutDue,
    paymentMethod,
    customer.name,
    customer.phone,
    storeSettings.storeName,
    storeSettings.storeAddress,
    storeSettings.storePhone,
    storeSettings.logoDataUrl,
    receiptLanguage,
  ]);

  const handleOpenCustomerDisplay = () => {
    const win = openCustomerDisplayWindow();
    if (!win) {
      notifyActionRequired(tt("posNotifyPopupBlocked"));
    }
  };

  return (
    <div className="page-stack page-stack--fluid">
      <div className="pos-layout">
      {/* LEFT: PRODUCTS */}
      <div className="pos-panel pos-products">
        <header className="pos-header">
          <h2>{tt("products")}</h2>
          <div className="pos-status-badges">
            <span className={`badge ${isOnline ? "badge-success" : "badge-danger"}`}>
              {isOnline ? tt("posOnline") : tt("posOffline")}
            </span>
            {offlineQueue.length > 0 ? (
              <span className="badge badge-warning">
                {isSyncingOffline ? tt("posSyncing") : tt("posPending", { n: offlineQueue.length })}
              </span>
            ) : null}
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => {
                setShowHeldPanel((prev) => {
                  const next = !prev;
                  if (next) setPosCartTab("activity");
                  return next;
                });
              }}
            >
              {tt("posHeld", { n: heldCarts.length })}
            </button>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={handleOpenCustomerDisplay}
              title={tt("posCustomerDisplayTitle")}
            >
              🖥️ {tt("posCustomerDisplay")}
            </button>
          </div>
        </header>

        <form onSubmit={handleBarcodeAdd} className="pos-barcode-form">
          <select
            className="form-select-sm"
            value={priceTier}
            onChange={(e) => {
              const nextTier = e.target.value;
              setPriceTier(nextTier);
              applyPriceTierToCart(nextTier);
            }}
            style={{ maxWidth: 150 }}
            title={tt("posPriceTierTitle")}
          >
            <option value="RETAIL">{tt("prodPriceTypeRetail")}</option>
            <option value="WHOLESALE">{tt("prodPriceTypeWholesale")}</option>
            <option value="DEALER">{tt("prodPriceTypeDealer")}</option>
          </select>
          <input
            ref={barcodeInputRef}
            placeholder={tt("posBarcodePlaceholder")}
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            className="pos-barcode-input"
          />
          <button type="submit">{tt("posAdd")}</button>
        </form>
        <input
          placeholder={tt("posSearchPlaceholder")}
          value={productSearch}
          onChange={(e) => setProductSearch(e.target.value)}
          className="pos-barcode-input"
        />

        <div className="pos-metric-strip">
          <div className="metric">
            <div className="metric-label">{tt("posMetricTodaySales")}</div>
            <div className="metric-value">{formatBDT(summary.totalSales)}</div>
          </div>
          <div className="metric">
            <div className="metric-label">{tt("posMetricPaid")}</div>
            <div className="metric-value">{formatBDT(summary.totalPaid)}</div>
          </div>
          <div className="metric">
            <div className="metric-label">{tt("posMetricDue")}</div>
            <div className="metric-value">{formatBDT(summary.totalDue)}</div>
          </div>
          <div className="metric">
            <div className="metric-label">{tt("posMetricBills")}</div>
            <div className="metric-value">{summary.billCount}</div>
          </div>
        </div>

        <div className="pos-tabs">
          <div className="pos-tablist" role="tablist" aria-label={tt("products")}>
            <button
              type="button"
              role="tab"
              aria-selected={posProductsTab === "catalog"}
              className={`pos-tab ${posProductsTab === "catalog" ? "pos-tab-active" : ""}`}
              onClick={() => setPosProductsTab("catalog")}
            >
              {tt("posTabBrowse")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={posProductsTab === "offline"}
              className={`pos-tab ${posProductsTab === "offline" ? "pos-tab-active" : ""}`}
              onClick={() => setPosProductsTab("offline")}
            >
              {tt("posTabOfflineSync")}
              {offlineQueue.length > 0 ? (
                <span
                  className={`pos-tab-badge ${failedQueueCount > 0 ? "pos-tab-badge-danger" : "pos-tab-badge-warn"}`}
                >
                  {offlineQueue.length}
                </span>
              ) : null}
            </button>
          </div>

          {posProductsTab === "catalog" ? (
            <div className="pos-tab-panel" role="tabpanel">
              <div className="pos-product-list">
          {filteredProducts.map((p) => {
            const hasV = Boolean(p.hasVariants && Array.isArray(p.variants) && p.variants.length);
            const firstVid = hasV ? p.variants[0]?.id : null;
            const selectedVid =
              variantChoiceByProduct[p.id] != null && variantChoiceByProduct[p.id] !== ""
                ? Number(variantChoiceByProduct[p.id])
                : firstVid != null
                  ? Number(firstVid)
                  : null;
            const selVariant = hasV ? p.variants.find((v) => Number(v.id) === Number(selectedVid)) : null;
            const showPrice = selVariant?.priceOverride != null && selVariant.priceOverride !== ""
              ? Number(selVariant.priceOverride)
              : Number(p.price);
            const inStockPiece = !p.hasVariants && !p.sellByWeight && p.stock > 0;
            const inStockKg = !p.hasVariants && p.sellByWeight && Number(p.stockKg || 0) > 0;
            const inStockVariant = hasV && selVariant && selVariant.stock > 0;
            const canAdd =
              (!hasV && !p.sellByWeight && inStockPiece) ||
              (!hasV && p.sellByWeight && inStockKg) ||
              (hasV && inStockVariant);
            const stockLabel = hasV
              ? tt("posVariantsN", { n: p.variants.length })
              : p.sellByWeight
                ? `${Number(p.stockKg || 0).toFixed(3)} kg`
                : p.stock;

            const onAdd = () => {
              if (hasV && (!selectedVid || Number.isNaN(selectedVid))) {
                notifyActionRequired(tt("posPickVariant"));
                return;
              }
              addToCart(p, hasV ? { variantId: selectedVid } : {});
            };

            return (
              <div
                key={p.id}
                className="pos-product-card"
                style={{ display: "flex", flexDirection: "column", gap: 6, opacity: canAdd ? 1 : 0.6 }}
              >
                <button
                  type="button"
                  disabled={!canAdd}
                  style={{
                    cursor: canAdd ? "pointer" : "not-allowed",
                    width: "100%",
                    border: "none",
                    background: "transparent",
                    textAlign: "left",
                    padding: 0,
                    font: "inherit",
                    color: "inherit",
                  }}
                  onClick={onAdd}
                >
                  <div className="pos-product-name">{p.name}</div>
                  <div className="pos-product-meta">
                    <span>{formatBDT(showPrice)}</span>
                    <span>
                      {tt("posStock")} {stockLabel}
                    </span>
                    <span>
                      {tt("receiptVat")}: {p.vatRate}%
                    </span>
                    {selVariant ? (
                      <span>
                        {getVariantDisplayMeta(selVariant) ||
                          (selVariant.label ? `${tt("posVariantPrefix")} ${selVariant.label}` : "")}
                      </span>
                    ) : null}
                    {p.sellByWeight ? <span className="badge badge-primary">{tt("posSellByKg")}</span> : null}
                    {hasV ? <span className="badge badge-primary">{tt("posHasVariants")}</span> : null}
                    {p.defaultDiscountType ? (
                      <span className="badge badge-primary">
                        {tt("posDiscBadge")}{" "}
                        {p.defaultDiscountType === "PERCENT"
                          ? `${Number(p.defaultDiscountValue || 0)}%`
                          : formatBDT(p.defaultDiscountValue || 0)}
                      </span>
                    ) : null}
                  </div>
                </button>
                {hasV ? (
                  <div
                    style={{ width: "100%", marginTop: 6 }}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <Select
                      className="form-select-sm"
                      value={
                        p.variants
                          .map((v) => ({
                            value: String(v.id),
                            label:
                              (String(v.label || "").trim() || tt("posVariantFallback", { n: v.id })) +
                              (getVariantDisplayMeta(v) ? ` (${getVariantDisplayMeta(v)})` : "") +
                              (v.stock != null ? tt("posStockLabelSuffix", { n: v.stock }) : ""),
                          }))
                          .find((opt) => opt.value === String(selectedVid ?? ""))
                          || null
                      }
                      options={p.variants.map((v) => ({
                        value: String(v.id),
                        label:
                          (String(v.label || "").trim() || tt("posVariantFallback", { n: v.id })) +
                          (getVariantDisplayMeta(v) ? ` (${getVariantDisplayMeta(v)})` : "") +
                          (v.stock != null ? tt("posStockLabelSuffix", { n: v.stock }) : ""),
                      }))}
                      onChange={(opt) =>
                        setVariantChoiceByProduct((prev) => ({
                          ...prev,
                          [p.id]: opt?.value || "",
                        }))
                      }
                      isSearchable
                      isClearable={false}
                      styles={SEARCH_SELECT_STYLES}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
              </div>
            </div>
          ) : (
            <div className="pos-tab-panel" role="tabpanel">
              {offlineQueue.length === 0 ? (
                <p className="pos-inline-note" style={{ padding: "8px 0 12px" }}>
                  {tt("posOfflineEmpty")}
                </p>
              ) : (
                <p className="pos-inline-note" style={{ marginBottom: 8 }}>
                  <strong>{tt("posOfflineQueueLine", { n: offlineQueue.length })}</strong>
                  {failedQueueCount > 0 ? (
                    <>
                      {" "}
                      · <strong style={{ color: "#b91c1c" }}>{failedQueueCount}</strong> {tt("posOfflineFailedSuffix")}
                    </>
                  ) : null}
                </p>
              )}
              <div className="pos-action-row">
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => syncOfflineQueue()}
                  disabled={isSyncingOffline || offlineQueue.length === 0}
                >
                  {tt("posSyncAllNow")}
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={retryFailedQueuedSales}
                  disabled={isSyncingOffline || failedQueueCount === 0}
                >
                  {tt("posRetryFailed")}
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={autoResolveStockConflicts}
                  disabled={isSyncingOffline || stockConflictCount === 0}
                >
                  {tt("posAutoResolveStock")}
                </button>
              </div>
              {!canDiscardOfflineQueue ? (
                <p className="pos-inline-note">{tt("posOfflineDiscardPerm")}</p>
              ) : null}
              <p className="pos-inline-note" style={{ margin: "12px 0 6px", fontWeight: 600 }}>
                {tt("posOffFiltersBulk")}
              </p>
              <div className="quick-stats" style={{ marginBottom: 8 }}>
                <div className="stat">
                  {tt("posOffStatTotal")} {offlineConflictSummary.total}
                </div>
                <div className="stat">
                  {tt("posOffStatFailed")} {offlineConflictSummary.failed}
                </div>
                <div className="stat">
                  {tt("posOffStatReviewing")} {offlineConflictSummary.reviewing}
                </div>
                <div className="stat">
                  {tt("posOffStatResolved")} {offlineConflictSummary.resolved}
                </div>
                <div className="stat">
                  {tt("posOffStatStock")} {Number(offlineConflictSummary.STOCK_MISMATCH || 0)}
                </div>
                <div className="stat">
                  {tt("posOffStatApproval")} {Number(offlineConflictSummary.APPROVAL_REQUIRED || 0)}
                </div>
                <div className="stat">
                  {tt("posOffStatValidation")} {Number(offlineConflictSummary.PAYLOAD_VALIDATION || 0)}
                </div>
              </div>
              <div className="form-grid">
                <select className="form-select-sm" value={offlineConflictFilter} onChange={(e) => setOfflineConflictFilter(e.target.value)}>
                  <option value="ALL">{tt("posOffConfAll")}</option>
                  <option value="STOCK_MISMATCH">{tt("posOffConfStock")}</option>
                  <option value="APPROVAL_REQUIRED">{tt("posOffConfApproval")}</option>
                  <option value="CUSTOMER_CREDIT_RULE">{tt("posOffConfCredit")}</option>
                  <option value="PAYLOAD_VALIDATION">{tt("posOffConfPayload")}</option>
                  <option value="SYNC_CONFLICT">{tt("posOffConfSync")}</option>
                  <option value="UNKNOWN">{tt("posOffConfUnknown")}</option>
                </select>
                <select className="form-select-sm" value={offlineStatusFilter} onChange={(e) => setOfflineStatusFilter(e.target.value)}>
                  <option value="ALL">{tt("posOffStAll")}</option>
                  <option value="FAILED">{tt("posOffStFailed")}</option>
                  <option value="QUEUED">{tt("posOffStQueued")}</option>
                  <option value="REVIEWING">{tt("posOffStReviewing")}</option>
                  <option value="RESOLVED">{tt("posOffStResolved")}</option>
                </select>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={retryFilteredFailedItems}
                  disabled={isSyncingOffline || offlineQueueRows.filter((x) => String(x.status || "").toUpperCase() === "FAILED").length === 0}
                >
                  {tt("posRetryFiltered")}
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={autoResolveFilteredConflicts}
                  disabled={isSyncingOffline || offlineQueueRows.filter((x) => String(x.status || "").toUpperCase() === "FAILED").length === 0}
                >
                  {tt("posAutoResolveFiltered")}
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={exportFilteredConflictReport}
                  disabled={offlineQueueRows.length === 0}
                >
                  {tt("posExportCsv")}
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={markFilteredFailedAsReviewing}
                  disabled={offlineQueueRows.filter((x) => String(x.status || "").toUpperCase() === "FAILED").length === 0}
                >
                  {tt("posMarkReviewing")}
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={clearFilteredResolvedQueue}
                  disabled={
                    offlineQueueRows.filter((x) =>
                      ["RESOLVED", "REVIEWING"].includes(String(x.status || "").toUpperCase())
                    ).length === 0
                  }
                >
                  {tt("posClearResolved")}
                </button>
                <input
                  placeholder={tt("posBulkTagPh")}
                  value={bulkConflictTag}
                  onChange={(e) => setBulkConflictTag(e.target.value)}
                />
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={applyBulkTagToFiltered}
                  disabled={offlineQueueRows.length === 0 || !String(bulkConflictTag || "").trim()}
                >
                  {tt("posApplyTag")}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* RIGHT: CART */}
      <div className="pos-panel pos-cart">
        <h2>{tt("posCartTitle")}</h2>
        <p className="pos-inline-note">{tt("posCartIntro")}</p>

        {cart.map((item) => (
          <div key={item.lineId || item.id} className="pos-cart-item">
            <strong className="pos-cart-item-name">
              {item.name}
              {item.matchedVariant && String(item.matchedVariant.label || "").trim()
                ? ` (${String(item.matchedVariant.label).trim()})`
                : ""}
            </strong>
            {item.matchedVariant ? (
              <div className="pos-inline-note">
                {getVariantDisplayMeta(item.matchedVariant) || tt("posCartVariantSel")}
              </div>
            ) : null}
            <div className="pos-cart-item-row">
              {formatBDT(getUnitSellPrice(item))}{" "}
              {item.sellByWeight ? (
                <>
                  {tt("posTimesKg")}{" "}
                  <input
                    type="number"
                    step={0.001}
                    min={0.001}
                    value={item.weightKg ?? ""}
                    onChange={(e) => updateWeightKgLine(item.lineId, e.target.value)}
                    className="pos-qty-input"
                  />
                  <span className="pos-inline-note">
                    {tt("posMaxKg", { n: maxQtyOrWeightForCartLine(item).toFixed(3) })}
                  </span>
                </>
              ) : (
                <>
                  ×{" "}
                  <input
                    type="number"
                    value={item.qty}
                    onChange={(e) => updateQty(item.lineId, e.target.value)}
                    className="pos-qty-input"
                    min={1}
                  />
                </>
              )}
            </div>
            <div className="pos-cart-item-row">
              <span style={{ minWidth: 72 }}>{tt("posOverrideLabel")}</span>
              <input
                type="number"
                placeholder={item.sellByWeight ? tt("posOverridePhKg") : tt("posOverridePhPiece")}
                value={item.overridePrice ?? ""}
                onChange={(e) => updateOverridePrice(item.lineId, e.target.value)}
                className="pos-qty-input"
                min={0}
              />
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => resetOverridePrice(item.lineId)}
                disabled={String(item.overridePrice ?? "").trim() === ""}
              >
                {tt("posReset")}
              </button>
            </div>
            {String(item.overridePrice ?? "").trim() !== "" ? (
              <div className="pos-inline-note">
                {tt("posBasePipeSell")} {formatBDT(getCartLineBaseUnitPrice(item))}{" "}
                {tt("posSellingPipe")} {formatBDT(getUnitSellPrice(item))}
              </div>
            ) : null}
            {item.defaultDiscountType ? (
              <div className="pos-inline-note">
                {tt("posPredefinedDisc")}{" "}
                {item.defaultDiscountType === "PERCENT"
                  ? `${Number(item.defaultDiscountValue || 0)}%`
                  : formatBDT(item.defaultDiscountValue || 0)}
              </div>
            ) : null}

            <button className="btn-danger btn-sm" onClick={() => removeItem(item.lineId)}>
              {tt("posRemove")}
            </button>
          </div>
        ))}

        {!cart.length ? (
          <p className="pos-inline-note" style={{ padding: "20px 0", textAlign: "center" }}>
            {tt("posCartEmpty")}
          </p>
        ) : null}

        <div className="pos-tabs">
          <div className="pos-tablist" role="tablist" aria-label={tt("posAriaSaleOptions")}>
            <button
              type="button"
              role="tab"
              aria-selected={posCartTab === "payment"}
              className={`pos-tab ${posCartTab === "payment" ? "pos-tab-active" : ""}`}
              onClick={() => setPosCartTab("payment")}
            >
              {tt("posTabPay")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={posCartTab === "customer"}
              className={`pos-tab ${posCartTab === "customer" ? "pos-tab-active" : ""}`}
              onClick={() => setPosCartTab("customer")}
            >
              {tt("posTabCust")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={posCartTab === "offers"}
              className={`pos-tab ${posCartTab === "offers" ? "pos-tab-active" : ""}`}
              onClick={() => setPosCartTab("offers")}
            >
              {tt("posTabOffers")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={posCartTab === "more"}
              className={`pos-tab ${posCartTab === "more" ? "pos-tab-active" : ""}`}
              onClick={() => setPosCartTab("more")}
            >
              {tt("posTabMore")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={posCartTab === "activity"}
              className={`pos-tab ${posCartTab === "activity" ? "pos-tab-active" : ""}`}
              onClick={() => setPosCartTab("activity")}
            >
              {tt("posTabActivity")}
              {offlineQueue.length > 0 ? (
                <span
                  className={`pos-tab-badge ${failedQueueCount > 0 ? "pos-tab-badge-danger" : "pos-tab-badge-warn"}`}
                >
                  {offlineQueue.length}
                </span>
              ) : null}
            </button>
          </div>

          {posCartTab === "payment" ? (
            <div className="pos-tab-panel" role="tabpanel">
        <div className="pos-step-card">
          <strong className="pos-step-title">{tt("posStep1ReviewBill")}</strong>
        {cart.length ? (
          <div className="pos-cart-totals">
            <p>
              {tt("posBillSubtotal")} <span style={{ float: "right" }}>{formatBDT(subTotal)}</span>
            </p>
            <p>
              {tt("posBillVat")} <span style={{ float: "right" }}>{formatBDT(vatAmount)}</span>
            </p>
            {predefinedDiscount > 0 ? (
              <p>
                {tt("posLineProdDisc")}{" "}
                <span style={{ float: "right" }}>− {formatBDT(predefinedDiscount)}</span>
              </p>
            ) : null}
            <div className="pos-discount-row" style={{ margin: "6px 0" }}>
              <select value={discountType} onChange={(e) => setDiscountType(e.target.value)} className="form-select-sm pos-discount-type">
                <option value="AMOUNT">{tt("posDiscTypeTaka")}</option>
                <option value="PERCENT">{tt("posDiscTypePct")}</option>
              </select>
              <input
                type="number"
                placeholder={discountType === "PERCENT" ? "0" : "0.00"}
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                className="pos-discount-value"
              />
            </div>
            {totalDiscount > 0 ? (
              <p>
                {tt("posLineTotalDisc")}{" "}
                <span style={{ float: "right" }}>− {formatBDT(totalDiscount)}</span>
              </p>
            ) : null}
            {promotionDiscountAmount > 0 ? (
              <p>
                {tt("posLinePromo")}{" "}
                <span style={{ float: "right" }}>− {formatBDT(promotionDiscountAmount)}</span>
              </p>
            ) : null}
            {priceOverrideSummary.totalReduction > 0 ? (
              <p>
                {tt("posLinePriceOv")}{" "}
                <span style={{ float: "right" }}>− {formatBDT(priceOverrideSummary.totalReduction)}</span>
              </p>
            ) : null}
            <div className="grand-total">
              <span>{tt("receiptTotal")}</span>
              <span>{formatBDT(total)}</span>
            </div>
            {promotionEstimate.applied.length > 0 ? (
              <details style={{ marginTop: 6 }}>
                <summary className="pos-inline-note" style={{ cursor: "pointer" }}>
                  {tt("posOffersSummary", { n: promotionEstimate.applied.length })}
                </summary>
                <ul style={{ margin: "6px 0 0 16px", padding: 0, fontSize: 12 }}>
                  {promotionEstimate.applied.map((offer) => (
                    <li key={`${offer.id}-${offer.name}`}>
                      {offer.name}: {formatBDT(offer.amount)}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ) : (
          <p className="pos-inline-note" style={{ marginBottom: 10 }}>
            {tt("posAddItemsSeeTotals")}
          </p>
        )}
        </div>

        <div className="pos-step-card">
        <strong className="pos-step-title">{tt("posStep2Pay")}</strong>
        <label className="pos-inline-note" style={{ display: "block", marginTop: 6 }}>
          {tt("posPayMethod")}
        </label>
        <select
          className="form-select-sm"
          value={paymentMethod}
          onChange={(e) => setPaymentMethod(e.target.value)}
        >
          <option value="Cash">{t(uiLang, "dashMethodCash")}</option>
          <option value="bKash">{t(uiLang, "dashMethodBkash")}</option>
          <option value="Nagad">{t(uiLang, "dashMethodNagad")}</option>
          <option value="Rocket">{t(uiLang, "dashMethodRocket")}</option>
          <option value="Card">{t(uiLang, "dashMethodCard")}</option>
          <option value="Split">{tt("posPaySplit")}</option>
          <option value="Due">{tt("posPayDueCredit")}</option>
        </select>

        {paymentMethod !== "Split" ? (
          <>
            <input
              type="number"
              placeholder={tt("posPaidAmtPh")}
              value={paidAmount}
              onChange={(e) => setPaidAmount(e.target.value)}
              style={{ marginTop: 6 }}
            />
            <input
              placeholder={
                DIGITAL_METHODS.has(paymentMethod) ? tt("posTxnRefRequired") : tt("posPayNoteOpt")
              }
              value={paymentChannel}
              onChange={(e) => setPaymentChannel(e.target.value)}
            />
            <div className="pos-action-row">
              <button type="button" className="btn-secondary btn-sm" onClick={() => quickApplyPaymentMode("cash")}>
                {tt("posQuickCashFull")}
              </button>
              <button type="button" className="btn-secondary btn-sm" onClick={() => quickApplyPaymentMode("bkash")}>
                {tt("posQuickBkashFull")}
              </button>
              <button type="button" className="btn-secondary btn-sm" onClick={() => quickApplyPaymentMode("card")}>
                {tt("posQuickCardFull")}
              </button>
              <button type="button" className="btn-secondary btn-sm" onClick={() => quickApplyPaymentMode("due")}>
                {tt("posQuickDueFull")}
              </button>
            </div>
          </>
        ) : (
          <div className="pos-settings-box" style={{ marginTop: 6 }}>
            {paymentBreakdown.map((line, idx) => (
              <div key={`pay-line-${idx}`} className="pos-discount-row" style={{ marginBottom: 6 }}>
                <select className="form-select-sm" value={line.method} onChange={(e) => updatePaymentLine(idx, "method", e.target.value)}>
                  <option value="Cash">{t(uiLang, "dashMethodCash")}</option>
                  <option value="bKash">{t(uiLang, "dashMethodBkash")}</option>
                  <option value="Nagad">{t(uiLang, "dashMethodNagad")}</option>
                  <option value="Rocket">{t(uiLang, "dashMethodRocket")}</option>
                  <option value="Card">{t(uiLang, "dashMethodCard")}</option>
                </select>
                <input
                  type="number"
                  placeholder={tt("posAmtShort")}
                  value={line.amount}
                  onChange={(e) => updatePaymentLine(idx, "amount", e.target.value)}
                />
                <input
                  placeholder={
                    DIGITAL_METHODS.has(String(line.method || ""))
                      ? tt("posTxnRefRequired")
                      : tt("posNoteShort")
                  }
                  value={line.channel}
                  onChange={(e) => updatePaymentLine(idx, "channel", e.target.value)}
                />
                <button type="button" className="btn-danger btn-sm" onClick={() => removePaymentLine(idx)}>
                  ✕
                </button>
              </div>
            ))}
            <div className="pos-action-row">
              <button type="button" className="btn-secondary btn-sm" onClick={addPaymentLine}>
                {tt("posAddPayLine")}
              </button>
              <span className="pos-inline-note">{tt("posSplitPaid", { n: formatBDT(splitPaidTotal) })}</span>
            </div>
          </div>
        )}
        {checkoutDue > 0 ? (
          <p className="pos-inline-note" style={{ color: "#b91c1c" }}>
            {tt("posDueAfter", { n: formatBDT(checkoutDue) })}
          </p>
        ) : null}
        </div>

        <div className="pos-step-card">
        <strong className="pos-step-title">{tt("posStep3Submit")}</strong>
        {managerApprovalNeeded && !canManageSettings ? (
          <p className="pos-inline-note" style={{ marginBottom: 8 }}>
            {tt("posMgrPermSettings")}
          </p>
        ) : null}
        {managerApprovalNeeded ? (
          <div className="pos-settings-box" style={{ borderColor: "#fca5a5", background: "#fff5f5" }}>
            <strong style={{ color: "#b91c1c" }}>{tt("posMgrApprovalReq")}</strong>
            <input
              placeholder={tt("posMgrPinPh")}
              value={managerApprovalPin}
              onChange={(e) => setManagerApprovalPin(e.target.value)}
              style={{ marginTop: 6 }}
            />
            <input
              placeholder={tt("posAprReasonPh")}
              value={approvalReason}
              onChange={(e) => setApprovalReason(e.target.value)}
            />
          </div>
        ) : null}

        {activeHoldAuditLogId != null ? (
          <p className="pos-inline-note">{tt("posCheckoutCloseHold", { n: activeHoldAuditLogId })}</p>
        ) : null}
        {activeQuoteAuditLogId != null ? (
          <p className="pos-inline-note">{tt("posCheckoutQuoteConv", { n: activeQuoteAuditLogId })}</p>
        ) : null}

        {fiscalBlocked ? (
          <div
            className="page-card"
            style={{
              marginBottom: 12,
              padding: "10px 12px",
              border: "1px solid #fdba74",
              background: "#fff7ed",
              borderRadius: 8,
            }}
          >
            <strong style={{ color: "#9a3412" }}>{tt("posFiscalBlockedTitle")}</strong>
            <p style={{ margin: "6px 0 0", fontSize: 13, color: "#9a3412" }}>
              {fiscalGateData?.message || tt("posFiscalNoPeriod")}
            </p>
          </div>
        ) : null}

        <div className="pos-submit-guide">
          <strong>{tt("posBeforeSubmit")}</strong>
          <div className="pos-submit-checks">
            {checkoutRequirements.map((check, idx) => (
              <span
                key={`chk-${idx}`}
                className={`pos-check-chip ${
                  check.ok || check.optional ? "pos-check-chip-ok" : "pos-check-chip-bad"
                }`}
                title={check.hint}
              >
                {check.ok || check.optional ? "✓" : "!"} {check.label}
              </span>
            ))}
          </div>
          {checkoutBlockers.length ? (
            <p className="pos-submit-warning">
              {tt("posMissingPrefix")} {checkoutBlockers.map((x) => x.hint).join(" · ")}
            </p>
          ) : (
            <p className="pos-submit-ready">{tt("posReadySubmitSale")}</p>
          )}
        </div>

        <button
          className="pos-checkout-btn"
          disabled={cart.length === 0 || fiscalBlocked}
          onClick={handleCheckout}
        >
          {tt("posCompleteCheckout", { n: formatBDT(total) })}
        </button>
        <p className="pos-inline-note" style={{ marginTop: 6 }}>
          {tt("posMainCheckoutNote")}
        </p>
        <div className="pos-secondary-row">
          <div className="pos-mini-guide">
            <button className="btn-secondary" disabled={cart.length === 0} onClick={handleHoldCart}>
              {tt("posHoldSaleF6")}
            </button>
            <p className={holdBlockers.length ? "pos-submit-warning" : "pos-submit-ready"}>
              {holdBlockers.length ? holdBlockers.map((x) => x.hint).join(" · ") : tt("posReadyHold")}
            </p>
          </div>
          <div className="pos-mini-guide">
            <button
              type="button"
              className="btn-secondary"
              disabled={cart.length === 0}
              onClick={handleSaveQuote}
            >
              {tt("posSaveQuotation")}
            </button>
            <p className={quoteBlockers.length ? "pos-submit-warning" : "pos-submit-ready"}>
              {quoteBlockers.length ? quoteBlockers.map((x) => x.hint).join(" · ") : tt("posReadyQuote")}
            </p>
          </div>
        </div>
        </div>

            </div>
          ) : null}

          {posCartTab === "customer" ? (
            <div className="pos-tab-panel" role="tabpanel">
        <label className="pos-inline-note" style={{ display: "block", marginBottom: 6 }}>
          {tt("posCustOptional")}
        </label>
        <input
          placeholder={tt("posCustNamePh")}
          value={customer.name}
          onChange={(e) => setCustomer({ ...customer, name: e.target.value })}
        />
        <input
          placeholder={tt("posCustPhonePh")}
          value={customer.phone}
          onChange={(e) => setCustomer({ ...customer, phone: e.target.value })}
        />

        {String(customer.phone || "").trim().length >= 6 ? (
          <div className="pos-settings-box" style={{ marginTop: 10 }}>
            <strong>{tt("posPurchaseHist")}</strong>
            <span className="pos-inline-note" style={{ marginLeft: 8 }}>
              {customerHistoryLoading ? tt("posLoadingEllipsis") : tt("posNRecent", { n: customerRecentSales.length })}
            </span>
            <div style={{ marginTop: 8 }}>
              {customerHistoryLoading ? (
                <p className="pos-inline-note">{tt("posLoadingBills")}</p>
              ) : !customerRecentSales.length ? (
                <p className="pos-inline-note">{tt("posNoPastSalesBranch")}</p>
              ) : (
                <div style={{ maxHeight: 220, overflow: "auto" }}>
                  {customerRecentSales.map((sale) => {
                    const open = expandedHistorySaleId === sale.id;
                    const when = sale.createdAt
                      ? new Date(sale.createdAt).toLocaleString(receiptLocale)
                      : "";
                    return (
                      <div
                        key={sale.id}
                        style={{
                          borderBottom: "1px solid #e5e7eb",
                          padding: "6px 0",
                          fontSize: 13,
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => setExpandedHistorySaleId(open ? null : sale.id)}
                          style={{
                            width: "100%",
                            textAlign: "left",
                            background: "transparent",
                            border: "none",
                            padding: 0,
                            cursor: "pointer",
                            font: "inherit",
                          }}
                        >
                          <strong>{sale.invoiceNo || tt("posSaleNum", { n: sale.id })}</strong>
                          {" · "}
                          {when}
                          <br />
                          <span>{formatBDT(sale.total)}</span>
                          {Number(sale.dueAmount || 0) > 0 ? (
                            <span className="pos-inline-note">
                              {" "}
                              · {tt("posDueWord")} {formatBDT(sale.dueAmount)}
                            </span>
                          ) : null}
                          <span className="pos-inline-note">{open ? " ▲" : " ▼"}</span>
                        </button>
                        {open && Array.isArray(sale.lines) && sale.lines.length ? (
                          <ul style={{ margin: "6px 0 0 16px", padding: 0, color: "#475569", fontSize: 12 }}>
                            {sale.lines.slice(0, 12).map((ln, idx) => (
                              <li key={`${sale.id}-${idx}`}>
                                {ln.label}
                                {getVariantMetaFromLine(ln) ? ` (${getVariantMetaFromLine(ln)})` : ""}
                                {" · "}
                                {Number(ln.qty || 0).toFixed(Number(ln.qty || 0) % 1 === 0 ? 0 : 3)} ×{" "}
                                {formatBDT(ln.unitPrice)} = {formatBDT(ln.lineTotal)}
                              </li>
                            ))}
                            {sale.lines.length > 12 ? (
                              <li className="pos-inline-note">{tt("posMoreLines", { n: sale.lines.length - 12 })}</li>
                            ) : null}
                          </ul>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : null}

        {customerLoyalty ? (
          <div className="pos-settings-box" style={{ marginTop: 10 }}>
            <strong>
              {tt("posLoyaltyRewards")} · {Number(customerLoyalty.loyaltyPoints || 0).toFixed(0)} {tt("posPtsAbbr")} ·{" "}
              {customerLoyalty.loyaltyTier || "—"}
            </strong>
            <p>
              <strong>{tt("custPriceTier")}</strong> {String(customerLoyalty.priceTier || "RETAIL").toUpperCase()}
            </p>
            <p>
              <strong>{tt("posWalletLabel")}</strong> {formatBDT(Number(customerLoyalty.storedValueBalance || 0))}
            </p>
            <p>
              <strong>{tt("posTierDiscLabel")}</strong> {tierDiscountPercent}% ({formatBDT(tierDiscountAmount)})
            </p>
            <p>
              <strong>{tt("posMaxRedeemRule")}</strong> {maxRedeemByPercentPoints.toFixed(0)} {tt("posPtsAbbr")}
            </p>
            <input
              type="number"
              placeholder={tt("posRedeemPtsPh")}
              value={redeemPoints}
              onChange={(e) => setRedeemPoints(e.target.value)}
            />
            <p>
              <strong>{tt("posRedeemDiscLabel")}</strong> {formatBDT(redeemDiscountAmount)}
            </p>
            {safeRedeemPoints > appliedRedeemPoints ? (
              <p className="pos-inline-note">{tt("posRedeemAdjusted")}</p>
            ) : null}
            {creditLimitVal > 0 ? (
              <>
                <p>
                  <strong>{tt("posCreditLimitLabel")}</strong> {formatBDT(creditLimitVal)} ·{" "}
                  <strong>{tt("posCurrentDueLabel")}</strong> {formatBDT(customerBalance)}
                </p>
                {checkoutDue > 0 ? (
                  <p>
                    <strong>{tt("posAfterThisBill")}</strong> {formatBDT(customerBalance + checkoutDue)}
                    {creditWouldExceed ? (
                      <span style={{ color: "#b91c1c", marginLeft: 8 }}>{tt("posOverLimitPin")}</span>
                    ) : null}
                  </p>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}

            </div>
          ) : null}

          {posCartTab === "offers" ? (
            <div className="pos-tab-panel" role="tabpanel">
            <p className="pos-inline-note" style={{ marginBottom: 8 }}>
              {tt("posOffersTabIntro")}
            </p>
            <input
              placeholder={tt("posCouponPh")}
              value={couponCode}
              onChange={(e) => setCouponCode(e.target.value)}
            />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
              <input
                placeholder={tt("posGiftCodePh")}
                value={giftCardCode}
                onChange={(e) => setGiftCardCode(e.target.value)}
                style={{ minWidth: 120, flex: 1 }}
              />
              <input
                type="number"
                placeholder={tt("posGiftAmtPh")}
                value={giftCardAmount}
                onChange={(e) => setGiftCardAmount(e.target.value)}
                style={{ width: 130 }}
              />
            </div>
            <input
              type="number"
              placeholder={tt("posWalletRedeemPh")}
              value={walletRedeemAmount}
              onChange={(e) => setWalletRedeemAmount(e.target.value)}
              style={{ marginTop: 6 }}
            />
            <input
              placeholder={tt("posBuyerBinPh")}
              value={buyerBinOrNidNote}
              onChange={(e) => setBuyerBinOrNidNote(e.target.value)}
              style={{ marginTop: 6 }}
            />
            <p className="pos-inline-note" style={{ marginTop: 6 }}>
              {tt("posBillAfterWallet", { n: formatBDT(billAfterWalletGift) })}
            </p>
            </div>
          ) : null}

          {posCartTab === "more" ? (
            <div className="pos-tab-panel" role="tabpanel">
        <details className="pos-section">
          <summary>
            {tt("posHoldQuoteTitle")}
            <span className="pos-section-hint">{tt("posOptional")}</span>
          </summary>
          <div className="pos-section-body">
            <input
              placeholder={tt("posHoldNotePh")}
              value={holdNote}
              onChange={(e) => setHoldNote(e.target.value)}
            />
            <input
              placeholder={tt("posQuoteNotePh")}
              value={quoteNote}
              onChange={(e) => setQuoteNote(e.target.value)}
              style={{ marginTop: 6 }}
            />
          </div>
        </details>

        <details className="pos-section">
          <summary>
            {tt("posTplSection")}
            <span className="pos-section-hint">{tt("posTplSavedCount", { n: cartTemplates.length })}</span>
          </summary>
          <div className="pos-section-body">
            <div className="pos-discount-row">
              <input
                placeholder={tt("posTplNamePh")}
                value={cartTemplateName}
                onChange={(e) => setCartTemplateName(e.target.value)}
              />
              <button type="button" className="btn-secondary btn-sm" onClick={saveCartTemplate}>
                {tt("posSaveCurrentCart")}
              </button>
            </div>
            {cartTemplates.length ? (
              <div style={{ marginTop: 8, maxHeight: 140, overflow: "auto" }}>
                {cartTemplates.map((tpl) => (
                  <div key={tpl.id} className="pos-action-row" style={{ marginBottom: 6 }}>
                    <span className="pos-inline-note">
                      {tpl.name} ({tt("posTplItemsCount", { n: Array.isArray(tpl.cart) ? tpl.cart.length : 0 })})
                    </span>
                    <button type="button" className="btn-secondary btn-sm" onClick={() => loadCartTemplate(tpl)}>
                      {tt("posBtnLoad")}
                    </button>
                    <button type="button" className="btn-danger btn-sm" onClick={() => deleteCartTemplate(tpl.id)}>
                      {tt("posBtnDelete")}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="pos-inline-note" style={{ marginTop: 8 }}>
                {tt("posTplEmpty")}
              </p>
            )}
          </div>
        </details>

        <details className="pos-section">
          <summary>
            {tt("posRcptSection")}
            <span className="pos-section-hint">{paperSize}mm</span>
          </summary>
          <div className="pos-section-body">
            <div className="pos-receipt-row">
              <label>
                {tt("posPaperSizeLbl")}
                <select
                  className="form-select-sm pos-receipt-size"
                  value={paperSize}
                  onChange={(e) => setPaperSize(e.target.value)}
                >
                  <option value="58">58mm</option>
                  <option value="80">80mm</option>
                </select>
              </label>
            </div>
            <div className="pos-action-row">
              <button type="button" className="btn-secondary btn-sm" onClick={() => setShowStoreSettings((prev) => !prev)}>
                {showStoreSettings ? tt("posHideInvoiceSettings") : tt("posShowInvoiceSettings")}
              </button>
              <button type="button" className="btn-secondary btn-sm" onClick={handleTestPrint}>
                {tt("posTestPrint")}
              </button>
              <button type="button" className="btn-secondary btn-sm" onClick={handleTestPreview}>
                {tt("posPreview")}
              </button>
            </div>
            {showStoreSettings && (
              <div className="pos-settings-box">
                <input
                  placeholder={tt("posInvStoreName")}
                  value={storeSettings.storeName}
                  onChange={(e) =>
                    setStoreSettings((prev) => ({ ...prev, storeName: e.target.value }))
                  }
                />
                <input
                  placeholder={tt("posInvStoreAddr")}
                  value={storeSettings.storeAddress}
                  onChange={(e) =>
                    setStoreSettings((prev) => ({ ...prev, storeAddress: e.target.value }))
                  }
                  style={{ marginTop: 6 }}
                />
                <input
                  placeholder={tt("posInvStorePhone")}
                  value={storeSettings.storePhone}
                  onChange={(e) =>
                    setStoreSettings((prev) => ({ ...prev, storePhone: e.target.value }))
                  }
                  style={{ marginTop: 6 }}
                />
                <input
                  placeholder={tt("posInvFooter")}
                  value={storeSettings.footerMessage}
                  onChange={(e) =>
                    setStoreSettings((prev) => ({ ...prev, footerMessage: e.target.value }))
                  }
                  style={{ marginTop: 6 }}
                />
                <select
                  className="form-select-sm"
                  value={storeSettings.receiptLanguage || "en"}
                  onChange={(e) =>
                    setStoreSettings((prev) => ({ ...prev, receiptLanguage: e.target.value }))
                  }
                  style={{ marginTop: 6 }}
                >
                  <option value="en">{tt("posRcptLangEn")}</option>
                  <option value="bn">{tt("posRcptLangBn")}</option>
                </select>
                <input type="file" accept="image/*" onChange={handleLogoChange} style={{ marginTop: 6 }} />
                {storeSettings.logoDataUrl ? (
                  <div className="pos-logo-preview">
                    <img
                      src={storeSettings.logoDataUrl}
                      alt={tt("posLogoAlt")}
                      className="pos-logo-image"
                    />
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => setStoreSettings((prev) => ({ ...prev, logoDataUrl: "" }))}
                    >
                      {tt("posRemoveLogo")}
                    </button>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </details>

            </div>
          ) : null}

          {posCartTab === "activity" ? (
            <div className="pos-tab-panel" role="tabpanel">
            <h4 style={{ margin: "0 0 8px", fontSize: 14 }}>{tt("posActRecentSales", { n: recentSales.length })}</h4>
            {recentSales.length === 0 ? (
              <p className="pos-inline-note">{tt("posActNoSales")}</p>
            ) : (
              recentSales.slice(0, 5).map((sale) => (
                <div key={sale.id} className="pos-recent-sale-row">
                  <span style={{ flex: 1 }}>
                    {sale.invoiceNo} — {formatBDT(sale.total)} ({sale.paymentMethod})
                  </span>
                  <button className="btn-secondary btn-sm" onClick={() => printInvoice(sale.id)}>
                    {tt("posBtnPrint")}
                  </button>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => openMushakPdf(sale.id)}>
                    {tt("posBtnMushak")}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    title={tt("posXmlDownloadTitle")}
                    onClick={() => downloadMushak63Xml(sale)}
                  >
                    {tt("posBtnXml")}
                  </button>
                  <button className="btn-secondary btn-sm" onClick={() => handleSalePreview(sale.id)}>
                    {tt("posPreview")}
                  </button>
                </div>
              ))
            )}

            {showHeldPanel ? (
              <>
                <h4 style={{ margin: "14px 0 6px", fontSize: 14 }}>{tt("posHeldCartsTitle", { n: heldCarts.length })}</h4>
                <input
                  placeholder={tt("posHoldSearchPh")}
                  value={holdSearch}
                  onChange={(e) => setHoldSearch(e.target.value)}
                />
                <DataTable
                  rows={heldCarts.map((row) => ({
                    ...row,
                    createdAtLabel: new Date(row.createdAt).toLocaleString(),
                    itemsPreview: Array.isArray(row.cart)
                      ? row.cart
                          .slice(0, 2)
                          .map((it) => {
                            const vMeta = getVariantDisplayMeta(it?.matchedVariant) || getVariantMetaFromLine(it);
                            return `${it?.name || tt("receiptItem")}${vMeta ? ` (${vMeta})` : ""}`;
                          })
                          .join(" | ")
                      : "",
                  }))}
                  pageSize={5}
                  allowExport={false}
                  columns={[
                    { key: "id", label: tt("posColId") },
                    { key: "heldByName", label: tt("posColHeldBy"), render: (v) => v || "-" },
                    { key: "customerName", label: tt("posColCustomer"), render: (v) => v || "-" },
                    { key: "customerPhone", label: tt("posColPhone"), render: (v) => v || "-" },
                    { key: "cartCount", label: tt("posColItems") },
                    { key: "totalQty", label: tt("posColQty") },
                    {
                      key: "itemsPreview",
                      label: tt("posColItemDetails"),
                      render: (v, row) =>
                        v ||
                        (Number(row?.cartCount || 0) > 2
                          ? tt("posTplItemsCount", { n: Number(row?.cartCount || 0) })
                          : "-"),
                    },
                    { key: "holdNote", label: tt("posColNote"), render: (v) => v || "-" },
                    { key: "createdAtLabel", label: tt("posColHeldAt") },
                    {
                      key: "actions",
                      label: tt("posColActions"),
                      render: (_, row) => (
                        <div style={{ display: "flex", gap: 6 }}>
                          <button type="button" className="btn-secondary btn-sm" onClick={() => resumeHeldCart(row)}>
                            {tt("posBtnResume")}
                          </button>
                          <button type="button" className="btn-danger btn-sm" onClick={() => discardHeldCart(row)}>
                            {tt("posBtnDiscard")}
                          </button>
                        </div>
                      ),
                    },
                  ]}
                />
              </>
            ) : (
              <p className="pos-inline-note" style={{ marginTop: 12 }}>
                {tt("posHeldPanelHint")}
              </p>
            )}

            <h4 style={{ margin: "14px 0 6px", fontSize: 14 }}>{tt("posOffQueueHeading", { n: offlineQueueRows.length })}</h4>
            <DataTable
              rows={offlineQueueRows}
              pageSize={5}
              allowExport={false}
              columns={[
                { key: "rowNo", label: tt("posColId") },
                { key: "localRef", label: tt("posColLocalRef") },
                {
                  key: "status",
                  label: tt("posColStatus"),
                  render: (v) => {
                    const s = String(v || "").toUpperCase();
                    if (s === "FAILED") return <span className="badge badge-danger">{tt("posOffStFailed")}</span>;
                    if (s === "QUEUED") return <span className="badge badge-warning">{tt("posOffStQueued")}</span>;
                    if (s === "REVIEWING") return <span className="badge badge-primary">{tt("posOffStReviewing")}</span>;
                    if (s === "RESOLVED") return <span className="badge badge-success">{tt("posOffStResolved")}</span>;
                    return s || "-";
                  },
                },
                { key: "conflictType", label: tt("posColConflict"), render: (v) => v || "-" },
                { key: "retryCount", label: tt("posColRetries"), render: (v) => Number(v || 0) },
                { key: "lastError", label: tt("posColLastError"), render: (v) => v || "-" },
                { key: "conflictHint", label: tt("posColResolverHint"), render: (v) => v || "-" },
                { key: "resolverTag", label: tt("posColTag"), render: (v) => v || "-" },
                { key: "createdAtLabel", label: tt("posColQueuedAt") },
                {
                  key: "actions",
                  label: tt("posColActions"),
                  render: (_, row) => (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button type="button" className="btn-secondary btn-sm" onClick={() => tagQueuedSale(row)}>
                        {tt("posBtnTag")}
                      </button>
                      <button type="button" className="btn-secondary btn-sm" onClick={() => loadQueuedSaleToCart(row)}>
                        {tt("posBtnLoad")}
                      </button>
                      <button type="button" className="btn-secondary btn-sm" onClick={() => markQueuedSaleResolved(row)}>
                        {tt("posBtnResolved")}
                      </button>
                      <button type="button" className="btn-secondary btn-sm" onClick={() => retryQueuedSale(row)}>
                        {tt("posBtnRetry")}
                      </button>
                      <button type="button" className="btn-secondary btn-sm" onClick={() => resolveQueuedSaleConflict(row)}>
                        {tt("posBtnResolve")}
                      </button>
                      <button
                        type="button"
                        className="btn-danger btn-sm"
                        disabled={!canDiscardOfflineQueue}
                        onClick={() => discardQueuedSale(row)}
                      >
                        {tt("posBtnDiscard")}
                      </button>
                    </div>
                  ),
                },
              ]}
            />

            <h4 style={{ margin: "14px 0 6px", fontSize: 14 }}>{tt("posOffLogHeading", { n: offlineLog.length })}</h4>
            <DataTable
              rows={offlineLog.map((x, idx) => ({ rowNo: idx + 1, ...x, createdAtLabel: new Date(x.createdAt).toLocaleString() }))}
              pageSize={5}
              allowExport={false}
              columns={[
                { key: "rowNo", label: tt("posColId") },
                { key: "type", label: tt("posColType") },
                { key: "localRef", label: tt("posColLocalRef"), render: (v) => v || "-" },
                { key: "message", label: tt("posColMessage") },
                { key: "createdAtLabel", label: tt("posColTime") },
              ]}
            />

            </div>
          ) : null}
        </div>

        <p className="pos-shortcut-hint">{tt("posShortcutHintBar")}</p>
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
                {tt("posClosePreview")}
              </button>
            </div>
            <iframe
              title={tt("posIframeReceiptPreview")}
              srcDoc={previewHtml}
              className="pos-preview-frame"
            />
          </div>
        </div>
      )}
    </div>
    </div>
  );
}

export default POS;