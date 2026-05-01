import { useEffect, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";

function Products() {
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState({
    name: "",
    price: "",
    stock: "",
    category: "",
    sku: "",
    vatRate: "",
    defaultDiscountType: "",
    defaultDiscountValue: "",
  });
  const [editingId, setEditingId] = useState(null);
  const [selected, setSelected] = useState(null);

  const fetchProducts = async () => {
    const res = await api.get("/products");
    setProducts(res.data);
  };

  useEffect(() => {
    fetchProducts();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();

    const payload = {
      name: form.name,
      price: Number(form.price),
      stock: Number(form.stock),
      category: form.category,
      sku: form.sku || null,
      vatRate: Number(form.vatRate || 0),
      defaultDiscountType: form.defaultDiscountType || null,
      defaultDiscountValue: Number(form.defaultDiscountValue || 0),
    };

    if (editingId) {
      await api.put(`/products/${editingId}`, payload);
    } else {
      await api.post("/products", payload);
    }

    setForm({
      name: "",
      price: "",
      stock: "",
      category: "",
      sku: "",
      vatRate: "",
      defaultDiscountType: "",
      defaultDiscountValue: "",
    });
    setEditingId(null);
    setSelected(null);

    fetchProducts();
  };

  const handleEdit = (row) => {
    setEditingId(row.id);
    setSelected(row);
    setForm({
      name: row.name || "",
      price: row.price ?? "",
      stock: row.stock ?? "",
      category: row.category || "",
      sku: row.sku || "",
      vatRate: row.vatRate ?? "",
      defaultDiscountType: row.defaultDiscountType || "",
      defaultDiscountValue: row.defaultDiscountValue ?? "",
    });
  };

  const handleDetails = async (row) => {
    const res = await api.get(`/products/${row.id}`);
    setSelected(res.data);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setForm({
      name: "",
      price: "",
      stock: "",
      category: "",
      sku: "",
      vatRate: "",
      defaultDiscountType: "",
      defaultDiscountValue: "",
    });
  };

  const handleDelete = async (row) => {
    if (!window.confirm(`Delete product "${row.name}"?`)) return;
    await api.delete(`/products/${row.id}`);
    if (selected?.id === row.id) setSelected(null);
    if (editingId === row.id) handleCancelEdit();
    fetchProducts();
  };

  return (
    <div>
      <h2>Products</h2>

      <form onSubmit={handleSubmit} className="form-grid">
        <input
          placeholder="Product name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />

        <input
          placeholder="Price"
          type="number"
          value={form.price}
          onChange={(e) => setForm({ ...form, price: e.target.value })}
        />

        <input
          placeholder="Stock"
          type="number"
          value={form.stock}
          onChange={(e) => setForm({ ...form, stock: e.target.value })}
        />

        <input
          placeholder="Category"
          value={form.category}
          onChange={(e) => setForm({ ...form, category: e.target.value })}
        />
        <input
          placeholder="SKU"
          value={form.sku}
          onChange={(e) => setForm({ ...form, sku: e.target.value })}
        />
        <input
          placeholder="VAT %"
          type="number"
          value={form.vatRate}
          onChange={(e) => setForm({ ...form, vatRate: e.target.value })}
        />
        <select
          value={form.defaultDiscountType}
          onChange={(e) => setForm({ ...form, defaultDiscountType: e.target.value })}
        >
          <option value="">No Default Discount</option>
          <option value="PERCENT">Default % Discount</option>
          <option value="AMOUNT">Default Amount Discount</option>
        </select>
        <input
          placeholder="Default Discount Value"
          type="number"
          value={form.defaultDiscountValue}
          onChange={(e) => setForm({ ...form, defaultDiscountValue: e.target.value })}
        />

        <button type="submit">{editingId ? "Update Product" : "Add Product"}</button>
        {editingId ? (
          <button type="button" className="btn-secondary" onClick={handleCancelEdit}>
            Cancel
          </button>
        ) : null}
      </form>
      {selected ? (
        <div className="page-card" style={{ marginTop: 12 }}>
          <h4>Product Details</h4>
          <p><strong>Name:</strong> {selected.name}</p>
          <p><strong>SKU:</strong> {selected.sku || "-"}</p>
          <p><strong>Category:</strong> {selected.category || "-"}</p>
          <p><strong>Price:</strong> ৳{Number(selected.price || 0).toFixed(2)}</p>
          <p><strong>Stock:</strong> {selected.stock}</p>
          <p><strong>VAT:</strong> {Number(selected.vatRate || 0)}%</p>
          <p>
            <strong>Default Discount:</strong>{" "}
            {selected.defaultDiscountType
              ? `${selected.defaultDiscountType === "PERCENT" ? `${selected.defaultDiscountValue}%` : `৳${Number(selected.defaultDiscountValue || 0).toFixed(2)}`}`
              : "-"}
          </p>
        </div>
      ) : null}

      <DataTable
        title="Product List"
        rows={products}
        searchableKeys={["name", "sku", "category"]}
        filters={[
          {
            key: "category",
            label: "Category",
            options: [...new Set(products.map((p) => p.category).filter(Boolean))].map((c) => ({
              label: c,
              value: c,
            })),
          },
        ]}
        columns={[
          { key: "name", label: "Name" },
          { key: "sku", label: "SKU", render: (v) => v || "-" },
          { key: "category", label: "Category", render: (v) => v || "-" },
          { key: "price", label: "Price", render: (v) => `৳${Number(v).toFixed(2)}` },
          { key: "stock", label: "Stock" },
          { key: "vatRate", label: "VAT %", render: (v) => `${v}%` },
          {
            key: "defaultDiscountType",
            label: "Default Discount",
            render: (v, row) =>
              v
                ? v === "PERCENT"
                  ? `${Number(row.defaultDiscountValue || 0)}%`
                  : `৳${Number(row.defaultDiscountValue || 0).toFixed(2)}`
                : "-",
          },
          {
            key: "actions",
            label: "Actions",
            render: (_, row) => (
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" className="btn-secondary btn-sm" onClick={() => handleDetails(row)}>Details</button>
                <button type="button" className="btn-secondary btn-sm" onClick={() => handleEdit(row)}>Edit</button>
                <button type="button" className="btn-danger btn-sm" onClick={() => handleDelete(row)}>Delete</button>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}

export default Products;