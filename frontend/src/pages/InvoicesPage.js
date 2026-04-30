import { useState, useEffect, useCallback } from "react";
import API from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Search, Trash2, Receipt, Printer, CheckCircle2, FileMinus, Pencil, X, Plus } from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import { printInvoice } from "@/lib/print";

const fmt = (n) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const STATUS_COLORS = { unpaid: "bg-red-100 text-red-800", partial: "bg-amber-100 text-amber-800", paid: "bg-emerald-100 text-emerald-800" };

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState([]);
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [printOpen, setPrintOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [settleDialog, setSettleDialog] = useState({ open: false, invoice: null, amount: "", note: "" });
  const [editDialog, setEditDialog] = useState({ open: false, invoice: null });

  useEffect(() => {
    API.get("/products").then(r => setProducts(r.data)).catch(() => {});
  }, []);

  const fetchInvoices = useCallback(async () => {
    try {
      const params = { search: search || undefined };
      if (statusFilter !== "all") params.status = statusFilter;
      const { data } = await API.get("/invoices", { params });
      setInvoices(data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [search, statusFilter]);

  useEffect(() => { fetchInvoices(); }, [fetchInvoices]);

  const viewInvoice = async (id) => {
    try {
      const { data } = await API.get(`/invoices/${id}`);
      setSelectedInvoice(data);
      setPrintOpen(true);
    } catch (err) { toast.error("Failed to load invoice"); }
  };

  const handlePrint = () => {
    if (selectedInvoice) printInvoice(selectedInvoice);
    else window.print();
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this invoice?")) return;
    try {
      await API.delete(`/invoices/${id}`);
      toast.success("Invoice deleted");
      fetchInvoices();
    } catch (err) { toast.error("Failed to delete"); }
  };

  const openSettle = async (id) => {
    try {
      const { data } = await API.get(`/invoices/${id}`);
      setSettleDialog({ open: true, invoice: data, amount: "", note: "" });
    } catch (err) { toast.error("Failed to load invoice"); }
  };

  const confirmSettle = async () => {
    const inv = settleDialog.invoice;
    if (!inv) return;
    const amt = parseFloat(settleDialog.amount);
    try {
      await API.post(`/invoices/${inv.id}/settle`, {
        amount: (!settleDialog.amount || amt <= 0) ? null : amt,
        note: settleDialog.note || "",
      });
      toast.success("Invoice settled");
      setSettleDialog({ open: false, invoice: null, amount: "", note: "" });
      fetchInvoices();
    } catch (err) { toast.error(err.response?.data?.detail || "Failed to settle"); }
  };

  const openEdit = async (id) => {
    try {
      const { data } = await API.get(`/invoices/${id}`);
      setEditDialog({ open: true, invoice: { ...data, items: [...(data.items || [])], created_at_date: (data.created_at || "").slice(0, 10) } });
    } catch (err) { toast.error("Failed to load invoice"); }
  };

  const updateEditItem = (idx, field, value) => {
    setEditDialog(d => {
      const items = [...d.invoice.items];
      items[idx] = { ...items[idx], [field]: value };
      if (field === "product_id") {
        const p = products.find(x => x.id === value);
        if (p) { items[idx].product_name = p.name; items[idx].unit_price = p.selling_price; }
      }
      return { ...d, invoice: { ...d.invoice, items } };
    });
  };

  const addEditItem = () => {
    setEditDialog(d => ({ ...d, invoice: { ...d.invoice, items: [...d.invoice.items, { product_id: "", product_name: "", quantity: 1, unit_price: "" }] } }));
  };
  const removeEditItem = (idx) => {
    setEditDialog(d => ({ ...d, invoice: { ...d.invoice, items: d.invoice.items.filter((_, i) => i !== idx) } }));
  };

  const saveEdit = async () => {
    const inv = editDialog.invoice;
    if (!inv) return;
    try {
      const payload = {
        customer_name: inv.customer_name,
        customer_shop_name: inv.customer_shop_name,
        notes: inv.notes,
        items: inv.items.map(i => ({
          product_id: i.product_id,
          product_name: i.product_name,
          quantity: parseFloat(i.quantity) || 0,
          unit_price: parseFloat(i.unit_price) || 0,
        })),
      };
      if (inv.created_at_date) payload.created_at = `${inv.created_at_date}T12:00:00`;
      await API.put(`/invoices/${inv.id}`, payload);
      toast.success("Invoice updated");
      setEditDialog({ open: false, invoice: null });
      fetchInvoices();
    } catch (err) { toast.error(err.response?.data?.detail || "Failed to update"); }
  };

  const editTotal = (editDialog.invoice?.items || []).reduce((s, i) => s + (parseFloat(i.quantity) || 0) * (parseFloat(i.unit_price) || 0), 0);

  return (
    <div className="space-y-6" data-testid="invoices-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight" style={{ fontFamily: 'Outfit, sans-serif' }}>Invoices</h1>
        <div className="text-xs text-muted-foreground" data-testid="invoices-info">Invoices are generated from Orders. Go to Orders → "Invoice" to create one.</div>
      </div>

      <div className="flex gap-3 flex-wrap">
        <div className="relative max-w-sm flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search invoices..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" data-testid="invoice-search-input" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36" data-testid="invoice-status-filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="unpaid">Unpaid</SelectItem>
            <SelectItem value="partial">Partial</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="border shadow-sm">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-muted-foreground">Loading...</div>
          ) : invoices.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <Receipt size={32} className="mx-auto mb-2 opacity-30" />
              No invoices yet. Generate one from an order.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table w-full">
                <thead><tr><th>Invoice #</th><th>Customer</th><th>Order #</th><th>Amount</th><th>Net Value</th><th>Status</th><th>Date</th><th className="w-56">Actions</th></tr></thead>
                <tbody>
                  {invoices.map(inv => (
                    <tr key={inv.id} data-testid={`invoice-row-${inv.id}`}>
                      <td className="font-medium">{inv.invoice_number}</td>
                      <td>
                        <div>{inv.customer_shop_name || inv.customer_name}</div>
                        {inv.customer_shop_name && <div className="text-xs text-muted-foreground">{inv.customer_name}</div>}
                      </td>
                      <td>{inv.order_number || "-"}</td>
                      <td>{"Rs. "}{fmt(inv.total_amount)}</td>
                      <td className="font-semibold" data-testid={`invoice-net-${inv.id}`}>
                        {"Rs. "}{fmt(inv.net_amount != null ? inv.net_amount : inv.total_amount)}
                        {inv.returned_amount > 0 && (
                          <span className="ml-2 text-[11px] text-amber-700" title="After credit notes">
                            (−{fmt(inv.returned_amount)})
                          </span>
                        )}
                      </td>
                      <td><Badge variant="secondary" className={`${STATUS_COLORS[inv.status]} text-xs rounded-full`}>{inv.status}</Badge></td>
                      <td className="text-muted-foreground">{inv.created_at?.slice(0, 10)}</td>
                      <td>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => viewInvoice(inv.id)} data-testid={`view-invoice-${inv.id}`}>
                            <Printer size={12} /> View
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => openEdit(inv.id)} data-testid={`edit-invoice-${inv.id}`}>
                            <Pencil size={12} /> Edit
                          </Button>
                          {inv.status !== "paid" && (
                            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-emerald-700" onClick={() => openSettle(inv.id)} data-testid={`settle-invoice-${inv.id}`}>
                              <CheckCircle2 size={12} /> Settle
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(inv.id)} data-testid={`delete-invoice-${inv.id}`}>
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

      {/* Print/View Invoice Dialog */}
      <Dialog open={printOpen} onOpenChange={setPrintOpen}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle style={{ fontFamily: 'Outfit, sans-serif' }}>Invoice</DialogTitle>
          </DialogHeader>
          {selectedInvoice && (
            <div className="print-container invoice-print">
              <div className="no-print flex justify-end mb-4">
                <Button size="sm" onClick={handlePrint} className="bg-[#0F172A] hover:bg-[#1E293B] rounded-sm gap-2" data-testid="print-invoice-button">
                  <Printer size={14} /> Print / Save PDF
                </Button>
              </div>

              {/* Invoice Header */}
              <div className="text-center mb-4">
                <h2 className="text-xl font-semibold tracking-tight" style={{ fontFamily: 'Outfit, sans-serif' }}>Commerical Trading</h2>
                <h3 className="text-lg font-semibold tracking-tight mt-0.5" style={{ fontFamily: 'Outfit, sans-serif' }}>INVOICE</h3>
                <p className="text-sm text-muted-foreground mt-0.5">{selectedInvoice.invoice_number}</p>
              </div>

              <div className="grid grid-cols-2 gap-6 mb-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Bill To</p>
                  <p className="font-semibold text-base" data-testid="invoice-bill-to">{selectedInvoice.customer_shop_name || selectedInvoice.customer_name}</p>
                  {selectedInvoice.customer_shop_name && <p className="text-sm text-muted-foreground">{selectedInvoice.customer_name}</p>}
                  {selectedInvoice.order_number && <p className="text-sm text-muted-foreground">Order: {selectedInvoice.order_number}</p>}
                </div>
                <div className="text-right">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Invoice Date</p>
                  <p className="font-medium">{selectedInvoice.created_at?.slice(0, 10)}</p>
                  <Badge variant="secondary" className={`${STATUS_COLORS[selectedInvoice.status]} text-xs rounded-full mt-2`}>{selectedInvoice.status}</Badge>
                </div>
              </div>

              <Separator className="mb-3" />

              {/* Items Table */}
              <table className="w-full text-sm mb-4">
                <thead>
                  <tr className="border-b-2 border-[#0F172A]">
                    <th className="text-left py-2 font-bold text-xs uppercase tracking-wider w-10">#</th>
                    <th className="text-left py-2 font-bold text-xs uppercase tracking-wider">Item</th>
                    <th className="text-right py-2 font-bold text-xs uppercase tracking-wider">Qty</th>
                    <th className="text-right py-2 font-bold text-xs uppercase tracking-wider">Unit Price</th>
                    <th className="text-right py-2 font-bold text-xs uppercase tracking-wider">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedInvoice.items?.map((item, idx) => (
                    <tr key={item.id} className="border-b">
                      <td className="py-2">{idx + 1}</td>
                      <td className="py-2">{item.product_name}</td>
                      <td className="py-2 text-right">{item.quantity}</td>
                      <td className="py-2 text-right">{"Rs. "}{fmt(item.unit_price)}</td>
                      <td className="py-2 text-right font-medium">{"Rs. "}{fmt(item.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="flex justify-end">
                <div className="w-72 space-y-2">
                  <div className="flex justify-between text-sm"><span>Subtotal</span><span>{"Rs. "}{fmt(selectedInvoice.total_amount)}</span></div>
                  {selectedInvoice.credit_notes?.length > 0 && (
                    <>
                      {selectedInvoice.credit_notes.map(cn => (
                        <div key={cn.id} className="flex justify-between text-sm text-amber-700" data-testid={`credit-note-line-${cn.id}`}>
                          <span className="flex items-center gap-1"><FileMinus size={12} /> {cn.credit_note_number || cn.return_number}</span>
                          <span>-{"Rs. "}{fmt(cn.total_amount)}</span>
                        </div>
                      ))}
                      <div className="flex justify-between text-sm font-medium border-t pt-1">
                        <span>Net Payable</span>
                        <span>{"Rs. "}{fmt(selectedInvoice.net_payable ?? selectedInvoice.total_amount)}</span>
                      </div>
                    </>
                  )}
                  {selectedInvoice.paid_amount > 0 && (
                    <div className="flex justify-between text-sm text-emerald-700"><span>Paid</span><span>-{"Rs. "}{fmt(selectedInvoice.paid_amount)}</span></div>
                  )}
                  {selectedInvoice.manual_settled_amount > 0 && (
                    <div className="flex justify-between text-sm text-emerald-700"><span>Manually Settled</span><span>-{"Rs. "}{fmt(selectedInvoice.manual_settled_amount)}</span></div>
                  )}
                  <Separator />
                  <div className="flex justify-between font-semibold text-lg" style={{ fontFamily: 'Outfit, sans-serif' }}>
                    <span>Total Due</span>
                    <span>{"Rs. "}{fmt(selectedInvoice.balance ?? selectedInvoice.total_amount)}</span>
                  </div>
                </div>
              </div>

              {selectedInvoice.credit_notes?.length > 0 && (
                <div className="mt-4 p-3 border rounded-sm bg-[hsl(var(--surface-muted))]">
                  <p className="text-xs font-bold uppercase tracking-wider mb-2 text-muted-foreground">Credit Notes Applied</p>
                  <div className="space-y-1 text-xs">
                    {selectedInvoice.credit_notes.map(cn => (
                      <div key={cn.id} className="flex justify-between">
                        <span>{cn.credit_note_number || cn.return_number} · {cn.created_at?.slice(0, 10)}</span>
                        <span className="font-medium">Rs. {fmt(cn.total_amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedInvoice.notes && (
                <div className="mt-4 text-sm text-muted-foreground">
                  <p className="font-bold text-xs uppercase tracking-wider mb-1">Notes</p>
                  <p>{selectedInvoice.notes}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Manual Settle Dialog */}
      <Dialog open={settleDialog.open} onOpenChange={(v) => setSettleDialog(d => ({ ...d, open: v }))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle style={{ fontFamily: 'Outfit, sans-serif' }}>Mark Invoice as Settled</DialogTitle>
          </DialogHeader>
          {settleDialog.invoice && (
            <div className="space-y-4 py-2">
              <div className="bg-[hsl(var(--surface-muted))] p-3 rounded-sm text-sm space-y-1">
                <div className="flex justify-between"><span>{settleDialog.invoice.invoice_number}</span><span className="text-muted-foreground">{settleDialog.invoice.customer_name}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Total</span><span>Rs. {fmt(settleDialog.invoice.total_amount)}</span></div>
                {settleDialog.invoice.paid_amount > 0 && (
                  <div className="flex justify-between"><span className="text-muted-foreground">Paid</span><span>Rs. {fmt(settleDialog.invoice.paid_amount)}</span></div>
                )}
                {settleDialog.invoice.returned_amount > 0 && (
                  <div className="flex justify-between"><span className="text-muted-foreground">Returns</span><span>Rs. {fmt(settleDialog.invoice.returned_amount)}</span></div>
                )}
                {settleDialog.invoice.manual_settled_amount > 0 && (
                  <div className="flex justify-between"><span className="text-muted-foreground">Already settled</span><span>Rs. {fmt(settleDialog.invoice.manual_settled_amount)}</span></div>
                )}
                <div className="flex justify-between font-semibold border-t pt-1"><span>Outstanding</span><span>Rs. {fmt(settleDialog.invoice.balance)}</span></div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-wider">Settlement Amount</Label>
                <Input
                  type="number"
                  value={settleDialog.amount}
                  onChange={e => setSettleDialog(d => ({ ...d, amount: e.target.value }))}
                  placeholder={`Leave blank to settle full Rs. ${fmt(settleDialog.invoice.balance)}`}
                  data-testid="settle-amount-input"
                />
                <p className="text-[11px] text-muted-foreground">Use this for legacy invoices already paid outside the system. No payment record is created.</p>
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-wider">Note</Label>
                <Textarea
                  value={settleDialog.note}
                  onChange={e => setSettleDialog(d => ({ ...d, note: e.target.value }))}
                  placeholder="Optional reason / reference"
                  className="min-h-[50px]"
                  data-testid="settle-note-input"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettleDialog(d => ({ ...d, open: false }))} className="rounded-sm">Cancel</Button>
            <Button onClick={confirmSettle} className="bg-emerald-700 hover:bg-emerald-800 text-white rounded-sm" data-testid="confirm-settle-button">
              Mark Settled
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Invoice Dialog */}
      <Dialog open={editDialog.open} onOpenChange={(v) => setEditDialog(d => ({ ...d, open: v }))}>
        <DialogContent className="sm:max-w-3xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle style={{ fontFamily: 'Outfit, sans-serif' }}>
              Edit Invoice {editDialog.invoice?.invoice_number}
            </DialogTitle>
          </DialogHeader>
          {editDialog.invoice && (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label className="text-xs font-bold uppercase tracking-wider">Customer Name</Label>
                  <Input value={editDialog.invoice.customer_name || ""} onChange={e => setEditDialog(d => ({ ...d, invoice: { ...d.invoice, customer_name: e.target.value } }))} data-testid="edit-customer-name" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-bold uppercase tracking-wider">Shop Name</Label>
                  <Input value={editDialog.invoice.customer_shop_name || ""} onChange={e => setEditDialog(d => ({ ...d, invoice: { ...d.invoice, customer_shop_name: e.target.value } }))} />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-bold uppercase tracking-wider">Date</Label>
                  <Input type="date" value={editDialog.invoice.created_at_date || ""} onChange={e => setEditDialog(d => ({ ...d, invoice: { ...d.invoice, created_at_date: e.target.value } }))} data-testid="edit-invoice-date" />
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <Label className="text-xs font-bold uppercase tracking-wider">Items</Label>
                  <Button type="button" variant="outline" size="sm" onClick={addEditItem} className="gap-1 text-xs rounded-sm" data-testid="edit-add-item">
                    <Plus size={12} /> Add Item
                  </Button>
                </div>
                {(editDialog.invoice.items || []).map((it, idx) => (
                  <div key={idx} className="border rounded-sm p-3 bg-[hsl(var(--surface-muted))] space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-bold text-muted-foreground">ITEM {idx + 1}</span>
                      <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeEditItem(idx)} data-testid={`edit-remove-item-${idx}`}>
                        <X size={14} />
                      </Button>
                    </div>
                    <SearchableSelect
                      options={products.map(p => ({ value: p.id, label: `${p.name} - Rs. ${fmt(p.selling_price)}` }))}
                      value={it.product_id}
                      onSelect={v => updateEditItem(idx, "product_id", v)}
                      placeholder="Select product..."
                    />
                    <div className="grid grid-cols-3 gap-3">
                      <div><Label className="text-[10px] uppercase">Qty</Label><Input type="number" value={it.quantity} onChange={e => updateEditItem(idx, "quantity", e.target.value)} /></div>
                      <div><Label className="text-[10px] uppercase">Unit Price</Label><Input type="number" value={it.unit_price} onChange={e => updateEditItem(idx, "unit_price", e.target.value)} /></div>
                      <div className="text-right pt-5 text-sm font-medium">
                        Rs. {fmt((parseFloat(it.quantity) || 0) * (parseFloat(it.unit_price) || 0))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <Textarea
                value={editDialog.invoice.notes || ""}
                onChange={e => setEditDialog(d => ({ ...d, invoice: { ...d.invoice, notes: e.target.value } }))}
                placeholder="Notes (optional)"
                className="min-h-[50px]"
              />

              <div className="text-right text-lg font-semibold border-t pt-3" style={{ fontFamily: 'Outfit, sans-serif' }}>
                Total: Rs. {fmt(editTotal)}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialog({ open: false, invoice: null })} className="rounded-sm">Cancel</Button>
            <Button onClick={saveEdit} className="bg-[#0F172A] hover:bg-[#1E293B] rounded-sm text-white" data-testid="save-edit-invoice-button">Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
