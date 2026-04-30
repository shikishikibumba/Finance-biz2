import { useState, useEffect, useCallback, useRef } from "react";
import API from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Search, Pencil, Trash2, Package } from "lucide-react";

const fmt = (n) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

export default function ProductsPage() {
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", unit: "pcs", selling_price: "", cost_price: "" });
  const nameRef = useRef(null);
  const sellingRef = useRef(null);
  const costRef = useRef(null);
  const saveRef = useRef(null);

  const focusNext = (nextRef) => (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (nextRef === saveRef) {
        saveRef.current?.click();
      } else {
        nextRef.current?.focus();
      }
    }
  };

  const fetchProducts = useCallback(async () => {
    try {
      const { data } = await API.get("/products", { params: { search: search || undefined } });
      setProducts(data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [search]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  const openNew = () => { setEditing(null); setForm({ name: "", unit: "pcs", selling_price: "", cost_price: "" }); setDialogOpen(true); };
  const openEdit = (p) => { setEditing(p); setForm({ name: p.name, unit: p.unit, selling_price: p.selling_price || "", cost_price: p.cost_price || "" }); setDialogOpen(true); };

  const handleSave = async () => {
    try {
      if (editing) {
        await API.put(`/products/${editing.id}`, form);
        toast.success("Product updated");
      } else {
        await API.post("/products", form);
        toast.success("Product created");
      }
      setDialogOpen(false);
      fetchProducts();
    } catch (err) { toast.error(err.response?.data?.detail || "Failed to save"); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this product?")) return;
    try {
      await API.delete(`/products/${id}`);
      toast.success("Product deleted");
      fetchProducts();
    } catch (err) { toast.error("Failed to delete"); }
  };

  return (
    <div className="space-y-6" data-testid="products-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight" style={{ fontFamily: 'Outfit, sans-serif' }}>Products</h1>
          <p className="text-sm text-muted-foreground mt-1" data-testid="products-total-count">
            {products.length} product{products.length === 1 ? "" : "s"} in catalog
          </p>
        </div>
        <Button onClick={openNew} className="bg-[#0F172A] hover:bg-[#1E293B] rounded-sm gap-2" data-testid="add-product-button">
          <Plus size={16} /> Add Product
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search products..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" data-testid="product-search-input" />
      </div>

      <Card className="border shadow-sm">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-muted-foreground">Loading...</div>
          ) : products.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <Package size={32} className="mx-auto mb-2 opacity-30" />
              No products found. Add your first product.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table w-full">
                <thead><tr><th>Name</th><th>Unit</th><th>Selling Price</th><th>Cost Price</th><th>Margin</th><th className="w-20">Actions</th></tr></thead>
                <tbody>
                  {products.map(p => {
                    const margin = p.selling_price > 0 && p.cost_price > 0 ? ((p.selling_price - p.cost_price) / p.selling_price * 100).toFixed(1) : "-";
                    return (
                      <tr key={p.id}>
                        <td className="font-medium">{p.name}</td>
                        <td>{p.unit}</td>
                        <td>{"Rs. "}{fmt(p.selling_price)}</td>
                        <td>{"Rs. "}{fmt(p.cost_price)}</td>
                        <td className={margin !== "-" && parseFloat(margin) > 0 ? "text-emerald-600" : ""}>{margin !== "-" ? `${margin}%` : "-"}</td>
                        <td>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(p)} data-testid={`edit-product-${p.id}`}><Pencil size={14} /></Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(p.id)} data-testid={`delete-product-${p.id}`}><Trash2 size={14} /></Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md" onOpenAutoFocus={() => setTimeout(() => nameRef.current?.focus(), 50)}>
          <DialogHeader><DialogTitle style={{ fontFamily: 'Outfit, sans-serif' }}>{editing ? "Edit Product" : "New Product"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-wider">Product Name *</Label>
              <Input ref={nameRef} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} onKeyDown={focusNext(sellingRef)} placeholder="e.g. WC, Basin, Tap" data-testid="product-name-input" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-wider">Unit</Label>
                <Input value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} placeholder="pcs, kg, m" data-testid="product-unit-input" />
              </div>
              <div />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-wider">Selling Price</Label>
                <Input ref={sellingRef} type="number" value={form.selling_price} onChange={e => setForm(f => ({ ...f, selling_price: e.target.value === "" ? "" : parseFloat(e.target.value) }))} onKeyDown={focusNext(costRef)} placeholder="Selling price" data-testid="product-selling-price-input" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-wider">Cost Price</Label>
                <Input ref={costRef} type="number" value={form.cost_price} onChange={e => setForm(f => ({ ...f, cost_price: e.target.value === "" ? "" : parseFloat(e.target.value) }))} onKeyDown={focusNext(saveRef)} placeholder="Cost price" data-testid="product-cost-price-input" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} className="rounded-sm">Cancel</Button>
            <Button ref={saveRef} onClick={handleSave} className="bg-[#0F172A] hover:bg-[#1E293B] rounded-sm" data-testid="save-product-button">{editing ? "Update" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
