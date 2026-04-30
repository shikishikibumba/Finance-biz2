import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import API from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Plus, Search, Pencil, Trash2, Truck } from "lucide-react";

const fmt = (n) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

export default function SuppliersPage() {
  const navigate = useNavigate();
  const [suppliers, setSuppliers] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", phone: "", address: "", is_primary: false });

  const fetchSuppliers = useCallback(async () => {
    try {
      const { data } = await API.get("/suppliers", { params: { search: search || undefined } });
      setSuppliers(data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [search]);

  useEffect(() => { fetchSuppliers(); }, [fetchSuppliers]);

  const openNew = () => { setEditing(null); setForm({ name: "", phone: "", address: "", is_primary: false }); setDialogOpen(true); };
  const openEdit = (s) => { setEditing(s); setForm({ name: s.name, phone: s.phone, address: s.address, is_primary: s.is_primary }); setDialogOpen(true); };

  const handleSave = async () => {
    try {
      if (editing) {
        await API.put(`/suppliers/${editing.id}`, form);
        toast.success("Supplier updated");
      } else {
        await API.post("/suppliers", form);
        toast.success("Supplier created");
      }
      setDialogOpen(false);
      fetchSuppliers();
    } catch (err) { toast.error(err.response?.data?.detail || "Failed to save"); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this supplier?")) return;
    try {
      await API.delete(`/suppliers/${id}`);
      toast.success("Supplier deleted");
      fetchSuppliers();
    } catch (err) { toast.error("Failed to delete"); }
  };

  return (
    <div className="space-y-6" data-testid="suppliers-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight" style={{ fontFamily: 'Outfit, sans-serif' }}>Suppliers</h1>
        <Button onClick={openNew} className="bg-[#0F172A] hover:bg-[#1E293B] rounded-sm gap-2" data-testid="add-supplier-button">
          <Plus size={16} /> Add Supplier
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search suppliers..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" data-testid="supplier-search-input" />
      </div>

      <Card className="border shadow-sm">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-muted-foreground">Loading...</div>
          ) : suppliers.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <Truck size={32} className="mx-auto mb-2 opacity-30" />
              No suppliers found. Add your first supplier.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table w-full">
                <thead><tr><th>Name</th><th>Phone</th><th>Type</th><th>Payable</th><th className="w-20">Actions</th></tr></thead>
                <tbody>
                  {suppliers.map(s => (
                    <tr key={s.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/suppliers/${s.id}`)} data-testid={`supplier-row-${s.id}`}>
                      <td className="font-medium">{s.name}</td>
                      <td>{s.phone || "-"}</td>
                      <td>
                        {s.is_primary ? (
                          <Badge className="bg-[#0F172A] text-white text-xs rounded-full">Primary</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs rounded-full">Secondary</Badge>
                        )}
                      </td>
                      <td className={s.payable > 0 ? "text-red-600 font-semibold" : "text-emerald-600"}>
                        {"Rs. "}{fmt(s.payable)}
                      </td>
                      <td onClick={e => e.stopPropagation()}>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(s)} data-testid={`edit-supplier-${s.id}`}><Pencil size={14} /></Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(s.id)} data-testid={`delete-supplier-${s.id}`}><Trash2 size={14} /></Button>
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
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle style={{ fontFamily: 'Outfit, sans-serif' }}>{editing ? "Edit Supplier" : "New Supplier"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-wider">Name *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Supplier name" data-testid="supplier-name-input" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-wider">Phone</Label>
              <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="Phone" data-testid="supplier-phone-input" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-wider">Address</Label>
              <Input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="Address" data-testid="supplier-address-input" />
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={form.is_primary} onCheckedChange={v => setForm(f => ({ ...f, is_primary: v }))} data-testid="supplier-primary-switch" />
              <Label className="text-sm">Primary Supplier</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} className="rounded-sm">Cancel</Button>
            <Button onClick={handleSave} className="bg-[#0F172A] hover:bg-[#1E293B] rounded-sm" data-testid="save-supplier-button">{editing ? "Update" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
