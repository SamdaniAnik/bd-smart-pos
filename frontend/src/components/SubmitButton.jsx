/**
 * Primary submit control: disables while loading and shows an inline spinner.
 */
export default function SubmitButton({
  loading = false,
  loadingLabel = "Saving…",
  children,
  className = "",
  disabled,
  ...rest
}) {
  const mergedClass = ["btn-submit-enhanced", loading ? "is-loading" : "", className].filter(Boolean).join(" ");
  return (
    <button
      type="submit"
      {...rest}
      disabled={Boolean(loading || disabled)}
      className={mergedClass}
      aria-busy={loading || undefined}
    >
      {loading ? <span className="btn-spinner" aria-hidden="true" /> : null}
      <span className="btn-submit-label">{loading ? loadingLabel : children}</span>
    </button>
  );
}
