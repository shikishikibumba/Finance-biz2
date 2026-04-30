import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import API from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/SearchableSelect";
import { toast } from "sonner";
import { Plus, Search, Trash2, CreditCard, Pencil, X, Eye, Printer } from "lucide-react";
import { printPaymentVoucher } from "@/lib/print";

const fmt = (n) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const METHOD_COLORS = { cash: "bg-emerald-100 text-emerald-800", bank: "bg-blue-100 text-blue-800", transfer: "bg-indigo-100 text-indigo-800", cheque: "bg-gray-100 text-gray-800" };

const emptyForm = (payment_type = "customer") => ({
  payment_type,
  entity_id: "",
  entity_name: "",
  amount: "",
  payment_method: "cash",
  cheque_number: "",
  bank_name: "",
  cheque_date: "",
  cheques: [],
  allocations: [],
  notes: "",
});

export default function PaymentsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [payments, setPayments] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("customer");
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm());

  // View / print
  const [viewOpen, setViewOpen] = useState(false);
  const [viewing, setViewing] = useState(null);

  const fetchPayments = useCallback(async () => {
    try {
      const { data } = await API.get("/payments", { params: { payment_type: tab, search: search || undefined } });
      setPayments(data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [tab, search]);

  const fetchMasterData = useCallback(async () => {
    try {
      const [c, s, inv, pur] = await Promise.all([
        API.get("/customers"), API.get("/suppliers"), API.get("/invoices"), API.get("/purchases")
      ]);
      setCustomers(c.data);
      setSuppliers(s.data);
      setInvoices(inv.data);
      setPurchases(pur.data);
    } catch (err) { console.error(err); }
  }, []);

  useEffect(() => { fetchPayments(); }, [fetchPayments]);
  useEffect(() => { fetchMasterData(); }, [fetchMasterData]);

  useEffect(() => {
    if (searchParams.get("new") === "1") {
      setEditingId(null);
      setForm(emptyForm(tab));
      setDialogOpen(true);
      searchParams.delete("new");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams, tab]);

  const entityOptions = form.payment_type === "customer"
    ? customers.map(c => ({ value: c.id, label: `${c.name}${c.shop_name ? ` (${c.shop_name})` : ""}` }))
    : suppliers.map(s => ({ value: s.id, label: s.name }));

  const referenceOptions = form.payment_type === "customer"
    ? invoices.filter(i => !form.entity_id || i.customer_id === form.entity_id).map(i => ({
        value: i.id,
        label: `${i.invoice_number} · ${i.created_at?.slice(0,10) || ""} · Rs. ${fmt(i.total_amount)} · ${i.status || "unpaid"}`
      }))
    : purchases.filter(p => !form.entity_id || p.supplier_id === form.entity_id).map(p => ({
        value: p.id,
        label: `${p.purchase_number} · ${p.created_at?.slice(0,10) || ""} · Rs. ${fmt(p.original_amount ?? p.total_amount)}`
      }));

  const openNew = () => {
    setEditingId(null);
    setForm(emptyForm(tab));
    setDialogOpen(true);
  };

  const openEdit = async (id) => {
    try {
      const { data } = await API.get(`/payments/${id}`);
      setEditingId(id);
      setForm({
        payment_type: data.payment_type,
        entity_id: data.entity_id,
        entity_name: data.entity_name,
        amount: data.amount,
        payment_method: data.payment_method,
        cheque_number: data.cheque_number || "",
        bank_name: data.bank_name || "",
        cheque_date: data.cheque_date || "",
        cheques: data.cheques || [],
        allocations: data.allocations || [],
        notes: data.notes || "",
      });
      setDialogOpen(true);
    } catch (err) { toast.error("Failed to load payment"); }
  };

  const openView = async (id) => {
    try {
      const { data } = await API.get(`/payments/${id}`);
      const refs = data.payment_type === "customer" ? invoices : purchases;
      const refKey = data.payment_type === "customer" ? "invoice_number" : "purchase_number";
      data.allocations = (data.allocations || []).map(a => {
        const r = refs.find(x => x.id === a.reference_id);
        return { ...a, reference_number: r?.[refKey] || a.reference_id?.slice(0, 8), reference_total: r?.total_amount };
      });
      setViewing(data);
      setViewOpen(true);
    } catch (err) { toast.error("Failed to load payment"); }
  };

  const printVoucher = () => { if (viewing) printPaymentVoucher(viewing); };

  const selectEntity = (id) => {
    if (form.payment_type === "customer") {
      const cust = customers.find(c => c.id === id);
      setForm(f => ({ ...f, entity_id: id, entity_name: cust?.name || "", allocations: [] }));
    } else {
      const sup = suppliers.find(s => s.id === id);
      setForm(f => ({ ...f, entity_id: id, entity_name: sup?.name || "", allocations: [] }));
    }
  };

  const addCheque = () => setForm(f => ({ ...f, cheques: [...f.cheques, { amount: "", bank_name: "", cheque_number: "", cheque_date: "" }] }));
  const updateCheque = (idx, field, value) => setForm(f => {
    const cheques = [...f.cheques];
    cheques[idx] = { ...cheques[idx], [field]: value };
    return { ...f, cheques };
  });
  const removeCheque = (idx) => setForm(f => ({ ...f, cheques: f.cheques.filter((_, i) => i !== idx) }));
  const chequesTotal = form.cheques.reduce((s, c) => s + (parseFloat(c.amount) || 0), 0);

  const addAllocation = () => setForm(f => ({
    ...f,
    allocations: [...f.allocations, { reference_id: "", reference_type: f.payment_type === "customer" ? "invoice" : "purchase", amount: "" }]
  }));
  const updateAllocation = (idx, field, value) => setForm(f => {
    const allocations = [...f.allocations];
    allocations[idx] = { ...allocations[idx], [field]: value };
    return { ...f, allocations };
  });
  const removeAllocation = (idx) => setForm(f => ({ ...f, allocations: f.allocations.filter((_, i) => i !== idx) }));
  const allocationsTotal = form.allocations.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);

  const handleSave = async () => {
    if (!form.entity_id) { toast.error("Select a " + form.payment_type); return; }
    const amt = parseFloat(form.amount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }

    if (form.payment_method === "cheque") {
      if (form.cheques.length > 0) {
        for (const c of form.cheques) {
          if (!c.cheque_number) { toast.error("Every cheque needs a cheque number"); return; }
          if (!c.amount || parseFloat(c.amount) <= 0) { toast.error("Every cheque needs a positive amount"); return; }
        }
        if (Math.abs(chequesTotal - amt) > 0.01) {
          toast.error(`Cheque total (Rs. ${fmt(chequesTotal)}) must match payment amount (Rs. ${fmt(amt)})`);
          return;
        }
      } else if (!form.cheque_number) {
        toast.error("Enter cheque number or add multiple cheques"); return;
      }
    }

    const validAllocs = form.allocations.filter(a => a.reference_id && parseFloat(a.amount) > 0);
    const allocTotal = validAllocs.reduce((s, a) => s + parseFloat(a.amount), 0);
    if (allocTotal > amt + 0.01) {
      toast.error(`Allocation total (Rs. ${fmt(allocTotal)}) cannot exceed payment amount (Rs. ${fmt(amt)})`);
      return;
    }

    const payload = {
      payment_type: form.payment_type,
      entity_id: form.entity_id,
      entity_name: form.entity_name,
      amount: amt,
      payment_method: form.payment_method,
      cheque_number: form.payment_method === "cheque" ? (form.cheque_number || "") : "",
      bank_name: form.payment_method === "cheque" ? (form.bank_name || "") : "",
      cheque_date: form.payment_method === "cheque" ? (form.cheque_date || "") : "",
      cheques: form.payment_method === "cheque" ? form.cheques.map(c => ({
        amount: parseFloat(c.amount),
        bank_name: c.bank_name || "",
        cheque_number: c.cheque_number,
        cheque_date: c.cheque_date || "",
      })) : [],
      allocations: validAllocs.map(a => ({
        reference_id: a.reference_id,
        reference_type: a.reference_type,
        amount: parseFloat(a.amount),
      })),
      notes: form.notes,
    };

    try {
      if (editingId) {
        await API.put(`/payments/${editingId}`, payload);
        toast.success("Payment updated");
      } else {
        await API.post("/payments", payload);
        toast.success("Payment recorded");
      }
      setDialogOpen(false);
      fetchPayments();
      fetchMasterData();
    } catch (err) { toast.error(err.response?.data?.detail || "Failed"); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this payment?")) return;
    try {
      await API.delete(`/payments/${id}`);
      toast.success("Payment deleted");
      fetchPayments();
      fetchMasterData();
    } catch (err) { toast.error("Failed to delete"); }
  };

  return (
    <div className="space-y-6" data-testid="payments-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight" style={{ fontFamily: 'Outfit, sans-serif' }}>Payments</h1>
        <Button onClick={openNew} className="bg-[#0F172A] hover:bg-[#1E293B] rounded-sm gap-2" data-testid="record-payment-button">
          <Plus size={16} /> Record Payment
        </Button>
      </div>

      <Tabs value={tab} onValueChange={(v) => { setTab(v); setLoading(true); }}>
        <TabsList className="bg-muted">
          <TabsTrigger value="customer" data-testid="customer-payments-tab">Customer Payments</TabsTrigger>
          <TabsTrigger value="supplier" data-testid="supplier-payments-tab">Supplier Payments</TabsTrigger>
        </TabsList>

        <div className="relative max-w-sm mt-4">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search payments..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" data-testid="payment-search-input" />
        </div>

        <TabsContent value={tab} className="mt-4">
          <Card className="border shadow-sm">
            <CardContent className="p-0">
              {loading ? (
                <div className="p-8 text-center text-muted-foreground">Loading...</div>
              ) : payments.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  <CreditCard size={32} className="mx-auto mb-2 opacity-30" />
                  No {tab} payments recorded yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="data-table w-full">
                    <thead>
                      <tr>
                        <th>{tab === "customer" ? "Customer" : "Supplier"}</th>
                        <th>Amount</th>
                        <th>Method</th>
                        <th>Allocated To</th>
                        <th>Date</th>
                        <th className="w-32">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map(p => (
                        <tr key={p.id} data-testid={`payment-row-${p.id}`}>
                          <td className="font-medium">{p.entity_name}</td>
                          <td className="font-semibold">{"Rs. "}{fmt(p.amount)}</td>
                          <td>
                            <Badge variant="secondary" className={`${METHOD_COLORS[p.payment_method] || "bg-gray-100"} text-xs rounded-full`}>{p.payment_method}</Badge>
                            {p.payment_method === "cheque" && (p.cheques?.length > 1
                              ? <div className="text-[10px] text-muted-foreground mt-1">{p.cheques.length} cheques</div>
                              : p.cheque_number && <div className="text-[10px] text-muted-foreground mt-1">#{p.cheque_number}{p.bank_name ? ` · ${p.bank_name}` : ""}</div>)}
                          </td>
                          <td className="text-muted-foreground text-xs">
                            {(p.allocations && p.allocations.length > 0)
                              ? `${p.allocations.length} ${p.allocations[0].reference_type}(s)`
                              : (p.notes || "-")}
                          </td>
                          <td className="text-muted-foreground">{p.created_at?.slice(0, 10)}</td>
                          <td>
                            <div className="flex gap-1">
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openView(p.id)} data-testid={`view-payment-${p.id}`} title="View">
                                <Eye size={14} />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(p.id)} data-testid={`edit-payment-${p.id}`} title="Edit">
                                <Pencil size={14} />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(p.id)} data-testid={`delete-payment-${p.id}`} title="Delete">
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
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto">
          <DialogHeader><DialogTitle style={{ fontFamily: 'Outfit, sans-serif' }}>{editingId ? "Edit Payment" : "Record Payment"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-wider">Payment Type</Label>
              <Select
                value={form.payment_type}
                disabled={!!editingId}
                onValueChange={v => setForm(() => ({ ...emptyForm(v) }))}
              >
                <SelectTrigger data-testid="payment-type-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="customer">Customer Payment (Receive)</SelectItem>
                  <SelectItem value="supplier">Supplier Payment (Pay)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-wider">{form.payment_type === "customer" ? "Customer" : "Supplier"} *</Label>
              <SearchableSelect options={entityOptions} value={form.entity_id} onSelect={selectEntity} placeholder={`Select ${form.payment_type}...`} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-wider">Amount *</Label>
                <Input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value === "" ? "" : parseFloat(e.target.value) }))} placeholder="Amount" data-testid="payment-amount-input" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-wider">Method</Label>
                <Select value={form.payment_method} onValueChange={v => setForm(f => ({ ...f, payment_method: v, cheques: v === "cheque" ? f.cheques : [] }))}>
                  <SelectTrigger data-testid="payment-method-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="bank">Bank</SelectItem>
                    <SelectItem value="transfer">Transfer</SelectItem>
                    <SelectItem value="cheque">Cheque</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {form.payment_method === "cheque" && (
              <div className="border rounded-sm bg-[#F8FAFC] p-3 space-y-3" data-testid="cheque-section">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-bold uppercase tracking-wider">Cheques</Label>
                  <Button type="button" variant="outline" size="sm" className="rounded-sm text-xs h-7 gap-1" onClick={addCheque} data-testid="add-cheque-button">
                    <Plus size={12} /> Add Cheque
                  </Button>
                </div>

                {form.cheques.length === 0 ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Cheque No. *</Label>
                      <Input value={form.cheque_number} onChange={e => setForm(f => ({ ...f, cheque_number: e.target.value }))} placeholder="Cheque number" data-testid="cheque-number-input" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Bank</Label>
                      <Input value={form.bank_name} onChange={e => setForm(f => ({ ...f, bank_name: e.target.value }))} placeholder="Bank name" data-testid="cheque-bank-input" />
                    </div>
                    <div className="space-y-1.5 col-span-2">
                      <Label className="text-xs">Cheque Date</Label>
                      <Input type="date" value={form.cheque_date} onChange={e => setForm(f => ({ ...f, cheque_date: e.target.value }))} data-testid="cheque-date-input" />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {form.cheques.map((c, idx) => (
                      <div key={idx} className="bg-white border rounded-sm p-2.5 space-y-2" data-testid={`cheque-entry-${idx}`}>
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-muted-foreground">CHEQUE {idx + 1}</span>
                          <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeCheque(idx)}><X size={12} /></Button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <Label className="text-[10px] uppercase">Amount *</Label>
                            <Input type="number" value={c.amount} onChange={e => updateCheque(idx, "amount", e.target.value === "" ? "" : parseFloat(e.target.value))} placeholder="Amount" className="h-8 text-sm" data-testid={`cheque-${idx}-amount`} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[10px] uppercase">Cheque No *</Label>
                            <Input value={c.cheque_number} onChange={e => updateCheque(idx, "cheque_number", e.target.value)} placeholder="000123" className="h-8 text-sm" data-testid={`cheque-${idx}-number`} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[10px] uppercase">Bank</Label>
                            <Input value={c.bank_name} onChange={e => updateCheque(idx, "bank_name", e.target.value)} placeholder="Bank" className="h-8 text-sm" data-testid={`cheque-${idx}-bank`} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[10px] uppercase">Date</Label>
                            <Input type="date" value={c.cheque_date} onChange={e => updateCheque(idx, "cheque_date", e.target.value)} className="h-8 text-sm" data-testid={`cheque-${idx}-date`} />
                          </div>
                        </div>
                      </div>
                    ))}
                    <div className={`flex justify-between text-xs px-2 pt-1 ${Math.abs(chequesTotal - (parseFloat(form.amount) || 0)) < 0.01 ? "text-emerald-700" : "text-amber-700"}`}>
                      <span>Cheque Total</span>
                      <span className="font-semibold" data-testid="cheques-total">
                        Rs. {fmt(chequesTotal)} / Rs. {fmt(parseFloat(form.amount) || 0)}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="border rounded-sm bg-[#F8FAFC] p-3 space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-bold uppercase tracking-wider">
                  Allocate to {form.payment_type === "customer" ? "Invoices" : "Purchases"}
                </Label>
                <Button type="button" variant="outline" size="sm" className="rounded-sm text-xs h-7 gap-1" onClick={addAllocation} disabled={!form.entity_id} data-testid="add-allocation-button">
                  <Plus size={12} /> Add Allocation
                </Button>
              </div>

              {form.allocations.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">No allocations (optional). Select the entity first, then allocate this payment across one or more {form.payment_type === "customer" ? "invoices" : "purchases"}.</p>
              ) : (
                <div className="space-y-2">
                  {form.allocations.map((a, idx) => (
                    <div key={idx} className="bg-white border rounded-sm p-2.5 space-y-2" data-testid={`allocation-entry-${idx}`}>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-muted-foreground">#{idx + 1}</span>
                        <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeAllocation(idx)}><X size={12} /></Button>
                      </div>
                      <SearchableSelect
                        options={referenceOptions}
                        value={a.reference_id}
                        onSelect={v => updateAllocation(idx, "reference_id", v)}
                        placeholder={`Select ${a.reference_type}...`}
                      />
                      <Input type="number" value={a.amount} onChange={e => updateAllocation(idx, "amount", e.target.value === "" ? "" : parseFloat(e.target.value))} placeholder="Allocation amount" className="h-8 text-sm" data-testid={`allocation-${idx}-amount`} />
                    </div>
                  ))}
                  <div className={`flex justify-between text-xs px-2 pt-1 ${allocationsTotal <= (parseFloat(form.amount) || 0) + 0.01 ? "text-emerald-700" : "text-red-700"}`}>
                    <span>Allocation Total</span>
                    <span className="font-semibold" data-testid="allocations-total">
                      Rs. {fmt(allocationsTotal)} / Rs. {fmt(parseFloat(form.amount) || 0)}
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-wider">Notes</Label>
              <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Payment notes" className="min-h-[60px]" data-testid="payment-notes-input" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} className="rounded-sm">Cancel</Button>
            <Button onClick={handleSave} className="bg-[#0F172A] hover:bg-[#1E293B] rounded-sm" data-testid="submit-payment-button">
              {editingId ? "Save Changes" : "Record Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payment View / Print */}
      <Dialog open={viewOpen} onOpenChange={setViewOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto" data-testid="payment-view-dialog">
          <DialogHeader>
            <DialogTitle style={{ fontFamily: 'Outfit, sans-serif' }} className="flex items-center justify-between gap-3">
              <span>Payment Details</span>
              <Button onClick={printVoucher} size="sm" className="bg-[#0F172A] hover:bg-[#1E293B] text-white rounded-sm gap-1 h-8 mr-6" data-testid="payment-print-button">
                <Printer size={14} /> Print
              </Button>
            </DialogTitle>
          </DialogHeader>
          {viewing && (
            <div className="space-y-4 py-2 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{viewing.payment_type === "customer" ? "Customer" : "Supplier"}</p>
                  <p className="font-medium">{viewing.entity_name}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Date</p>
                  <p className="font-medium">{viewing.created_at?.slice(0, 10)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Total</p>
                  <p className="font-semibold text-lg" data-testid="payment-view-total">Rs. {fmt(viewing.amount)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Method</p>
                  <Badge variant="secondary" className={`${METHOD_COLORS[viewing.payment_method] || "bg-gray-100"} text-xs rounded-full`}>{viewing.payment_method}</Badge>
                </div>
              </div>

              {viewing.payment_method === "cheque" && (
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Cheque Breakdown</p>
                  <table className="w-full text-xs border rounded-sm overflow-hidden">
                    <thead className="bg-muted">
                      <tr><th className="text-left p-2">Cheque #</th><th className="text-left p-2">Bank</th><th className="text-left p-2">Date</th><th className="text-right p-2">Amount</th></tr>
                    </thead>
                    <tbody>
                      {(viewing.cheques?.length > 0
                        ? viewing.cheques
                        : [{ cheque_number: viewing.cheque_number, bank_name: viewing.bank_name, cheque_date: viewing.cheque_date, amount: viewing.amount }]
                      ).map((c, idx) => (
                        <tr key={idx} className="border-t" data-testid={`payment-view-cheque-${idx}`}>
                          <td className="p-2 font-medium">{c.cheque_number || "-"}</td>
                          <td className="p-2">{c.bank_name || "-"}</td>
                          <td className="p-2">{c.cheque_date || "-"}</td>
                          <td className="p-2 text-right">Rs. {fmt(c.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {viewing.allocations?.length > 0 && (
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
                    Allocated to {viewing.payment_type === "customer" ? "Invoices" : "Purchases"}
                  </p>
                  <table className="w-full text-xs border rounded-sm overflow-hidden">
                    <thead className="bg-muted">
                      <tr>
                        <th className="text-left p-2">{viewing.payment_type === "customer" ? "Invoice" : "Purchase"} #</th>
                        <th className="text-right p-2">Total</th>
                        <th className="text-right p-2">Allocated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {viewing.allocations.map((a, idx) => (
                        <tr key={idx} className="border-t" data-testid={`payment-view-alloc-${idx}`}>
                          <td className="p-2 font-medium">{a.reference_number}</td>
                          <td className="p-2 text-right text-muted-foreground">{a.reference_total ? `Rs. ${fmt(a.reference_total)}` : "-"}</td>
                          <td className="p-2 text-right font-semibold">Rs. {fmt(a.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {viewing.notes && (
                <div className="bg-muted/50 p-3 rounded-sm">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Notes</p>
                  <p className="text-sm">{viewing.notes}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
