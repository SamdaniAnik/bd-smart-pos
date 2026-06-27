import { useEffect, useState } from "react";

function readHash() {
  if (typeof window === "undefined") return "";
  return String(window.location.hash || "");
}

/** Sync `window.location.hash` for public routes (#/storefront, #/loyalty, …). */
export default function useHashRoute() {
  const [hash, setHash] = useState(readHash);

  useEffect(() => {
    const onChange = () => setHash(readHash());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  return hash;
}
