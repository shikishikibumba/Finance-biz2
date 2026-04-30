import { useState, useEffect, useCallback, useRef } from "react";
import API from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/SearchableSelect";
import { toast } from "sonner";
import { Plus, Search, Trash2, Truck, Eye, Upload } from "lucide-react";

export default function DeliveryOrdersPage() {
  const [items, setItems] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [form, setForm] = useState(empty());
  const fileRef = useRef(null);

  function empty() {
    return {
      customer_id: "", customer_name: "",
      supplier_id: "", supplier_name: "",
      invoice_id: "", invoice_number: "",
      order_date: "", shipped_date: "",
      notes: "", image_data_url: "",
    };
  }

  const fetchAll = useCallback(async () => {
    try {
      const [d, c, s, i] = await Promise.all([
        API.get("/delivery-orders", { params: { search: search || undefined } }),
        API.get("/customers"), API.get("/suppliers"), API.get("/invoices"),
      ]);
      setItems(d.data);
      setCustomers(c.data);
      setSuppliers(s.data);
      setInvoices(i.data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [search]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const custOpts = customers.map(c => ({ value: c.id, label: c.shop_name ? `${c.name} (${c.shop_name})` : c.name }));
  const supOpts = suppliers.map(s => ({ value: s.id, label: s.name }));
  const invOpts = invoices.map(i => ({ value: i.id, label: `${i.invoice_number} - ${i.customer_name}` }));

  const openNew = () => { setEditing(null); setForm(empty()); setDialogOpen(true); };
  const openEdit = (d) => { setEditing(d); setForm({ ...d }); setDialogOpen(true); };

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast.error("Image must be under 2 MB"); return; }
    const reader = new FileReader();
    reader.onload = () => setForm(f => ({ ...f, image_data_url: reader.result }));
    reader.readAsDataURL(file);
  };

  const save = async () => {
    try {
      if (editing) await API.put(`/delivery-orders/${editing.id}`, form);
      else await API.post("/delivery-orders", form);
      toast.success(editing ? "Delivery slip updated" : "Delivery slip saved");
      setDialogOpen(false);
      fetchAll();
    } catch (err) { toast.error(err.response?.data?.detail || "Failed"); }
  };

  const remove = async (id) => {
    if (!window.confirm("Delete this delivery slip?")) return;
    try { await API.delete(`/delivery-orders/${id}`); toast.success("Deleted"); fetchAll(); }
    catch (err) { toast.error("Failed to delete"); }
  };

  return (
    <div className="space-y-6" data-testid="delivery-orders-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Truck size={28} />
          <div>
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight" style={{ fontFamily: 'Outfit, sans-serif' }}>Delivery Slips</h1>
            <p className="text-sm text-muted-foreground">Track delivery records with attached slip photo.</p>
          </div>
        </div>
        <Button onClick={openNew} className="bg-[#0F172A] hover:bg-[#1E293B] text-white rounded-sm gap-2" data-testid="add-delivery-button">
          <Plus size={16} /> New Slip
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search delivery slips..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" data-testid="delivery-search" />
      </div>

      <Card className="border shadow-sm">
        <CardContent className="p-0">
          {loading ? <div className="p-8 text-center text-muted-foreground">Loading...</div>
            : items.length === 0 ? <div className="p-8 text-center text-muted-foreground"><Truck size={32} className="mx-auto mb-2 opacity-30" />No delivery slips yet.</div>
            : <div className="overflow-x-auto">
                <table className="data-table w-full">
                  <thead><tr><th>Slip #</th><th>Customer</th><th>Supplier</th><th>Invoice #</th><th>Order Date</th><th>Shipped</th><th>Image</th><th className="w-28">Actions</th></tr></thead>
                  <tbody>
                    {items.map(d => (
                      <tr key={d.id} data-testid={`delivery-row-${d.id}`}>
                        <td className="font-medium">{d.delivery_number}</td>
                        <td>{d.customer_name || "-"}</td>
                        <td>{d.supplier_name || "-"}</td>
                        <td>{d.invoice_number || "-"}</td>
                        <td className="text-muted-foreground">{d.order_date || "-"}</td>
                        <td className="text-muted-foreground">{d.shipped_date || "-"}</td>
                        <td>{d.image_data_url ? <img src={d.image_data_url} alt="slip" className="h-10 w-10 object-cover rounded-sm border cursor-pointer" onClick={() => setViewing(d)} /> : <span className="text-xs text-muted-foreground">—</span>}</td>
                        <td>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => setViewing(d)} data-testid={`view-delivery-${d.id}`}><Eye size={12} /> View</Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => remove(d.id)} data-testid={`delete-delivery-${d.id}`}><Trash2 size={14} /></Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>}
        </CardContent>
      </Card>

      {/* Edit / Create */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-xl max-h-[92vh] overflow-y-auto">
          <DialogHeader><DialogTitle style={{ fontFamily: 'Outfit, sans-serif' }}>{editing ? `Edit ${editing.delivery_number}` : "New Delivery Slip"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-bold uppercase tracking-wider">Customer</Label>
                <SearchableSelect options={custOpts} value={form.customer_id} onSelect={id => { const c = customers.find(x => x.id === id); setForm(f => ({ ...f, customer_id: id, customer_name: c?.name || "" })); }} placeholder="Select customer..." />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-bold uppercase tracking-wider">Supplier</Label>
                <SearchableSelect options={supOpts} value={form.supplier_id} onSelect={id => { const s = suppliers.find(x => x.id === id); setForm(f => ({ ...f, supplier_id: id, supplier_name: s?.name || "" })); }} placeholder="Select supplier..." />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-bold uppercase tracking-wider">Linked Invoice</Label>
                <SearchableSelect options={invOpts} value={form.invoice_id} onSelect={id => { const i = invoices.find(x => x.id === id); setForm(f => ({ ...f, invoice_id: id, invoice_number: i?.invoice_number || "" })); }} placeholder="Select invoice..." />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-bold uppercase tracking-wider">Invoice # (manual)</Label>
                <Input value={form.invoice_number} onChange={e => setForm(f => ({ ...f, invoice_number: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-bold uppercase tracking-wider">Order Date</Label>
                <Input type="date" value={form.order_date} onChange={e => setForm(f => ({ ...f, order_date: e.target.value }))} data-testid="delivery-order-date" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-bold uppercase tracking-wider">Shipped Date</Label>
                <Input type="date" value={form.shipped_date} onChange={e => setForm(f => ({ ...f, shipped_date: e.target.value }))} data-testid="delivery-shipped-date" />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-wider">Slip Image</Label>
              <div className="flex items-center gap-3">
                <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} className="gap-1 rounded-sm" data-testid="delivery-upload-button">
                  <Upload size={14} /> {form.image_data_url ? "Replace Image" : "Upload Image"}
                </Button>
                <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
                {form.image_data_url && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setForm(f => ({ ...f, image_data_url: "" }))} className="text-destructive">Remove</Button>
                )}
              </div>
              {form.image_data_url && <img src={form.image_data_url} alt="preview" className="max-h-48 rounded-sm border" />}
            </div>

            <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Notes (optional)" className="min-h-[50px]" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} className="rounded-sm">Cancel</Button>
            <Button onClick={save} className="bg-[#0F172A] hover:bg-[#1E293B] text-white rounded-sm" data-testid="save-delivery-button">{editing ? "Save Changes" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View */}
      <Dialog open={!!viewing} onOpenChange={(v) => !v && setViewing(null)}>
        <DialogContent className="sm:max-w-xl max-h-[92vh] overflow-y-auto">
          <DialogHeader><DialogTitle style={{ fontFamily: 'Outfit, sans-serif' }}>{viewing?.delivery_number}</DialogTitle></DialogHeader>
          {viewing && (
            <div className="space-y-3 py-2 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><span className="text-xs text-muted-foreground uppercase block">Customer</span> {viewing.customer_name || "—"}</div>
                <div><span className="text-xs text-muted-foreground uppercase block">Supplier</span> {viewing.supplier_name || "—"}</div>
                <div><span className="text-xs text-muted-foreground uppercase block">Invoice #</span> {viewing.invoice_number || "—"}</div>
                <div><span className="text-xs text-muted-foreground uppercase block">Order Date</span> {viewing.order_date || "—"}</div>
                <div><span className="text-xs text-muted-foreground uppercase block">Shipped</span> {viewing.shipped_date || "—"}</div>
              </div>
              {viewing.image_data_url && <img src={viewing.image_data_url} alt="slip" className="w-full rounded-sm border" />}
              {viewing.notes && <div className="bg-[hsl(var(--surface-muted))] p-3 rounded-sm"><span className="text-xs text-muted-foreground uppercase block mb-1">Notes</span>{viewing.notes}</div>}
              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button variant="outline" onClick={() => { setViewing(null); openEdit(viewing); }} className="rounded-sm">Edit</Button>
                <Button onClick={() => setViewing(null)} className="bg-[#0F172A] hover:bg-[#1E293B] text-white rounded-sm">Close</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
