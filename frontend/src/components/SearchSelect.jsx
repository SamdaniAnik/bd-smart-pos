import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Select from "react-select";
import AsyncSelect from "react-select/async";
import { createSearchSelectStyles } from "../utils/selectStyles";
import { loadLookupOptions, resolveLookupOption } from "../services/lookupApi";

const LOOKUP_KINDS = new Set([
  "products",
  "customers",
  "suppliers",
  "branches",
  "warehouses",
  "users",
  "categories",
  "purchases",
]);

const SELECT_STYLES = createSearchSelectStyles();

function normalizeStaticOptions(options) {
  return (options || []).map((opt) => ({
    value: String(opt.value),
    label: String(opt.label ?? opt.value),
    raw: opt.raw ?? null,
    isDisabled: Boolean(opt.isDisabled),
  }));
}

function debounce(fn, wait = 300) {
  let timer;
  const debounced = (...args) =>
    new Promise((resolve) => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        resolve(await fn(...args));
      }, wait);
    });
  debounced.cancel = () => clearTimeout(timer);
  return debounced;
}

/**
 * Searchable select using react-select default design.
 * - `kind` → backend AsyncSelect (/master/lookup/:type)
 * - `options` → static Select with client filter
 */
export default function SearchSelect({
  kind = null,
  options = null,
  value = "",
  onChange,
  onOptionChange,
  placeholder = "",
  isClearable = true,
  isDisabled = false,
  isSearchable = true,
  className = "",
  menuPortalTarget = null,
  extraParams = {},
  defaultOptions = true,
  inputId,
  name,
  "aria-label": ariaLabel,
}) {
  const isLookup = kind && LOOKUP_KINDS.has(kind);
  const staticOptions = useMemo(() => normalizeStaticOptions(options), [options]);
  const extraParamsKey = useMemo(() => JSON.stringify(extraParams || {}), [extraParams]);

  const [selectedOption, setSelectedOption] = useState(null);
  const valueRef = useRef(value);

  const findStaticOption = useCallback(
    (val) => staticOptions.find((opt) => opt.value === String(val)) || null,
    [staticOptions]
  );

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    let cancelled = false;

    async function syncValue() {
      if (value == null || value === "") {
        if (!cancelled) setSelectedOption(null);
        return;
      }

      if (isLookup) {
        const resolved = await resolveLookupOption(kind, value, extraParams);
        if (!cancelled && String(valueRef.current) === String(value)) {
          setSelectedOption(resolved);
        }
        return;
      }

      if (!cancelled) {
        setSelectedOption(findStaticOption(value));
      }
    }

    syncValue();
    return () => {
      cancelled = true;
    };
  }, [value, kind, isLookup, extraParamsKey, findStaticOption]);

  const loadOptions = useMemo(() => {
    if (!isLookup) return null;
    const loader = async (inputValue) => loadLookupOptions(kind, inputValue, extraParams);
    return debounce(loader, 280);
  }, [kind, isLookup, extraParamsKey]);

  useEffect(() => () => loadOptions?.cancel?.(), [loadOptions]);

  const handleChange = (opt) => {
    setSelectedOption(opt || null);
    onChange?.(opt?.value ?? "");
    onOptionChange?.(opt || null);
  };

  const resolvedPortalTarget =
    menuPortalTarget === null && typeof document !== "undefined"
      ? document.body
      : menuPortalTarget;

  const commonProps = {
    value: selectedOption,
    onChange: handleChange,
    placeholder,
    isClearable,
    isDisabled,
    isSearchable,
    styles: SELECT_STYLES,
    inputId,
    name,
    "aria-label": ariaLabel,
    menuPortalTarget: resolvedPortalTarget || undefined,
    menuPosition: resolvedPortalTarget ? "fixed" : "absolute",
    menuShouldScrollIntoView: true,
    filterOption: isLookup
      ? () => true
      : (option, input) => {
          if (!input) return true;
          const q = input.toLowerCase();
          return String(option.label || "").toLowerCase().includes(q);
        },
  };

  const wrapClass = ["search-select-wrap", className].filter(Boolean).join(" ");

  if (isLookup) {
    return (
      <div className={wrapClass}>
        <AsyncSelect
          {...commonProps}
          cacheOptions
          defaultOptions={defaultOptions}
          loadOptions={loadOptions}
          noOptionsMessage={({ inputValue }) =>
            inputValue ? "No matches" : "Type to search…"
          }
        />
      </div>
    );
  }

  return (
    <div className={wrapClass}>
      <Select {...commonProps} options={staticOptions} />
    </div>
  );
}

export { LOOKUP_KINDS };
