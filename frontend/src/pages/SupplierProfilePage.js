import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import API from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, CreditCard, FileText, Package, BookOpen, RotateCcw, FileBarChart } from "lucide-react";

const fmt = (n) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

export default function SupplierProfilePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [supplier, setSupplier] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    API.get(`/suppliers/${id}`).then(r => setSupplier(r.data)).catch(console.error).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="p-8 text-center text-muted-foreground">Loading...</div>;
  if (!supplier) return <div className="p-8 text-center text-muted-foreground">Supplier not found</div>;

  return (
    <div className="space-y-6" data-testid="supplier-profile-page">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="icon" onClick={() => navigate("/suppliers")} data-testid="back-to-suppliers"><ArrowLeft size={18} /></Button>
        <div className="flex-1">
          <h1 className="text-3xl font-semibold tracking-tight" style={{ fontFamily: 'Outfit, sans-serif' }}>{supplier.name}</h1>
          {supplier.phone && <p className="text-muted-foreground text-sm">{supplier.phone}</p>}
          {supplier.is_primary && <Badge className="bg-[#0F172A] text-white text-xs rounded-full mt-1">Primary Supplier</Badge>}
        </div>
        <Button onClick={() => navigate(`/reports?tab=supplier-out&id=${supplier.id}`)} variant="outline" className="gap-2 rounded-sm" data-testid="supplier-outstanding-button">
          <FileBarChart size={14} /> Outstanding
        </Button>
        <Button onClick={() => navigate(`/ledger/supplier/${supplier.id}`)} variant="outline" className="gap-2 rounded-sm" data-testid="supplier-ledger-button">
          <BookOpen size={14} /> View Ledger
        </Button>
      </div>

      {/* 4-card summary: Total Purchases / Credit Notes / Net Payable / Last Payment */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border shadow-sm" data-testid="supplier-card-total-purchases"><CardContent className="p-5">
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Total Purchases (Original)</div>
          <div className="text-2xl font-semibold" style={{ fontFamily: 'Outfit, sans-serif' }}>
            Rs. {fmt(supplier.total_purchases)}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">{supplier.purchases?.length || 0} purchase invoices</p>
        </CardContent></Card>

        <Card className="border shadow-sm" data-testid="supplier-card-credit-notes"><CardContent className="p-5">
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Total Credit Notes (Returns)</div>
          <div className="text-2xl font-semibold text-amber-600" style={{ fontFamily: 'Outfit, sans-serif' }}>
            Rs. {fmt(supplier.total_credit_notes)}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">{supplier.credit_notes?.length || 0} credit notes issued</p>
        </CardContent></Card>

        <Card className="border shadow-sm" data-testid="supplier-card-net-payable"><CardContent className="p-5">
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Net Payable</div>
          <div className="text-2xl font-semibold" style={{ fontFamily: 'Outfit, sans-serif' }}>
            <span className={supplier.payable > 0 ? "text-red-600" : "text-emerald-600"}>Rs. {fmt(supplier.payable)}</span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">After credit notes & payments</p>
        </CardContent></Card>

        <Card className="border shadow-sm"><CardContent className="p-5">
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Last Payment</div>
          <div className="text-2xl font-semibold" style={{ fontFamily: 'Outfit, sans-serif' }}>
            {supplier.last_payment ? `Rs. ${fmt(supplier.last_payment.amount)}` : "N/A"}
          </div>
          {supplier.last_payment && <p className="text-[11px] text-muted-foreground mt-1">{supplier.last_payment.created_at?.slice(0, 10)}</p>}
        </CardContent></Card>
      </div>

      {/* Fast Moving Items */}
      {supplier.fast_moving_items?.length > 0 && (
        <Card className="border shadow-sm">
          <CardContent className="p-5">
            <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4 flex items-center gap-2"><Package size={14} /> Fast Moving Items</h3>
            <div className="space-y-2">
              {supplier.fast_moving_items.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between py-2 border-b border-dashed last:border-0">
                  <span className="text-sm font-medium">{item.product}</span>
                  <span className="text-sm text-muted-foreground">{item.quantity} units</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Separator />

      {/* Purchases — show original / credit-note / net columns */}
      <Card className="border shadow-sm">
        <CardContent className="p-5">
          <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4 flex items-center gap-2"><FileText size={14} /> Purchases</h3>
          {supplier.purchases?.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="data-table w-full">
                <thead><tr>
                  <th>Purchase #</th>
                  <th>Sup. Inv #</th>
                  <th>Date</th>
                  <th className="text-right">Original</th>
                  <th className="text-right">Credit Notes</th>
                  <th className="text-right">Net Payable</th>
                </tr></thead>
                <tbody>
                  {supplier.purchases.map(p => (
                    <tr key={p.id} data-testid={`sup-purchase-row-${p.id}`}>
                      <td className="font-medium">{p.purchase_number}</td>
                      <td className="text-muted-foreground">{p.supplier_invoice_number || "-"}</td>
                      <td className="text-muted-foreground">{p.created_at?.slice(0, 10)}</td>
                      <td className="text-right">Rs. {fmt(p.original_amount ?? p.total_amount)}</td>
                      <td className={`text-right ${p.credit_notes_total > 0 ? "text-amber-700" : "text-muted-foreground"}`}>
                        {p.credit_notes_total > 0 ? `- Rs. ${fmt(p.credit_notes_total)}` : "—"}
                      </td>
                      <td className="text-right font-semibold">Rs. {fmt(p.net_payable ?? p.total_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-sm text-muted-foreground">No purchases yet.</p>}
        </CardContent>
      </Card>

      {/* Supplier Credit Notes */}
      <Card className="border shadow-sm">
        <CardContent className="p-5">
          <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4 flex items-center gap-2">
            <RotateCcw size={14} /> Credit Notes (Returns to Supplier)
          </h3>
          {supplier.credit_notes?.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="data-table w-full">
                <thead><tr>
                  <th>Credit Note #</th>
                  <th>Linked Purchase</th>
                  <th>Items</th>
                  <th className="text-right">Sales Amt</th>
                  <th className="text-right">Cost Adjusted</th>
                  <th>Date</th>
                </tr></thead>
                <tbody>
                  {supplier.credit_notes.map(cn => (
                    <tr key={cn.id} data-testid={`sup-cn-row-${cn.id}`}>
                      <td className="font-medium text-amber-700">{cn.credit_note_number || cn.return_number}</td>
                      <td>{cn.purchase_number || cn.adjusted_purchase_number || "-"}</td>
                      <td>{cn.items?.length || 0}</td>
                      <td className="text-right">Rs. {fmt(cn.total_amount)}</td>
                      <td className="text-right font-medium">Rs. {fmt(cn.adjusted_amount || 0)}</td>
                      <td className="text-muted-foreground">{cn.created_at?.slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-sm text-muted-foreground">No credit notes issued.</p>}
        </CardContent>
      </Card>

      {/* Payments */}
      <Card className="border shadow-sm">
        <CardContent className="p-5">
          <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4 flex items-center gap-2"><CreditCard size={14} /> Payments</h3>
          {supplier.payments?.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="data-table w-full">
                <thead><tr><th>Amount</th><th>Method</th><th>Notes</th><th>Date</th></tr></thead>
                <tbody>
                  {supplier.payments.map(p => (
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
    </div>
  );
}
