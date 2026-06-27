/** Clean, lightweight overrides — flatter control, subtle borders, consistent
 *  with the app's inputs and tables. Keeps react-select's default behavior. */
export function createSearchSelectStyles() {
  return {
    container: (base) => ({
      ...base,
      width: "100%",
      minWidth: 0,
    }),
    control: (base, state) => ({
      ...base,
      minHeight: 30,
      borderRadius: 9,
      borderColor: state.isFocused ? "#6366f1" : "#e2e8f0",
      boxShadow: state.isFocused ? "0 0 0 3px rgba(99, 102, 241, 0.15)" : "none",
      backgroundColor: "#ffffff",
      fontSize: 12,
      transition: "border-color 0.15s ease, box-shadow 0.15s ease",
      "&:hover": {
        borderColor: state.isFocused ? "#6366f1" : "#cbd5e1",
      },
    }),
    valueContainer: (base) => ({
      ...base,
      padding: "0 8px",
    }),
    placeholder: (base) => ({
      ...base,
      color: "#94a3b8",
    }),
    indicatorSeparator: () => ({ display: "none" }),
    dropdownIndicator: (base) => ({
      ...base,
      padding: 4,
      color: "#94a3b8",
    }),
    clearIndicator: (base) => ({
      ...base,
      padding: 4,
      color: "#94a3b8",
    }),
    menu: (base) => ({
      ...base,
      zIndex: 9999,
      borderRadius: 10,
      overflow: "hidden",
      border: "1px solid #e2e8f0",
      boxShadow: "0 8px 24px rgba(15, 23, 42, 0.12)",
      fontSize: 12,
    }),
    menuPortal: (base) => ({
      ...base,
      zIndex: 9999,
    }),
    option: (base, state) => ({
      ...base,
      backgroundColor: state.isSelected
        ? "#6366f1"
        : state.isFocused
        ? "rgba(99, 102, 241, 0.08)"
        : "#ffffff",
      color: state.isSelected ? "#ffffff" : "#1e293b",
      cursor: "pointer",
    }),
  };
}
