import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import API from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/SearchableSelect";
import { toast } from "sonner";
import { Plus, Search, Trash2, ShoppingCart, X, Truck, Pencil, Lock, Package } from "lucide-react";

const fmt = (n) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const STATUS_COLORS = { pending: "bg-amber-100 text-amber-800", ordered: "bg-blue-100 text-blue-800", delivered: "bg-emerald-100 text-emerald-800" };

const emptyItem = () => ({
  product_id: "", product_name: "",
  quantity: 1, unit_price: "",
  supplier_id: "", supplier_name: "",
  supplier_invoice_number: "",
  source: "supplier",         // "supplier" or "returned_stock"
  returned_stock_id: "",
});
const emptyForm = () => ({ customer_id: "", customer_name: "", items: [], notes: "" });

export default function OrdersPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [orders, setOrders] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [returnedStock, setReturnedStock] = useState([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [defaultSupplier, setDefaultSupplier] = useState({ id: "", name: "", supplier_invoice_number: "" });
  const [invoiceDialog, setInvoiceDialog] = useState({ open: false, orderId: null, invoice_number: "", created_at: "" });

  const fetchOrders = useCallback(async () => {
    try {
      const params = {};
      if (search) params.search = search;
      if (statusFilter !== "all") params.status = statusFilter;
      const { data } = await API.get("/orders", { params });
      setOrders(data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [search, statusFilter]);

  const fetchMasterData = useCallback(async () => {
    try {
      const [c, p, s, rs] = await Promise.all([
        API.get("/customers"), API.get("/products"), API.get("/suppliers"),
        API.get("/returned-stock/by-product", { params: { available_only: true } })
      ]);
      setCustomers(c.data);
      setProducts(p.data);
      setSuppliers(s.data);
      setReturnedStock(rs.data);
    } catch (err) { console.error(err); }
  }, []);

  useEffect(() => { fetchOrders(); fetchMasterData(); }, [fetchOrders, fetchMasterData]);

  useEffect(() => {
    if (searchParams.get("new") === "1") {
      setEditingId(null);
      setForm(emptyForm());
      setDialogOpen(true);
      searchParams.delete("new");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const customerOptions = customers.map(c => ({ value: c.id, label: `${c.name}${c.shop_name ? ` (${c.shop_name})` : ""}` }));
  const productOptions = products.map(p => ({ value: p.id, label: `${p.name} - Rs. ${fmt(p.selling_price)}` }));
  const supplierOptions = suppliers.map(s => ({ value: s.id, label: `${s.name}${s.is_primary ? " (Primary)" : ""}` }));

  const stockByProduct = Object.fromEntries(returnedStock.map(g => [g.product_id, g]));
  const stockEntriesFor = (productId) => {
    const g = stockByProduct[productId];
    return g ? g.entries.filter(e => e.remaining > 0).map(e => ({
      value: e.id,
      label: `${e.remaining} available · cost Rs. ${fmt(e.cost_price)} · ${e.created_at?.slice(0, 10)}`
    })) : [];
  };

  const openNew = () => {
    setEditingId(null);
    setForm(emptyForm());
    setDialogOpen(true);
  };

  const openEdit = async (orderId) => {
    try {
      const { data } = await API.get(`/orders/${orderId}`);
      if (data.has_invoice) {
        toast.error("Order is locked — invoice has been generated");
        return;
      }
      setEditingId(orderId);
      setForm({
        customer_id: data.customer_id,
        customer_name: data.customer_name,
        items: data.items.map(i => ({
          product_id: i.product_id,
          product_name: i.product_name,
          quantity: i.quantity,
          unit_price: i.unit_price,
          supplier_id: i.supplier_id || "",
          supplier_name: i.supplier_name || "",
          supplier_invoice_number: i.supplier_invoice_number || "",
          source: i.source || "supplier",
          returned_stock_id: i.returned_stock_id || "",
        })),
        notes: data.notes || "",
      });
      setDialogOpen(true);
    } catch (err) { toast.error("Failed to load order"); }
  };

  const addItem = () => setForm(f => ({
    ...f,
    items: [...f.items, {
      ...emptyItem(),
      supplier_id: defaultSupplier.id || "",
      supplier_name: defaultSupplier.name || "",
      supplier_invoice_number: defaultSupplier.supplier_invoice_number || "",
    }],
  }));

  const updateItem = (idx, field, value) => {
    setForm(f => {
      const items = [...f.items];
      items[idx] = { ...items[idx], [field]: value };
      if (field === "product_id") {
        const prod = products.find(p => p.id === value);
        if (prod) { items[idx].product_name = prod.name; items[idx].unit_price = prod.selling_price; }
        // Reset returned_stock_id on product change
        items[idx].returned_stock_id = "";
      }
      if (field === "supplier_id") {
        const sup = suppliers.find(s => s.id === value);
        if (sup) items[idx].supplier_name = sup.name;
      }
      if (field === "source" && value === "returned_stock") {
        // Clear supplier fields when using returned stock
        items[idx].supplier_id = "";
        items[idx].supplier_name = "";
        items[idx].supplier_invoice_number = "";
      }
      return { ...f, items };
    });
  };

  const removeItem = (idx) => setForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));

  const selectCustomer = (id) => {
    const cust = customers.find(c => c.id === id);
    setForm(f => ({ ...f, customer_id: id, customer_name: cust?.name || "" }));
  };

  const orderTotal = form.items.reduce((s, i) => s + ((parseFloat(i.quantity) || 0) * (parseFloat(i.unit_price) || 0)), 0);

  const handleSave = async () => {
    if (!form.customer_id) { toast.error("Select a customer"); return; }
    if (form.items.length === 0) { toast.error("Add at least one item"); return; }
    if (form.items.some(i => !i.product_id)) { toast.error("Select a product for all items"); return; }
    // Validate returned_stock selection
    for (const item of form.items) {
      if (item.source === "returned_stock" && !item.returned_stock_id) {
        toast.error("Select a returned-stock entry for items using returned stock");
        return;
      }
    }
    try {
      if (editingId) {
        await API.put(`/orders/${editingId}`, form);
        toast.success("Order updated");
      } else {
        await API.post("/orders", form);
        toast.success("Order created");
      }
      setDialogOpen(false);
      fetchOrders();
      fetchMasterData();
    } catch (err) { toast.error(err.response?.data?.detail || "Failed"); }
  };

  const viewDetail = async (orderId) => {
    try {
      const { data } = await API.get(`/orders/${orderId}`);
      setSelectedOrder(data);
      setDetailOpen(true);
    } catch (err) { toast.error("Failed to load order"); }
  };

  const updateStatus = async (orderId, status, itemIds = null) => {
    try {
      const { data } = await API.put(`/orders/${orderId}/status`, { status, item_ids: itemIds });
      setSelectedOrder(data);
      toast.success("Status updated");
      fetchOrders();
    } catch (err) { toast.error("Failed to update status"); }
  };

  const openGenerateInvoice = (orderId) => {
    setInvoiceDialog({ open: true, orderId, invoice_number: "", created_at: "" });
  };

  const confirmGenerateInvoice = async () => {
    const { orderId, invoice_number, created_at } = invoiceDialog;
    if (!orderId) return;
    try {
      const payload = {};
      if (invoice_number && invoice_number.trim()) payload.invoice_number = invoice_number.trim();
      if (created_at) payload.created_at = new Date(created_at).toISOString();
      await API.post(`/invoices/from-order/${orderId}`, payload);
      toast.success("Invoice generated");
      setInvoiceDialog({ open: false, orderId: null, invoice_number: "", created_at: "" });
      setDetailOpen(false);
      fetchOrders();
    } catch (err) { toast.error(err.response?.data?.detail || "Failed to generate invoice"); }
  };

  const generateInvoice = (orderId) => openGenerateInvoice(orderId);

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this order?")) return;
    try {
      await API.delete(`/orders/${id}`);
      toast.success("Order deleted");
      fetchOrders();
      fetchMasterData();
    } catch (err) { toast.error(err.response?.data?.detail || "Failed to delete"); }
  };

  return (
    <div className="space-y-6" data-testid="orders-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight" style={{ fontFamily: 'Outfit, sans-serif' }}>Orders</h1>
        <Button onClick={openNew} className="bg-[#0F172A] hover:bg-[#1E293B] rounded-sm gap-2" data-testid="create-order-button">
          <Plus size={16} /> New Order
        </Button>
      </div>

      <div className="flex gap-3 flex-wrap">
        <div className="relative max-w-sm flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search orders..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" data-testid="order-search-input" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36" data-testid="order-status-filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="ordered">Ordered</SelectItem>
            <SelectItem value="delivered">Delivered</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="border shadow-sm">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-muted-foreground">Loading...</div>
          ) : orders.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <ShoppingCart size={32} className="mx-auto mb-2 opacity-30" />
              No orders found. Create your first order.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table w-full">
                <thead><tr><th>Order #</th><th>Customer</th><th>Items</th><th>Amount</th><th>Status</th><th>Date</th><th className="w-40">Actions</th></tr></thead>
                <tbody>
                  {orders.map(o => (
                    <tr key={o.id} className="cursor-pointer" onClick={() => viewDetail(o.id)}>
                      <td className="font-medium">{o.order_number}</td>
                      <td>{o.customer_name}</td>
                      <td>{o.items?.length || 0}</td>
                      <td>{"Rs. "}{fmt(o.total_amount)}</td>
                      <td>
                        <Badge variant="secondary" className={`${STATUS_COLORS[o.status]} text-xs rounded-full`}>{o.status}</Badge>
                        {o.has_invoice && <Badge variant="secondary" className="ml-1 bg-gray-200 text-gray-700 text-[10px] rounded-full gap-1"><Lock size={10} /> invoiced</Badge>}
                      </td>
                      <td className="text-muted-foreground">{o.created_at?.slice(0, 10)}</td>
                      <td onClick={e => e.stopPropagation()}>
                        <div className="flex gap-1">
                          {!o.has_invoice && (
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(o.id)} data-testid={`edit-order-${o.id}`}>
                              <Pencil size={14} />
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => generateInvoice(o.id)} disabled={o.has_invoice} data-testid={`generate-invoice-${o.id}`}>Invoice</Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(o.id)} data-testid={`delete-order-${o.id}`}><Trash2 size={14} /></Button>
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

      {/* Create / Edit Order Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle style={{ fontFamily: 'Outfit, sans-serif' }}>
              {editingId ? "Edit Order" : "New Order"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-wider">Customer *</Label>
              <SearchableSelect options={customerOptions} value={form.customer_id} onSelect={selectCustomer} placeholder="Select customer..." searchPlaceholder="Search customers..." />
            </div>

            {/* Default Supplier: pre-fills new items so you don't pick supplier per-item.
                You can still override per item (and add items from different suppliers). */}
            <div className="border rounded-sm p-3 bg-[hsl(var(--surface-muted))] space-y-2" data-testid="default-supplier-block">
              <Label className="text-xs font-bold uppercase tracking-wider">Default Supplier <span className="font-normal normal-case text-[10px] text-muted-foreground">(applied to new items — items can still be overridden individually)</span></Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <SearchableSelect
                  options={supplierOptions}
                  value={defaultSupplier.id}
                  onSelect={id => {
                    const s = suppliers.find(x => x.id === id);
                    setDefaultSupplier(d => ({ ...d, id, name: s?.name || "" }));
                  }}
                  placeholder="Select default supplier..."
                />
                <Input
                  value={defaultSupplier.supplier_invoice_number}
                  onChange={e => setDefaultSupplier(d => ({ ...d, supplier_invoice_number: e.target.value }))}
                  placeholder="Default supplier invoice # (optional)"
                  data-testid="default-supinv-input"
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-bold uppercase tracking-wider">Items</Label>
                <Button type="button" variant="outline" size="sm" onClick={addItem} className="gap-1 text-xs rounded-sm" data-testid="add-order-item-button">
                  <Plus size={14} /> Add Item
                </Button>
              </div>
              {form.items.map((item, idx) => {
                const stockChoices = stockEntriesFor(item.product_id);
                const hasStock = stockChoices.length > 0;
                return (
                  <div key={idx} className="border rounded-sm p-3 space-y-3 bg-[#F8FAFC]" data-testid={`order-item-row-${idx}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-muted-foreground">ITEM {idx + 1}</span>
                      <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeItem(idx)}><X size={14} /></Button>
                    </div>

                    <div>
                      <Label className="text-xs mb-1 block">Product</Label>
                      <SearchableSelect options={productOptions} value={item.product_id} onSelect={v => updateItem(idx, "product_id", v)} placeholder="Select product..." />
                    </div>

                    {/* Source chooser — only shown when returned stock is available */}
                    {hasStock && item.product_id && (
                      <div className="flex items-center gap-2 p-2 bg-emerald-50 border border-emerald-200 rounded-sm" data-testid={`source-chooser-${idx}`}>
                        <Package size={14} className="text-emerald-700" />
                        <span className="text-xs text-emerald-800">Returned stock available:</span>
                        <Select value={item.source} onValueChange={v => updateItem(idx, "source", v)}>
                          <SelectTrigger className="h-8 text-xs w-48" data-testid={`source-select-${idx}`}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="returned_stock">Use returned stock</SelectItem>
                            <SelectItem value="supplier">Order from supplier</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {item.source === "returned_stock" ? (
                      <div>
                        <Label className="text-xs mb-1 block">Returned Stock Entry *</Label>
                        <SearchableSelect
                          options={stockChoices}
                          value={item.returned_stock_id}
                          onSelect={v => updateItem(idx, "returned_stock_id", v)}
                          placeholder="Select returned stock..."
                        />
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs mb-1 block">Supplier (optional)</Label>
                          <SearchableSelect options={supplierOptions} value={item.supplier_id} onSelect={v => updateItem(idx, "supplier_id", v)} placeholder="Assign supplier..." />
                        </div>
                        <div>
                          <Label className="text-xs mb-1 block">Supplier Invoice #</Label>
                          <Input
                            value={item.supplier_invoice_number}
                            onChange={e => updateItem(idx, "supplier_invoice_number", e.target.value)}
                            placeholder="e.g. SUP-INV-2024-123"
                            data-testid={`supplier-inv-no-${idx}`}
                          />
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs mb-1 block">Quantity</Label>
                        <Input type="number" min="1" value={item.quantity} onChange={e => updateItem(idx, "quantity", e.target.value === "" ? "" : parseFloat(e.target.value))} data-testid={`order-item-qty-${idx}`} />
                      </div>
                      <div>
                        <Label className="text-xs mb-1 block">Unit Price</Label>
                        <Input type="number" value={item.unit_price} onChange={e => updateItem(idx, "unit_price", e.target.value === "" ? "" : parseFloat(e.target.value))} data-testid={`order-item-price-${idx}`} />
                      </div>
                    </div>
                    <div className="text-right text-sm font-medium">Amount: {"Rs. "}{fmt((parseFloat(item.quantity) || 0) * (parseFloat(item.unit_price) || 0))}</div>
                  </div>
                );
              })}
              {form.items.length === 0 && (
                <div className="text-center py-4 text-muted-foreground text-sm border border-dashed rounded-sm">
                  Click "Add Item" to start adding products
                </div>
              )}
            </div>

            <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Order notes (optional)" className="min-h-[60px]" data-testid="order-notes-input" />

            <div className="text-right text-lg font-semibold border-t pt-3" style={{ fontFamily: 'Outfit, sans-serif' }}>
              Total: {"Rs. "}{fmt(orderTotal)}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} className="rounded-sm">Cancel</Button>
            <Button onClick={handleSave} className="bg-[#0F172A] hover:bg-[#1E293B] rounded-sm" data-testid="submit-order-button">
              {editingId ? "Save Changes" : "Create Order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Order Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle style={{ fontFamily: 'Outfit, sans-serif' }}>
              {selectedOrder?.order_number} — {selectedOrder?.customer_name}
            </DialogTitle>
          </DialogHeader>
          {selectedOrder && (
            <div className="space-y-4 py-2">
              <div className="flex items-center gap-3 flex-wrap">
                <Badge variant="secondary" className={`${STATUS_COLORS[selectedOrder.status]} text-xs rounded-full`}>{selectedOrder.status}</Badge>
                {selectedOrder.has_invoice && <Badge variant="secondary" className="bg-gray-200 text-gray-700 text-xs rounded-full gap-1"><Lock size={10} /> Invoice Generated</Badge>}
                <span className="text-sm text-muted-foreground">{selectedOrder.created_at?.slice(0, 10)}</span>
                <span className="text-sm font-semibold ml-auto">{"Rs. "}{fmt(selectedOrder.total_amount)}</span>
              </div>

              {typeof selectedOrder.total_profit === "number" && (
                <div className="flex items-center justify-between px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-sm text-sm">
                  <span className="text-muted-foreground">Estimated Profit</span>
                  <span className="font-semibold text-emerald-700" data-testid="order-total-profit">Rs. {fmt(selectedOrder.total_profit)}</span>
                </div>
              )}

              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-wider">Items</Label>
                {selectedOrder.items?.map((item) => (
                  <div key={item.id} className="border rounded-sm p-3 bg-[#F8FAFC]">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-sm">{item.product_name}</span>
                      <Badge variant="secondary" className={`${STATUS_COLORS[item.status]} text-xs rounded-full`}>{item.status}</Badge>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm text-muted-foreground">
                      <span>Qty: {item.quantity}</span>
                      <span>Price: {"Rs. "}{fmt(item.unit_price)}</span>
                      <span>Amount: {"Rs. "}{fmt(item.amount)}</span>
                      {item.source === "returned_stock" ? (
                        <span className="flex items-center gap-1 col-span-3 text-emerald-700"><Package size={12} /> From returned stock · cost Rs. {fmt(item.cost_price)}</span>
                      ) : (
                        <>
                          <span className="flex items-center gap-1 col-span-2"><Truck size={12} /> {item.supplier_name || "Not assigned"}</span>
                          {item.supplier_invoice_number && <span className="text-xs">Inv: {item.supplier_invoice_number}</span>}
                        </>
                      )}
                    </div>
                    <div className="flex gap-2 mt-2 flex-wrap">
                      {item.status === "pending" && (
                        <Button size="sm" variant="outline" className="h-7 text-xs rounded-sm" onClick={() => updateStatus(selectedOrder.id, "ordered", [item.id])} data-testid={`mark-ordered-${item.id}`}>
                          Mark Ordered
                        </Button>
                      )}
                      {item.status === "ordered" && (
                        <>
                          <Button size="sm" variant="outline" className="h-7 text-xs rounded-sm" onClick={() => updateStatus(selectedOrder.id, "delivered", [item.id])} data-testid={`mark-delivered-${item.id}`}>
                            Mark Delivered
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs rounded-sm text-muted-foreground" onClick={() => updateStatus(selectedOrder.id, "pending", [item.id])}>
                            ↶ Undo
                          </Button>
                        </>
                      )}
                      {item.status === "delivered" && (
                        <Button size="sm" variant="ghost" className="h-7 text-xs rounded-sm text-muted-foreground" onClick={() => updateStatus(selectedOrder.id, "ordered", [item.id])}>
                          ↶ Undo
                        </Button>
                      )}
                      {typeof item.profit === "number" && (
                        <span className="ml-auto text-xs font-semibold text-emerald-600">Profit: Rs. {fmt(item.profit)}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {selectedOrder.notes && (
                <div><Label className="text-xs font-bold uppercase tracking-wider">Notes</Label><p className="text-sm mt-1">{selectedOrder.notes}</p></div>
              )}

              <div className="flex gap-2 pt-2 border-t flex-wrap">
                {!selectedOrder.has_invoice && (
                  <Button size="sm" variant="outline" className="rounded-sm text-xs gap-1" onClick={() => { setDetailOpen(false); openEdit(selectedOrder.id); }} data-testid="edit-order-from-detail">
                    <Pencil size={12} /> Edit Order
                  </Button>
                )}
                {selectedOrder.status !== "delivered" && (
                  <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-sm text-xs" onClick={() => updateStatus(selectedOrder.id, "delivered")} data-testid="mark-all-delivered">
                    Mark All Delivered
                  </Button>
                )}
                <Button size="sm" variant="outline" className="rounded-sm text-xs" onClick={() => generateInvoice(selectedOrder.id)} disabled={selectedOrder.has_invoice} data-testid="generate-invoice-from-detail">
                  Generate Invoice
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {/* Generate Invoice Dialog — supports manual invoice number (hybrid) */}
      <Dialog open={invoiceDialog.open} onOpenChange={(v) => setInvoiceDialog(d => ({ ...d, open: v }))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle style={{ fontFamily: 'Outfit, sans-serif' }}>Generate Invoice</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-wider">Invoice Number</Label>
              <Input
                value={invoiceDialog.invoice_number}
                onChange={e => setInvoiceDialog(d => ({ ...d, invoice_number: e.target.value }))}
                placeholder="Leave blank for auto-number"
                data-testid="manual-invoice-number-input"
              />
              <p className="text-[11px] text-muted-foreground">
                Leave empty to auto-generate (e.g. <code>INV-0001</code>). Enter a value to override (e.g. legacy <code>INV-2023-105</code>). Must be unique.
              </p>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-wider">Invoice Date (optional)</Label>
              <Input
                type="date"
                value={invoiceDialog.created_at}
                onChange={e => setInvoiceDialog(d => ({ ...d, created_at: e.target.value }))}
                data-testid="manual-invoice-date-input"
              />
              <p className="text-[11px] text-muted-foreground">Use for backdated historical entries.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInvoiceDialog(d => ({ ...d, open: false }))} className="rounded-sm">Cancel</Button>
            <Button onClick={confirmGenerateInvoice} className="bg-[#0F172A] hover:bg-[#1E293B] rounded-sm text-white" data-testid="confirm-generate-invoice-button">
              Generate Invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
