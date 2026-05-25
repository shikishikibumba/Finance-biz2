import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import API from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Search, Pencil, Trash2, Users } from "lucide-react";

const fmt = (n) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

export default function CustomersPage() {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", phone: "", shop_name: "", address: "" });

  const fetchCustomers = useCallback(async () => {
    try {
      const { data } = await API.get("/customers", { params: { search: search || undefined } });
      setCustomers(data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [search]);

  useEffect(() => { fetchCustomers(); }, [fetchCustomers]);

  const openNew = () => { setEditing(null); setForm({ name: "", phone: "", shop_name: "", address: "" }); setDialogOpen(true); };
  const openEdit = (c) => { setEditing(c); setForm({ name: c.name, phone: c.phone, shop_name: c.shop_name, address: c.address }); setDialogOpen(true); };

  const handleSave = async () => {
    try {
      if (editing) {
        await API.put(`/customers/${editing.id}`, form);
        toast.success("Customer updated");
      } else {
        await API.post("/customers", form);
        toast.success("Customer created");
      }
      setDialogOpen(false);
      fetchCustomers();
    } catch (err) { toast.error(err.response?.data?.detail || "Failed to save"); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this customer?")) return;
    try {
      await API.delete(`/customers/${id}`);
      toast.success("Customer deleted");
      fetchCustomers();
    } catch (err) { toast.error("Failed to delete"); }
  };

  return (
    <div className="space-y-6" data-testid="customers-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight" style={{ fontFamily: 'Outfit, sans-serif' }}>Customers</h1>
        <Button onClick={openNew} className="bg-[#0F172A] hover:bg-[#1E293B] rounded-sm gap-2" data-testid="add-customer-button">
          <Plus size={16} /> Add Customer
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search customers..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
          data-testid="customer-search-input"
        />
      </div>

      <Card className="border shadow-sm">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-muted-foreground">Loading...</div>
          ) : customers.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <Users size={32} className="mx-auto mb-2 opacity-30" />
              No customers found. Add your first customer to get started.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table w-full">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Phone</th>
                    <th>Shop</th>
                    <th>Address</th>
                    <th>Outstanding</th>
                    <th className="w-20">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map(c => (
                    <tr key={c.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/customers/${c.id}`)} data-testid={`customer-row-${c.id}`}>
                      <td className="font-medium">{c.name}</td>
                      <td>{c.phone || "-"}</td>
                      <td>{c.shop_name || "-"}</td>
                      <td className="text-muted-foreground text-sm">{c.address || "-"}</td>
                      <td className={c.outstanding > 0 ? "text-amber-600 font-semibold" : "text-emerald-600"}>
                        {"Rs. "}{fmt(c.outstanding)}
                      </td>
                      <td onClick={e => e.stopPropagation()}>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(c)} data-testid={`edit-customer-${c.id}`}>
                            <Pencil size={14} />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(c.id)} data-testid={`delete-customer-${c.id}`}>
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
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle style={{ fontFamily: 'Outfit, sans-serif' }}>{editing ? "Edit Customer" : "New Customer"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-wider">Name *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Customer name" data-testid="customer-name-input" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-wider">Phone</Label>
              <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="Phone number" data-testid="customer-phone-input" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-wider">Shop Name</Label>
              <Input value={form.shop_name} onChange={e => setForm(f => ({ ...f, shop_name: e.target.value }))} placeholder="Shop / Business name" data-testid="customer-shop-input" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-wider">Address</Label>
              <Input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="Address" data-testid="customer-address-input" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} className="rounded-sm">Cancel</Button>
            <Button onClick={handleSave} className="bg-[#0F172A] hover:bg-[#1E293B] rounded-sm" data-testid="save-customer-button">
              {editing ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
