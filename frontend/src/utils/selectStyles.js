export function createSearchSelectStyles(minHeight = 38) {
  return {
    control: (base) => ({
      ...base,
      minHeight,
      fontSize: "0.875rem",
    }),
    valueContainer: (base) => ({
      ...base,
      padding: "0 8px",
    }),
    input: (base) => ({
      ...base,
      margin: 0,
      padding: 0,
    }),
    indicatorsContainer: (base) => ({
      ...base,
      minHeight,
    }),
    dropdownIndicator: (base) => ({
      ...base,
      padding: 6,
    }),
    clearIndicator: (base) => ({
      ...base,
      padding: 6,
    }),
    menuList: (base) => ({
      ...base,
      fontSize: "0.875rem",
    }),
    menu: (base) => ({
      ...base,
      zIndex: 25,
    }),
  };
}
