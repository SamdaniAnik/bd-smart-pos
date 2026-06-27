import { useEffect, useState } from "react";
import QRCode from "qrcode";

function QrCodeImage({ value, size = 200, alt = "QR code" }) {
  const [src, setSrc] = useState("");

  useEffect(() => {
    let cancelled = false;
    const text = String(value || "").trim();
    if (!text) {
      setSrc("");
      return undefined;
    }
    QRCode.toDataURL(text, {
      width: size,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#0f172a", light: "#ffffff" },
    })
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setSrc("");
      });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (!src) return null;
  return <img src={src} alt={alt} width={size} height={size} style={{ imageRendering: "pixelated" }} />;
}

export default QrCodeImage;
