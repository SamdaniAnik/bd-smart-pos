/** Camera barcode scan using BarcodeDetector when available (Android Chrome). */
export async function scanBarcodeFromCamera({ onResult, onError, videoEl }) {
  if (!("BarcodeDetector" in window)) {
    onError?.(new Error("BarcodeDetector not supported — use manual entry or USB scanner"));
    return () => {};
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment" },
    audio: false,
  });
  videoEl.srcObject = stream;
  await videoEl.play();
  const detector = new window.BarcodeDetector({
    formats: ["ean_13", "ean_8", "code_128", "code_39", "upc_a", "qr_code"],
  });
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const codes = await detector.detect(videoEl);
      if (codes?.length) {
        const value = codes[0].rawValue;
        if (value) {
          onResult?.(value);
          stopped = true;
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
      }
    } catch {
      /* frame skip */
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return () => {
    stopped = true;
    stream.getTracks().forEach((t) => t.stop());
  };
}
