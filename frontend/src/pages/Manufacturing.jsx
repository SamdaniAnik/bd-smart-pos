import { useEffect, useMemo, useState } from "react";
import api from "../services/api";
import { getLang, t } from "../i18n";
import { notifyActionRequired, notifySuccess } from "../utils/notify";
import usePermissions from "../hooks/usePermissions";
import SearchSelect from "../components/SearchSelect";

function Manufacturing() {
  const lang = getLang();
  const tt = useMemo(() => (key, params) => t(lang, key, params), [lang]);
  const { hasPermission } = usePermissions();
  const canManage = hasPermission("inventory.adjust");

  const [tab, setTab] = useState("recipes");
  const [recipes, setRecipes] = useState([]);
  const [production, setProduction] = useState([]);
  const [rawProducts, setRawProducts] = useState([]);
  const [finishedProducts, setFinishedProducts] = useState([]);
  const [busy, setBusy] = useState(false);

  const [recipeForm, setRecipeForm] = useState({
    name: "",
    finishedProductId: "",
    yieldQty: 1,
    notes: "",
    lines: [{ rawProductId: "", qtyRequired: "" }],
  });
  const [runForm, setRunForm] = useState({ recipeId: "", batchCount: 1, notes: "" });

  const load = async () => {
    const [rRes, pRes, rawRes, finRes] = await Promise.all([
      api.get("/manufacturing/recipes"),
      api.get("/manufacturing/production"),
      api.get("/manufacturing/products?type=raw"),
      api.get("/manufacturing/products?type=finished"),
    ]);
    setRecipes(Array.isArray(rRes.data) ? rRes.data : []);
    setProduction(Array.isArray(pRes.data) ? pRes.data : []);
    setRawProducts(Array.isArray(rawRes.data) ? rawRes.data : []);
    setFinishedProducts(Array.isArray(finRes.data) ? finRes.data : []);
  };

  useEffect(() => {
    load();
  }, []);

  const saveRecipe = async () => {
    if (!canManage) return;
    const lines = recipeForm.lines
      .map((l) => ({
        rawProductId: Number(l.rawProductId),
        qtyRequired: Number(l.qtyRequired),
      }))
      .filter((l) => l.rawProductId && l.qtyRequired > 0);
    if (!recipeForm.name.trim() || !recipeForm.finishedProductId || !lines.length) {
      notifyActionRequired(tt("mfgRecipeValidation"));
      return;
    }
    setBusy(true);
    try {
      await api.post("/manufacturing/recipes", {
        name: recipeForm.name.trim(),
        finishedProductId: Number(recipeForm.finishedProductId),
        yieldQty: Number(recipeForm.yieldQty || 1),
        notes: recipeForm.notes,
        lines,
      });
      setRecipeForm({
        name: "",
        finishedProductId: "",
        yieldQty: 1,
        notes: "",
        lines: [{ rawProductId: "", qtyRequired: "" }],
      });
      await load();
      notifySuccess(tt("mfgRecipeSaved"));
    } catch (err) {
      notifyActionRequired(err?.response?.data?.error || tt("mfgRecipeFailed"));
    } finally {
      setBusy(false);
    }
  };

  const runProduction = async () => {
    if (!canManage) return;
    if (!runForm.recipeId) {
      notifyActionRequired(tt("mfgPickRecipe"));
      return;
    }
    setBusy(true);
    try {
      const res = await api.post("/manufacturing/production", {
        recipeId: Number(runForm.recipeId),
        batchCount: Number(runForm.batchCount || 1),
        notes: runForm.notes,
      });
      await load();
      notifySuccess(
        tt("mfgProductionOk", {
          qty: res.data?.finishedQty,
          name: res.data?.recipe?.finishedProduct?.name || "",
        })
      );
      setRunForm((f) => ({ ...f, batchCount: 1, notes: "" }));
    } catch (err) {
      notifyActionRequired(err?.response?.data?.error || tt("mfgProductionFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <div className="page-title">{tt("mfgTitle")}</div>
          <div className="page-subtitle">{tt("mfgSubtitle")}</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {["recipes", "produce", "history"].map((key) => (
          <button
            key={key}
            type="button"
            className={`btn-secondary btn-sm${tab === key ? " btn-primary" : ""}`}
            onClick={() => setTab(key)}
          >
            {tt(`mfgTab${key.charAt(0).toUpperCase()}${key.slice(1)}`)}
          </button>
        ))}
      </div>

      {tab === "recipes" ? (
        <>
          <div className="page-card">
            <h4 style={{ marginTop: 0 }}>{tt("mfgNewRecipe")}</h4>
            <p className="text-muted" style={{ fontSize: 13 }}>{tt("mfgNewRecipeHelp")}</p>
            <div style={{ display: "grid", gap: 8, maxWidth: 640 }}>
              <input
                placeholder={tt("mfgRecipeNamePh")}
                value={recipeForm.name}
                onChange={(e) => setRecipeForm({ ...recipeForm, name: e.target.value })}
              />
              <SearchSelect
                className="form-select-sm"
                value={recipeForm.finishedProductId}
                onChange={(val) => setRecipeForm({ ...recipeForm, finishedProductId: val })}
                placeholder={tt("mfgFinishedProductPh")}
                options={finishedProducts.map((p) => ({
                  value: String(p.id),
                  label: `${p.name}${p.sku ? ` (${p.sku})` : ""} — ${tt("mfgStock")}: ${p.stock}`,
                }))}
              />
              <label style={{ fontSize: 13 }}>
                {tt("mfgYieldQty")}{" "}
                <input
                  type="number"
                  min={0.001}
                  step="any"
                  value={recipeForm.yieldQty}
                  onChange={(e) => setRecipeForm({ ...recipeForm, yieldQty: e.target.value })}
                  style={{ width: 100, marginLeft: 8 }}
                />
              </label>
              {recipeForm.lines.map((line, idx) => (
                <div key={idx} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <SearchSelect
                    className="form-select-sm"
                    value={line.rawProductId}
                    onChange={(val) =>
                      setRecipeForm((prev) => ({
                        ...prev,
                        lines: prev.lines.map((x, i) =>
                          i === idx ? { ...x, rawProductId: val } : x
                        ),
                      }))
                    }
                    placeholder={tt("mfgRawMaterialPh")}
                    options={rawProducts
                      .filter((p) => String(p.id) !== String(recipeForm.finishedProductId))
                      .map((p) => ({
                        value: String(p.id),
                        label: `${p.name}${
                          p.isManufactured && p.isRawMaterial ? ` (${tt("mfgSemiFinishedTag")})` : ""
                        }${
                          p.isManufactured && !p.isRawMaterial ? ` (${tt("prodManufacturedItem")})` : ""
                        } — ${tt("mfgStock")}: ${p.sellByWeight ? `${p.stockKg} kg` : p.stock}`,
                      }))}
                  />
                  <input
                    type="number"
                    min={0.001}
                    step="any"
                    placeholder={tt("mfgQtyPerBatchPh")}
                    value={line.qtyRequired}
                    onChange={(e) =>
                      setRecipeForm((prev) => ({
                        ...prev,
                        lines: prev.lines.map((x, i) =>
                          i === idx ? { ...x, qtyRequired: e.target.value } : x
                        ),
                      }))
                    }
                    style={{ width: 120 }}
                  />
                </div>
              ))}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() =>
                    setRecipeForm((prev) => ({
                      ...prev,
                      lines: [...prev.lines, { rawProductId: "", qtyRequired: "" }],
                    }))
                  }
                >
                  + {tt("mfgAddRawLine")}
                </button>
                <button type="button" className="btn-primary btn-sm" disabled={busy || !canManage} onClick={saveRecipe}>
                  {tt("mfgSaveRecipe")}
                </button>
              </div>
            </div>
          </div>

          <div className="page-card">
            <h4 style={{ marginTop: 0 }}>{tt("mfgRecipeList")}</h4>
            {recipes.length === 0 ? (
              <p className="text-muted">{tt("mfgNoRecipes")}</p>
            ) : (
              recipes.map((recipe) => (
                <div key={recipe.id} className="rest-kot-card">
                  <strong>
                    {recipe.name} → {recipe.finishedProduct?.name}
                  </strong>
                  <p className="text-muted" style={{ margin: "4px 0", fontSize: 13 }}>
                    {tt("mfgYieldQty")}: {recipe.yieldQty} · {tt("mfgStock")}: {recipe.finishedProduct?.stock ?? 0}
                  </p>
                  <ul style={{ margin: "8px 0", paddingLeft: 18 }}>
                    {(recipe.lines || []).map((line) => (
                      <li key={line.id}>
                        {line.qtyRequired} × {line.rawProduct?.name}
                        {line.rawProduct?.isManufactured ? ` (${tt("mfgSemiFinishedTag")})` : ""} ({tt("mfgStock")}:{" "}
                        {line.rawProduct?.stock})
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>
        </>
      ) : null}

      {tab === "produce" ? (
        <div className="page-card">
          <h4 style={{ marginTop: 0 }}>{tt("mfgRunProduction")}</h4>
          <div style={{ display: "grid", gap: 8, maxWidth: 420 }}>
            <SearchSelect
              className="form-select-sm"
              value={runForm.recipeId}
              onChange={(val) => setRunForm({ ...runForm, recipeId: val })}
              placeholder={tt("mfgPickRecipe")}
              options={recipes
                .filter((r) => r.isActive !== false)
                .map((r) => ({
                  value: String(r.id),
                  label: `${r.name} → ${r.finishedProduct?.name}`,
                }))}
            />
            <label style={{ fontSize: 13 }}>
              {tt("mfgBatchCount")}{" "}
              <input
                type="number"
                min={0.001}
                step="any"
                value={runForm.batchCount}
                onChange={(e) => setRunForm({ ...runForm, batchCount: e.target.value })}
                style={{ width: 100, marginLeft: 8 }}
              />
            </label>
            <input
              placeholder={tt("mfgProductionNotesPh")}
              value={runForm.notes}
              onChange={(e) => setRunForm({ ...runForm, notes: e.target.value })}
            />
            <button type="button" className="btn-primary btn-sm" disabled={busy || !canManage} onClick={runProduction}>
              {tt("mfgRunProduction")}
            </button>
          </div>
        </div>
      ) : null}

      {tab === "history" ? (
        <div className="page-card">
          <h4 style={{ marginTop: 0 }}>{tt("mfgProductionHistory")}</h4>
          {production.length === 0 ? (
            <p className="text-muted">{tt("mfgNoProduction")}</p>
          ) : (
            production.map((row) => (
              <div key={row.id} className="rest-kot-card">
                <strong>
                  {row.productionNo} · {row.recipe?.finishedProduct?.name}
                </strong>
                <p className="text-muted" style={{ margin: "4px 0", fontSize: 13 }}>
                  {tt("mfgProduced")}: {row.finishedQty} · {tt("mfgBatchCount")}: {row.batchCount} ·{" "}
                  {new Date(row.createdAt).toLocaleString()}
                </p>
                <ul style={{ margin: "8px 0", paddingLeft: 18 }}>
                  {(row.consumption || []).map((c, i) => (
                    <li key={i}>
                      {c.qty} × {c.name}
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

export default Manufacturing;
