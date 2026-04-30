import { useState, useEffect, useCallback } from "react";
import API from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/SearchableSelect";
import { toast } from "sonner";
import { Plus, RotateCcw, Trash2, Package, X, Printer, Eye } from "lucide-react";
import { printCreditNote } from "@/lib/print";

const fmt = (n) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

export default function ReturnsPage() {
  const [tab, setTab] = useState("returns");
  const [returns, setReturns] = useState([]);
  const [stock, setStock] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [stockDialogOpen, setStockDialogOpen] = useState(false);
  const [form, setForm] = useState({ invoice_id: "", invoice: null, items: [], notes: "", destination: "warehouse", supplier_id: "", supplier_name: "", purchase_id: "" });
  const [suppliers, setSuppliers] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [stockForm, setStockForm] = useState({ product_id: "", product_name: "", quantity: "", cost_price: "", unit_price: "", notes: "" });

  const fetchData = useCallback(async () => {
    try {
      const [r, s, inv, p, sup, pur] = await Promise.all([
        API.get("/returns"),
        API.get("/returned-stock"),
        API.get("/invoices"),
        API.get("/products"),
        API.get("/suppliers"),
        API.get("/purchases"),
      ]);
      setReturns(r.data);
      setStock(s.data);
      setInvoices(inv.data);
      setProducts(p.data);
      setSuppliers(sup.data);
      setPurchases(pur.data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const invoiceOptions = invoices.map(i => ({ value: i.id, label: `${i.invoice_number} - ${i.customer_name} - Rs. ${fmt(i.total_amount)}` }));
  const productOptions = products.map(p => ({ value: p.id, label: p.name }));

  const openNewReturn = () => {
    setForm({ invoice_id: "", invoice: null, items: [], notes: "", destination: "warehouse", supplier_id: "", supplier_name: "", purchase_id: "" });
    setDialogOpen(true);
  };

  const selectInvoice = async (invoice_id) => {
    try {
      const { data } = await API.get(`/invoices/${invoice_id}`);
      const existingReturns = returns.filter(r => r.invoice_id === invoice_id);
      const returnedByProduct = {};
      existingReturns.forEach(r => r.items.forEach(i => {
        returnedByProduct[i.product_id] = (returnedByProduct[i.product_id] || 0) + i.quantity;
      }));
      const items = data.items.map(i => ({
        product_id: i.product_id,
        product_name: i.product_name,
        quantity: 0,
        max_quantity: i.quantity - (returnedByProduct[i.product_id] || 0),
        unit_price: i.unit_price,
        // If order had snapshotted cost, we'd use it. Here we look up product.
        cost_price: (products.find(p => p.id === i.product_id)?.cost_price) || 0,
        reason: "",
        selected: false,
      }));
      setForm({ invoice_id, invoice: data, items, notes: "" });
    } catch (err) { toast.error("Failed to load invoice"); }
  };

  const updateReturnItem = (idx, field, value) =>
    setForm(f => { const items = [...f.items]; items[idx] = { ...items[idx], [field]: value }; return { ...f, items }; });

  const handleCreateReturn = async () => {
    if (!form.invoice_id) { toast.error("Select an invoice"); return; }
    const toReturn = form.items.filter(i => i.selected && parseFloat(i.quantity) > 0);
    if (toReturn.length === 0) { toast.error("Select items and enter quantity to return"); return; }
    for (const it of toReturn) {
      if (parseFloat(it.quantity) > it.max_quantity + 0.0001) {
        toast.error(`${it.product_name}: cannot return more than ${it.max_quantity}`);
        return;
      }
    }
    try {
      await API.post("/returns", {
        invoice_id: form.invoice_id,
        items: toReturn.map(i => ({
          product_id: i.product_id,
          product_name: i.product_name,
          quantity: parseFloat(i.quantity),
          unit_price: parseFloat(i.unit_price),
          cost_price: parseFloat(i.cost_price) || 0,
          reason: i.reason || "",
        })),
        notes: form.notes,
        destination: form.destination || "warehouse",
        supplier_id: form.supplier_id || "",
        supplier_name: form.supplier_name || "",
        purchase_id: form.purchase_id || "",
      });
      toast.success(form.destination === "supplier" ? "Return to supplier recorded" : "Return recorded");
      setDialogOpen(false);
      fetchData();
    } catch (err) { toast.error(err.response?.data?.detail || "Failed"); }
  };

  const handleDeleteReturn = async (id) => {
    if (!window.confirm("Delete this return? Returned stock will be reversed.")) return;
    try {
      await API.delete(`/returns/${id}`);
      toast.success("Return deleted");
      fetchData();
    } catch (err) { toast.error(err.response?.data?.detail || "Failed"); }
  };

  const handleAddManualStock = async () => {
    if (!stockForm.product_id || !stockForm.quantity || !stockForm.cost_price) {
      toast.error("Product, quantity, and cost price are required");
      return;
    }
    try {
      await API.post("/returned-stock", {
        product_id: stockForm.product_id,
        product_name: stockForm.product_name,
        quantity: parseFloat(stockForm.quantity),
        cost_price: parseFloat(stockForm.cost_price),
        unit_price: parseFloat(stockForm.unit_price) || 0,
        notes: stockForm.notes,
      });
      toast.success("Opening stock added");
      setStockDialogOpen(false);
      setStockForm({ product_id: "", product_name: "", quantity: "", cost_price: "", unit_price: "", notes: "" });
      fetchData();
    } catch (err) { toast.error(err.response?.data?.detail || "Failed"); }
  };

  const handleDeleteStock = async (id) => {
    if (!window.confirm("Delete this stock entry?")) return;
    try {
      await API.delete(`/returned-stock/${id}`);
      toast.success("Stock deleted");
      fetchData();
    } catch (err) { toast.error(err.response?.data?.detail || "Failed"); }
  };

  // Group stock by product for display
  const stockByProduct = stock.reduce((acc, s) => {
    const remaining = (s.quantity_available || 0) - (s.quantity_used || 0);
    const existing = acc.find(x => x.product_id === s.product_id);
    if (existing) {
      existing.total_remaining += remaining;
      existing.entries.push({ ...s, remaining });
    } else {
      acc.push({
        product_id: s.product_id,
        product_name: s.product_name,
        total_remaining: remaining,
        entries: [{ ...s, remaining }],
      });
    }
    return acc;
  }, []);

  return (
    <div className="space-y-6" data-testid="returns-page">
      <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight" style={{ fontFamily: 'Outfit, sans-serif' }}>Returns & Stock</h1>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="bg-muted">
          <TabsTrigger value="returns" data-testid="returns-tab">Customer Returns</TabsTrigger>
          <TabsTrigger value="stock" data-testid="stock-tab">Returned Stock</TabsTrigger>
        </TabsList>

        <TabsContent value="returns" className="mt-4 space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">Record returns from delivered/invoiced orders. Customer outstanding is reduced and stock is added to the returned stock pool.</p>
            <Button onClick={openNewReturn} className="bg-[#0F172A] hover:bg-[#1E293B] rounded-sm gap-2" data-testid="new-return-button">
              <Plus size={16} /> New Return
            </Button>
          </div>

          <Card className="border shadow-sm">
            <CardContent className="p-0">
              {loading ? <div className="p-8 text-center text-muted-foreground">Loading...</div> :
               returns.length === 0 ? <div className="p-8 text-center text-muted-foreground"><RotateCcw size={32} className="mx-auto mb-2 opacity-30" />No returns recorded yet.</div> :
                <div className="overflow-x-auto">
                  <table className="data-table w-full">
                    <thead><tr><th>Return #</th><th>Credit Note</th><th>Invoice</th><th>Customer</th><th>Items</th><th>Amount</th><th>Date</th><th className="w-32">Actions</th></tr></thead>
                    <tbody>
                      {returns.map(r => (
                        <tr key={r.id} data-testid={`return-row-${r.id}`}>
                          <td className="font-medium">{r.return_number}</td>
                          <td className="font-medium text-amber-700" data-testid={`credit-note-${r.id}`}>{r.credit_note_number || r.return_number?.replace("RET-", "CN-")}</td>
                          <td>{r.invoice_number}</td>
                          <td>{r.customer_name}</td>
                          <td>{r.items?.length || 0}</td>
                          <td className="font-semibold">Rs. {fmt(r.total_amount)}</td>
                          <td className="text-muted-foreground">{r.created_at?.slice(0, 10)}</td>
                          <td>
                            <div className="flex gap-1">
                              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => printCreditNote(r)} data-testid={`print-cn-${r.id}`}>
                                <Printer size={12} /> Print
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDeleteReturn(r.id)} data-testid={`delete-return-${r.id}`}><Trash2 size={14} /></Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="stock" className="mt-4 space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">Physical stock available from customer returns or manual openings. Can be sold in new orders (supplier not required).</p>
            <Button onClick={() => setStockDialogOpen(true)} variant="outline" className="rounded-sm gap-2" data-testid="add-opening-stock-button">
              <Plus size={16} /> Add Opening Stock
            </Button>
          </div>

          <Card className="border shadow-sm">
            <CardContent className="p-0">
              {stockByProduct.length === 0 ? <div className="p-8 text-center text-muted-foreground"><Package size={32} className="mx-auto mb-2 opacity-30" />No returned stock yet.</div> :
                <div className="overflow-x-auto">
                  <table className="data-table w-full">
                    <thead><tr><th>Product</th><th>Remaining</th><th>Entries</th></tr></thead>
                    <tbody>
                      {stockByProduct.map(g => (
                        <tr key={g.product_id} data-testid={`stock-row-${g.product_id}`}>
                          <td className="font-medium">{g.product_name}</td>
                          <td className={`font-semibold ${g.total_remaining <= 0 ? "text-muted-foreground" : "text-emerald-700"}`}>{g.total_remaining}</td>
                          <td>
                            <div className="space-y-1">
                              {g.entries.map(e => (
                                <div key={e.id} className="flex items-center gap-2 text-xs bg-muted/40 px-2 py-1 rounded-sm">
                                  <Badge variant="secondary" className="text-[10px] rounded-full">{e.source === "customer_return" ? "return" : "opening"}</Badge>
                                  <span>qty {e.quantity_available} · used {e.quantity_used} · <strong>remaining {e.remaining}</strong> · cost Rs. {fmt(e.cost_price)} · {e.created_at?.slice(0, 10)}</span>
                                  {e.source !== "customer_return" && e.quantity_used === 0 && (
                                    <Button variant="ghost" size="icon" className="h-6 w-6 ml-auto text-destructive" onClick={() => handleDeleteStock(e.id)}><Trash2 size={12} /></Button>
                                  )}
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Create Return Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[92vh] overflow-y-auto">
          <DialogHeader><DialogTitle style={{ fontFamily: 'Outfit, sans-serif' }}>Record Customer Return</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs font-bold uppercase tracking-wider">Invoice *</Label>
              <SearchableSelect options={invoiceOptions} value={form.invoice_id} onSelect={selectInvoice} placeholder="Select invoice..." />
            </div>

            {form.invoice && (
              <div className="space-y-3">
                <div className="bg-muted p-3 rounded-sm text-sm flex justify-between">
                  <span>{form.invoice.invoice_number} · {form.invoice.customer_name}</span>
                  <span className="font-semibold">Rs. {fmt(form.invoice.total_amount)}</span>
                </div>

                {/* Destination selector — Phase 7 */}
                <div className="border rounded-sm p-3 bg-[hsl(var(--surface-muted))] space-y-2" data-testid="return-destination-block">
                  <Label className="text-xs font-bold uppercase tracking-wider">Return Destination</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant={form.destination === "warehouse" ? "default" : "outline"}
                      onClick={() => setForm(f => ({ ...f, destination: "warehouse", supplier_id: "", supplier_name: "", purchase_id: "" }))}
                      className={`rounded-sm ${form.destination === "warehouse" ? "bg-[#0F172A] text-white" : ""}`}
                      data-testid="return-dest-warehouse"
                    >
                      Return to Warehouse
                    </Button>
                    <Button
                      type="button"
                      variant={form.destination === "supplier" ? "default" : "outline"}
                      onClick={() => setForm(f => ({
                        ...f,
                        destination: "supplier",
                        supplier_id: form.invoice?.linked_purchase_id ? (purchases.find(p => p.id === form.invoice.linked_purchase_id)?.supplier_id || "") : "",
                        supplier_name: form.invoice?.linked_purchase_id ? (purchases.find(p => p.id === form.invoice.linked_purchase_id)?.supplier_name || "") : "",
                        purchase_id: form.invoice?.linked_purchase_id || "",
                      }))}
                      className={`rounded-sm ${form.destination === "supplier" ? "bg-amber-700 text-white hover:bg-amber-800" : ""}`}
                      data-testid="return-dest-supplier"
                    >
                      Return to Supplier
                    </Button>
                  </div>
                  {form.destination === "supplier" && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                      <SearchableSelect
                        options={suppliers.map(s => ({ value: s.id, label: s.name }))}
                        value={form.supplier_id}
                        onSelect={id => { const s = suppliers.find(x => x.id === id); setForm(f => ({ ...f, supplier_id: id, supplier_name: s?.name || "" })); }}
                        placeholder="Select supplier..."
                      />
                      <SearchableSelect
                        options={purchases.filter(p => !form.supplier_id || p.supplier_id === form.supplier_id).map(p => ({ value: p.id, label: `${p.purchase_number} · Rs. ${fmt(p.total_amount)}${p.supplier_invoice_number ? ` · ${p.supplier_invoice_number}` : ""}` }))}
                        value={form.purchase_id}
                        onSelect={v => setForm(f => ({ ...f, purchase_id: v }))}
                        placeholder="Link to purchase (optional)"
                      />
                    </div>
                  )}
                </div>

                <Label className="text-xs font-bold uppercase tracking-wider">Items to Return</Label>
                {form.items.map((item, idx) => (
                  <div key={idx} className="border rounded-sm p-3 bg-[#F8FAFC] space-y-2" data-testid={`return-item-${idx}`}>
                    <div className="flex items-center gap-2">
                      <input type="checkbox" checked={item.selected} onChange={e => updateReturnItem(idx, "selected", e.target.checked)} data-testid={`return-item-select-${idx}`} />
                      <span className="font-medium text-sm flex-1">{item.product_name}</span>
                      <span className="text-xs text-muted-foreground">Max: {item.max_quantity}</span>
                    </div>
                    {item.selected && (
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <Label className="text-[10px] uppercase">Qty</Label>
                          <Input type="number" min="0" max={item.max_quantity} value={item.quantity} onChange={e => updateReturnItem(idx, "quantity", e.target.value === "" ? 0 : parseFloat(e.target.value))} className="h-8 text-sm" data-testid={`return-item-qty-${idx}`} />
                        </div>
                        <div>
                          <Label className="text-[10px] uppercase">Cost Price</Label>
                          <Input type="number" value={item.cost_price} onChange={e => updateReturnItem(idx, "cost_price", e.target.value === "" ? 0 : parseFloat(e.target.value))} className="h-8 text-sm" />
                        </div>
                        <div>
                          <Label className="text-[10px] uppercase">Reason</Label>
                          <Input value={item.reason} onChange={e => updateReturnItem(idx, "reason", e.target.value)} placeholder="e.g. damaged" className="h-8 text-sm" />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Return notes" className="min-h-[50px]" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} className="rounded-sm">Cancel</Button>
            <Button onClick={handleCreateReturn} className="bg-[#0F172A] hover:bg-[#1E293B] rounded-sm" data-testid="submit-return-button">Record Return</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manual Opening Stock Dialog */}
      <Dialog open={stockDialogOpen} onOpenChange={setStockDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle style={{ fontFamily: 'Outfit, sans-serif' }}>Add Opening Returned Stock</DialogTitle>
            <p className="text-xs text-muted-foreground pt-1">Use this for historical returned stock you already had before using the system.</p>
          </DialogHeader>
          <div className="space-y-5 py-4">
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-wider">Product <span className="text-destructive">*</span></Label>
              <SearchableSelect
                options={productOptions}
                value={stockForm.product_id}
                onSelect={id => {
                  const p = products.find(x => x.id === id);
                  setStockForm(f => ({
                    ...f,
                    product_id: id,
                    product_name: p?.name || "",
                    cost_price: p?.cost_price ?? "",
                    unit_price: p?.selling_price ?? "",
                  }));
                }}
                placeholder="Select product..."
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-wider">Quantity <span className="text-destructive">*</span></Label>
                <Input
                  type="number"
                  min="0"
                  value={stockForm.quantity}
                  onChange={e => setStockForm(f => ({ ...f, quantity: e.target.value }))}
                  placeholder="e.g. 10"
                  data-testid="stock-qty-input"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-wider">Cost Price <span className="text-destructive">*</span></Label>
                <Input
                  type="number"
                  min="0"
                  value={stockForm.cost_price}
                  onChange={e => setStockForm(f => ({ ...f, cost_price: e.target.value }))}
                  placeholder="Per-unit cost"
                  data-testid="stock-cost-input"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-wider">Unit Price (optional)</Label>
              <Input
                type="number"
                min="0"
                value={stockForm.unit_price}
                onChange={e => setStockForm(f => ({ ...f, unit_price: e.target.value }))}
                placeholder="Selling price reference"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-wider">Notes</Label>
              <Textarea
                value={stockForm.notes}
                onChange={e => setStockForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="e.g. Carry-forward from prior period"
                className="min-h-[60px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStockDialogOpen(false)} className="rounded-sm">Cancel</Button>
            <Button onClick={handleAddManualStock} className="bg-[#0F172A] hover:bg-[#1E293B] text-white rounded-sm" data-testid="submit-stock-button">Add Stock</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
