import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildLoyaltyCardUrl,
  fetchLoyaltyCardInfo,
  parseLoyaltyCardToken,
  requestLoyaltyOtp,
  verifyLoyaltyOtp,
} from "../services/loyaltyPublic";
import { getLang, t } from "../i18n";
import { formatBDT } from "../utils/currency";

function useLoyaltyCardToken() {
  const read = () => parseLoyaltyCardToken(typeof window !== "undefined" ? window.location.hash : "");
  const [token, setToken] = useState(read);
  useEffect(() => {
    const onChange = () => setToken(read());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return token;
}

export default function LoyaltyCard() {
  const cardToken = useLoyaltyCardToken();
  const [lang, setLang] = useState(() => getLang());
  const tt = useCallback((key, params) => t(lang, key, params), [lang]);

  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState(null);
  const [error, setError] = useState("");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [balance, setBalance] = useState(null);
  const [simulatedOtp, setSimulatedOtp] = useState("");

  useEffect(() => {
    if (!cardToken) {
      setLoading(false);
      setError("missing_card");
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetchLoyaltyCardInfo(cardToken);
        if (!cancelled) {
          setInfo(res);
          setError("");
        }
      } catch (err) {
        if (!cancelled) setError(err?.response?.data?.error || err?.message || "load_failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cardToken]);

  const sendOtp = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await requestLoyaltyOtp({ cardToken, phone });
      setOtpSent(true);
      setSimulatedOtp(res.simulatedOtp || "");
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || "otp_failed");
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await verifyLoyaltyOtp({ cardToken, phone, otp });
      setBalance(res);
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || "verify_failed");
    } finally {
      setBusy(false);
    }
  };

  if (!cardToken) {
    return (
      <div className="storefront-shell">
        <div className="storefront-card">
          <h1>{tt("loyaltyCardTitle")}</h1>
          <p>{tt("loyaltyCardMissing")}</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="storefront-shell">
        <div className="storefront-card">{tt("storefrontLoading")}</div>
      </div>
    );
  }

  return (
    <div className="storefront-shell">
      <header className="storefront-header">
        <div>
          <h1 className="storefront-store-name">{info?.storeName || tt("loyaltyCardTitle")}</h1>
          <div className="storefront-meta">{tt("loyaltyCardSubtitle")}</div>
        </div>
        <button type="button" className="btn-secondary btn-sm" onClick={() => setLang(lang === "bn" ? "en" : "bn")}>
          {lang === "bn" ? "English" : "বাংলা"}
        </button>
      </header>

      <div className="storefront-card">
        {error && !balance ? <p className="storefront-mfs-error">{error}</p> : null}
        {balance ? (
          <div className="storefront-success" style={{ textAlign: "left" }}>
            <h2>{tt("loyaltyCardHello", { name: balance.customerName || info?.customerName || "" })}</h2>
            <p>
              <strong>{tt("loyaltyCardPoints")}:</strong> {Number(balance.availablePoints || 0).toFixed(0)}
            </p>
            <p className="text-muted">
              {tt("loyaltyCardSpent")}: {formatBDT(balance.totalSpent || 0, { lang, decimals: 0 })} · {tt("loyaltyCardOrders")}:{" "}
              {balance.orders || 0}
            </p>
            {balance.expiringSoonPoints > 0 ? (
              <p className="text-muted">{tt("loyaltyCardExpiring", { n: balance.expiringSoonPoints })}</p>
            ) : null}
          </div>
        ) : (
          <>
            <p>{tt("loyaltyCardIntro", { store: info?.storeName || "", phone: info?.maskedPhone || "—" })}</p>
            <form className="form-grid" onSubmit={verify}>
              <input
                required
                placeholder={tt("loyaltyCardPhonePh")}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
              {!otpSent ? (
                <button type="button" className="btn-primary" disabled={busy} onClick={sendOtp}>
                  {busy ? "…" : tt("loyaltyCardSendOtp")}
                </button>
              ) : (
                <>
                  <input
                    required
                    placeholder={tt("loyaltyCardOtpPh")}
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                  />
                  {simulatedOtp ? (
                    <p className="text-muted" style={{ fontSize: 12 }}>
                      {tt("loyaltyCardSimOtp", { otp: simulatedOtp })}
                    </p>
                  ) : null}
                  <button type="submit" className="btn-primary" disabled={busy}>
                    {busy ? "…" : tt("loyaltyCardVerify")}
                  </button>
                </>
              )}
            </form>
          </>
        )}
      </div>
    </div>
  );
}
