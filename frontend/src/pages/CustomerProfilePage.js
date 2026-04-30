import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import API from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, TrendingUp, Receipt, CreditCard, ShoppingCart, Package, BookOpen } from "lucide-react";

const fmt = (n) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

export default function CustomerProfilePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [customer, setCustomer] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    API.get(`/customers/${id}`).then(r => setCustomer(r.data)).catch(console.error).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="p-8 text-center text-muted-foreground">Loading...</div>;
  if (!customer) return <div className="p-8 text-center text-muted-foreground">Customer not found</div>;

  return (
    <div className="space-y-6" data-testid="customer-profile-page">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="icon" onClick={() => navigate("/customers")} data-testid="back-to-customers"><ArrowLeft size={18} /></Button>
        <div className="flex-1">
          <h1 className="text-3xl font-semibold tracking-tight" style={{ fontFamily: 'Outfit, sans-serif' }}>{customer.name}</h1>
          {customer.shop_name && <p className="text-muted-foreground text-sm">{customer.shop_name}</p>}
          {customer.phone && <p className="text-muted-foreground text-xs">{customer.phone}</p>}
        </div>
        <Button onClick={() => navigate(`/ledger/customer/${customer.id}`)} variant="outline" className="gap-2 rounded-sm" data-testid="customer-ledger-button">
          <BookOpen size={14} /> View Ledger
        </Button>
      </div>

      {/* Financial Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border shadow-sm"><CardContent className="p-5">
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Total Outstanding</div>
          <div className="text-2xl font-semibold" style={{ fontFamily: 'Outfit, sans-serif' }}>
            <span className={customer.outstanding > 0 ? "text-amber-600" : "text-emerald-600"}>Rs. {fmt(customer.outstanding)}</span>
          </div>
        </CardContent></Card>

        <Card className="border shadow-sm"><CardContent className="p-5">
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Monthly Avg Sales</div>
          <div className="text-2xl font-semibold" style={{ fontFamily: 'Outfit, sans-serif' }}>Rs. {fmt(customer.monthly_avg_sales)}</div>
        </CardContent></Card>

        <Card className="border shadow-sm"><CardContent className="p-5">
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Highest Invoice</div>
          <div className="text-2xl font-semibold" style={{ fontFamily: 'Outfit, sans-serif' }}>
            {customer.highest_invoice ? `Rs. ${fmt(customer.highest_invoice.total_amount)}` : "N/A"}
          </div>
          {customer.highest_invoice && <p className="text-xs text-muted-foreground mt-1">{customer.highest_invoice.invoice_number}</p>}
        </CardContent></Card>

        <Card className="border shadow-sm"><CardContent className="p-5">
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Last Payment</div>
          <div className="text-2xl font-semibold" style={{ fontFamily: 'Outfit, sans-serif' }}>
            {customer.last_payment ? `Rs. ${fmt(customer.last_payment.amount)}` : "N/A"}
          </div>
          {customer.last_payment && <p className="text-xs text-muted-foreground mt-1">{customer.last_payment.created_at?.slice(0, 10)}</p>}
        </CardContent></Card>
      </div>

      {customer.most_purchased_product && (
        <div className="flex items-center gap-2 text-sm">
          <Package size={14} className="text-muted-foreground" />
          <span className="text-muted-foreground">Most purchased:</span>
          <span className="font-semibold">{customer.most_purchased_product}</span>
        </div>
      )}

      <Separator />

      {/* Invoices */}
      <Card className="border shadow-sm">
        <CardContent className="p-5">
          <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4 flex items-center gap-2"><Receipt size={14} /> Invoices</h3>
          {customer.invoices?.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="data-table w-full">
                <thead><tr><th>Invoice #</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead>
                <tbody>
                  {customer.invoices.map(inv => (
                    <tr key={inv.id} className="cursor-pointer" onClick={() => navigate("/invoices")}>
                      <td className="font-medium">{inv.invoice_number}</td>
                      <td>Rs. {fmt(inv.total_amount)}</td>
                      <td><Badge variant="secondary" className={`text-xs rounded-full ${inv.status === "paid" ? "bg-emerald-100 text-emerald-800" : inv.status === "partial" ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800"}`}>{inv.status}</Badge></td>
                      <td className="text-muted-foreground">{inv.created_at?.slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-sm text-muted-foreground">No invoices yet.</p>}
        </CardContent>
      </Card>

      {/* Payments */}
      <Card className="border shadow-sm">
        <CardContent className="p-5">
          <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4 flex items-center gap-2"><CreditCard size={14} /> Payments</h3>
          {customer.payments?.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="data-table w-full">
                <thead><tr><th>Amount</th><th>Method</th><th>Notes</th><th>Date</th></tr></thead>
                <tbody>
                  {customer.payments.map(p => (
                    <tr key={p.id}>
                      <td className="font-semibold">Rs. {fmt(p.amount)}</td>
                      <td><Badge variant="secondary" className="text-xs rounded-full">{p.payment_method}</Badge></td>
                      <td className="text-muted-foreground text-sm">{p.notes || "-"}</td>
                      <td className="text-muted-foreground">{p.created_at?.slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-sm text-muted-foreground">No payments yet.</p>}
        </CardContent>
      </Card>

      {/* Orders */}
      <Card className="border shadow-sm">
        <CardContent className="p-5">
          <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4 flex items-center gap-2"><ShoppingCart size={14} /> Orders</h3>
          {customer.orders?.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="data-table w-full">
                <thead><tr><th>Order #</th><th>Items</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead>
                <tbody>
                  {customer.orders.map(o => (
                    <tr key={o.id} className="cursor-pointer" onClick={() => navigate("/orders")}>
                      <td className="font-medium">{o.order_number}</td>
                      <td>{o.items?.length || 0}</td>
                      <td>Rs. {fmt(o.total_amount)}</td>
                      <td><Badge variant="secondary" className={`text-xs rounded-full ${o.status === "delivered" ? "bg-emerald-100 text-emerald-800" : o.status === "ordered" ? "bg-blue-100 text-blue-800" : "bg-amber-100 text-amber-800"}`}>{o.status}</Badge></td>
                      <td className="text-muted-foreground">{o.created_at?.slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-sm text-muted-foreground">No orders yet.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
