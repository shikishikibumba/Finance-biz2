import { useState, useEffect, useCallback } from "react";
import API from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/SearchableSelect";
import { toast } from "sonner";
import { Plus, Search, Trash2, FileText, X, Eye, Pencil } from "lucide-react";

const fmt = (n) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

export default function PurchasesPage() {
  const [purchases, setPurchases] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ supplier_id: "", supplier_name: "", order_id: "", order_number: "", supplier_invoice_number: "", items: [], notes: "" });

  const fetchPurchases = useCallback(async () => {
    try {
      const { data } = await API.get("/purchases", { params: { search: search || undefined } });
      setPurchases(data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [search]);

  const fetchMasterData = useCallback(async () => {
    try {
      const [s, p, o] = await Promise.all([API.get("/suppliers"), API.get("/products"), API.get("/orders")]);
      setSuppliers(s.data);
      setProducts(p.data);
      setOrders(o.data);
    } catch (err) { console.error(err); }
  }, []);

  useEffect(() => { fetchPurchases(); fetchMasterData(); }, [fetchPurchases, fetchMasterData]);

  const supplierOptions = suppliers.map(s => ({ value: s.id, label: s.name }));
  const productOptions = products.map(p => ({ value: p.id, label: `${p.name} - Rs. ${fmt(p.cost_price || p.selling_price)}` }));
  const orderOptions = orders.map(o => ({ value: o.id, label: `${o.order_number} - ${o.customer_name}` }));

  const openNew = () => {
    setEditing(null);
    setForm({ supplier_id: "", supplier_name: "", order_id: "", order_number: "", supplier_invoice_number: "", items: [], notes: "" });
    setDialogOpen(true);
  };

  const openEdit = async (id) => {
    try {
      const { data } = await API.get(`/purchases/${id}`);
      setEditing(data);
      setForm({
        supplier_id: data.supplier_id || "",
        supplier_name: data.supplier_name || "",
        order_id: data.order_id || "",
        order_number: data.order_number || "",
        supplier_invoice_number: data.supplier_invoice_number || "",
        items: (data.items || []).map(i => ({
          product_id: i.product_id, product_name: i.product_name,
          quantity: i.quantity, cost_price: i.cost_price,
        })),
        notes: data.notes || "",
        created_at_date: (data.created_at || "").slice(0, 10),
      });
      setDialogOpen(true);
    } catch (err) { toast.error("Failed to load"); }
  };

  const selectSupplier = (id) => {
    const sup = suppliers.find(s => s.id === id);
    setForm(f => ({ ...f, supplier_id: id, supplier_name: sup?.name || "" }));
  };

  const selectOrder = (id) => {
    const ord = orders.find(o => o.id === id);
    setForm(f => ({ ...f, order_id: id, order_number: ord?.order_number || "" }));
  };

  const addItem = () => setForm(f => ({ ...f, items: [...f.items, { product_id: "", product_name: "", quantity: 1, cost_price: "" }] }));

  const updateItem = (idx, field, value) => {
    setForm(f => {
      const items = [...f.items];
      items[idx] = { ...items[idx], [field]: value };
      if (field === "product_id") {
        const prod = products.find(p => p.id === value);
        if (prod) { items[idx].product_name = prod.name; items[idx].cost_price = prod.cost_price || 0; }
      }
      return { ...f, items };
    });
  };

  const removeItem = (idx) => setForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));
  const purchaseTotal = form.items.reduce((s, i) => s + ((parseFloat(i.quantity) || 0) * (parseFloat(i.cost_price) || 0)), 0);

  const handleCreate = async () => {
    if (!form.supplier_id) { toast.error("Select a supplier"); return; }
    if (form.items.length === 0) { toast.error("Add at least one item"); return; }
    try {
      if (editing) {
        const payload = {
          supplier_id: form.supplier_id,
          supplier_name: form.supplier_name,
          supplier_invoice_number: form.supplier_invoice_number,
          notes: form.notes,
          items: form.items.map(i => ({
            product_id: i.product_id,
            product_name: i.product_name,
            quantity: parseFloat(i.quantity) || 0,
            cost_price: parseFloat(i.cost_price) || 0,
          })),
        };
        if (form.created_at_date) payload.created_at = `${form.created_at_date}T12:00:00`;
        await API.put(`/purchases/${editing.id}`, payload);
        toast.success("Purchase updated");
      } else {
        await API.post("/purchases", form);
        toast.success("Purchase recorded");
      }
      setDialogOpen(false);
      setEditing(null);
      fetchPurchases();
    } catch (err) { toast.error(err.response?.data?.detail || "Failed to save"); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this purchase?")) return;
    try {
      await API.delete(`/purchases/${id}`);
      toast.success("Purchase deleted");
      fetchPurchases();
    } catch (err) { toast.error("Failed to delete"); }
  };

  const viewDetail = async (id) => {
    try {
      const { data } = await API.get(`/purchases/${id}`);
      setSelected(data);
      setDetailOpen(true);
    } catch (err) { toast.error(err.response?.data?.detail || "Failed to load"); }
  };

  return (
    <div className="space-y-6" data-testid="purchases-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight" style={{ fontFamily: 'Outfit, sans-serif' }}>Purchases</h1>
        <Button onClick={openNew} className="bg-[#0F172A] hover:bg-[#1E293B] rounded-sm gap-2" data-testid="add-purchase-button">
          <Plus size={16} /> Record Purchase
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search purchases..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" data-testid="purchase-search-input" />
      </div>

      <Card className="border shadow-sm">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-muted-foreground">Loading...</div>
          ) : purchases.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <FileText size={32} className="mx-auto mb-2 opacity-30" />
              No purchases recorded yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table w-full">
                <thead><tr><th>Purchase #</th><th>Supplier</th><th>Supplier Inv. #</th><th>Order #</th><th>Items</th><th>Amount</th><th>Date</th><th className="w-40">Actions</th></tr></thead>
                <tbody>
                  {purchases.map(p => (
                    <tr key={p.id} data-testid={`purchase-row-${p.id}`}>
                      <td className="font-medium">{p.purchase_number}</td>
                      <td>{p.supplier_name}</td>
                      <td className="text-muted-foreground">{p.supplier_invoice_number || "-"}</td>
                      <td>{p.order_number || p.linked_invoice_number || "-"}</td>
                      <td>{p.items?.length || 0}</td>
                      <td>
                        <div>{"Rs. "}{fmt(p.original_amount ?? p.total_amount)}</div>
                        {(p.credit_notes_total ?? 0) > 0 && (
                          <div className="text-[10px] text-amber-700" data-testid={`purchase-net-${p.id}`}>
                            Net Rs. {fmt(p.net_payable)}
                          </div>
                        )}
                      </td>
                      <td className="text-muted-foreground">{p.created_at?.slice(0, 10)}</td>
                      <td>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => viewDetail(p.id)} data-testid={`view-purchase-${p.id}`}>
                            <Eye size={12} /> View
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => openEdit(p.id)} data-testid={`edit-purchase-${p.id}`}>
                            <Pencil size={12} /> Edit
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(p.id)} data-testid={`delete-purchase-${p.id}`}>
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle style={{ fontFamily: 'Outfit, sans-serif' }}>{editing ? `Edit Purchase ${editing.purchase_number}` : "Record Purchase"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-wider">Supplier *</Label>
                <SearchableSelect options={supplierOptions} value={form.supplier_id} onSelect={selectSupplier} placeholder="Select supplier..." />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-wider">Supplier Invoice #</Label>
                <Input value={form.supplier_invoice_number} onChange={e => setForm(f => ({ ...f, supplier_invoice_number: e.target.value }))} placeholder="Their reference no." data-testid="purchase-supinv-input" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-wider">Linked Order (optional)</Label>
                <SearchableSelect options={orderOptions} value={form.order_id} onSelect={selectOrder} placeholder="Link to order..." />
              </div>
              {editing && (
                <div className="space-y-2">
                  <Label className="text-xs font-bold uppercase tracking-wider">Date</Label>
                  <Input type="date" value={form.created_at_date || ""} onChange={e => setForm(f => ({ ...f, created_at_date: e.target.value }))} data-testid="purchase-date-input" />
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-bold uppercase tracking-wider">Items</Label>
                <Button type="button" variant="outline" size="sm" onClick={addItem} className="gap-1 text-xs rounded-sm" data-testid="add-purchase-item-button"><Plus size={14} /> Add Item</Button>
              </div>
              {form.items.map((item, idx) => (
                <div key={idx} className="border rounded-sm p-3 space-y-2 bg-[#F8FAFC]">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-muted-foreground">ITEM {idx + 1}</span>
                    <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeItem(idx)}><X size={14} /></Button>
                  </div>
                  <SearchableSelect options={productOptions} value={item.product_id} onSelect={v => updateItem(idx, "product_id", v)} placeholder="Select product..." />
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label className="text-xs">Quantity</Label><Input type="number" min="1" value={item.quantity} onChange={e => updateItem(idx, "quantity", e.target.value === "" ? "" : parseFloat(e.target.value))} /></div>
                    <div><Label className="text-xs">Cost Price</Label><Input type="number" value={item.cost_price} onChange={e => updateItem(idx, "cost_price", e.target.value === "" ? "" : parseFloat(e.target.value))} placeholder="Cost price" /></div>
                  </div>
                  <div className="text-right text-sm font-medium">Amount: {"Rs. "}{fmt((parseFloat(item.quantity) || 0) * (parseFloat(item.cost_price) || 0))}</div>
                </div>
              ))}
            </div>

            <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Notes (optional)" className="min-h-[60px]" />

            <div className="text-right text-lg font-semibold border-t pt-3" style={{ fontFamily: 'Outfit, sans-serif' }}>
              Total: {"Rs. "}{fmt(purchaseTotal)}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} className="rounded-sm">Cancel</Button>
            <Button onClick={handleCreate} className="bg-[#0F172A] hover:bg-[#1E293B] rounded-sm" data-testid="submit-purchase-button">Record Purchase</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle style={{ fontFamily: 'Outfit, sans-serif' }}>
              Purchase {selected?.purchase_number}
            </DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Supplier</p>
                  <p className="font-medium">{selected.supplier_name || "-"}</p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Supplier Invoice #</p>
                  <p className="font-medium" data-testid="purchase-detail-sup-inv">{selected.supplier_invoice_number || "-"}</p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Date</p>
                  <p className="font-medium">{selected.created_at?.slice(0, 10)}</p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Linked</p>
                  <p className="font-medium">
                    {selected.linked_invoice_number ? `Invoice ${selected.linked_invoice_number}` : selected.order_number || "—"}
                  </p>
                </div>
              </div>
              <div className="border-t pt-3">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Items</p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 font-bold text-xs uppercase">#</th>
                      <th className="text-left py-2 font-bold text-xs uppercase">Item</th>
                      <th className="text-right py-2 font-bold text-xs uppercase">Qty</th>
                      <th className="text-right py-2 font-bold text-xs uppercase">Cost</th>
                      <th className="text-right py-2 font-bold text-xs uppercase">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.items?.map((it, i) => (
                      <tr key={it.id || i} className="border-b">
                        <td className="py-2">{i + 1}</td>
                        <td className="py-2">{it.product_name}</td>
                        <td className="py-2 text-right">{it.quantity}</td>
                        <td className="py-2 text-right">Rs. {fmt(it.cost_price)}</td>
                        <td className="py-2 text-right font-medium">Rs. {fmt(it.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end pt-2 border-t">
                <div className="w-72 space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Original Purchase Value</span>
                    <span className="font-medium" data-testid="purchase-detail-original">Rs. {fmt(selected.original_amount ?? selected.total_amount)}</span>
                  </div>
                  {(selected.credit_notes_total ?? 0) > 0 && (
                    <div className="flex justify-between text-sm text-amber-700">
                      <span>Credit Notes Applied</span>
                      <span data-testid="purchase-detail-credit">- Rs. {fmt(selected.credit_notes_total)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-semibold text-base border-t pt-1">
                    <span>Net Payable (Reference)</span>
                    <span data-testid="purchase-detail-net">Rs. {fmt(selected.net_payable ?? selected.total_amount)}</span>
                  </div>
                </div>
              </div>
              {(selected.supplier_credit_notes?.length > 0) && (
                <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-3 rounded-sm">
                  <p className="text-xs font-bold uppercase tracking-wider mb-2 text-amber-800">Linked Supplier Credit Notes</p>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left">
                        <th className="py-1">CN #</th>
                        <th>Date</th>
                        <th>Items</th>
                        <th className="text-right">Cost Adjusted</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.supplier_credit_notes.map(cn => (
                        <tr key={cn.id} className="border-t border-amber-200">
                          <td className="py-1 font-medium">{cn.credit_note_number || cn.return_number}</td>
                          <td>{cn.created_at?.slice(0, 10)}</td>
                          <td>{cn.items?.length || 0}</td>
                          <td className="text-right font-medium">Rs. {fmt(cn.adjusted_amount || 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {selected.notes && (
                <div className="bg-[hsl(var(--surface-muted))] p-3 rounded-sm text-sm">
                  <p className="text-xs font-bold uppercase tracking-wider mb-1 text-muted-foreground">Notes</p>
                  {selected.notes}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
