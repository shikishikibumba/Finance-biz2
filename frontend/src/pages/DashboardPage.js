import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import API from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Wallet, TrendingUp, ArrowDownRight, ArrowUpRight, ShoppingCart, Plus, FileText, CreditCard, BarChart3 } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

const fmt = (n) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

const STATUS_COLORS = {
  pending: "bg-amber-100 text-amber-800",
  ordered: "bg-blue-100 text-blue-800",
  delivered: "bg-emerald-100 text-emerald-800"
};

export default function DashboardPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    API.get("/dashboard/summary").then(r => setData(r.data)).catch(console.error).finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1,2,3,4].map(i => <Skeleton key={i} className="h-28 rounded-md" />)}
      </div>
      <Skeleton className="h-64 rounded-md" />
    </div>
  );

  const metrics = [
    { label: "Receivables", value: data?.receivables, icon: ArrowDownRight, color: "text-amber-600", bg: "bg-amber-50", onClick: () => navigate("/reports"), testid: "receivables-card" },
    { label: "Payables", value: data?.payables, icon: ArrowUpRight, color: "text-red-600", bg: "bg-red-50", onClick: () => navigate("/reports"), testid: "payables-card" },
    { label: "Total Profit", value: data?.total_profit, icon: Wallet, color: "text-emerald-600", bg: "bg-emerald-50", testid: "total-profit-card" },
    { label: "Monthly Sales", value: data?.monthly_sales, icon: TrendingUp, color: "text-blue-600", bg: "bg-blue-50", testid: "monthly-sales-card" },
  ];

  const quickActions = [
    { label: "New Order", icon: ShoppingCart, to: "/orders?new=1", testid: "quick-new-order" },
    { label: "Record Payment", icon: CreditCard, to: "/payments?new=1", testid: "quick-record-payment" },
    { label: "Analytics", icon: BarChart3, to: "/analytics", testid: "quick-analytics" },
    { label: "Reports", icon: FileText, to: "/reports", testid: "quick-reports" },
  ];

  return (
    <div className="space-y-6" data-testid="dashboard-page">
      <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight" style={{ fontFamily: 'Outfit, sans-serif' }}>
        Commerical Trading
      </h1>

      {/* Quick Actions */}
      <div className="flex gap-2 flex-wrap">
        {quickActions.map(({ label, icon: Icon, to, testid }) => (
          <Button key={label} variant="outline" size="sm" onClick={() => navigate(to)} className="rounded-sm gap-2 h-9" data-testid={testid}>
            <Icon size={14} /> {label}
          </Button>
        ))}
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {metrics.map(({ label, value, icon: Icon, color, bg, onClick, testid }) => (
          <Card key={label} className={`metric-card border shadow-sm ${onClick ? "cursor-pointer hover:shadow-md" : ""}`} onClick={onClick} data-testid={testid}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold uppercase tracking-[0.15em] text-muted-foreground">{label}</span>
                <div className={`w-8 h-8 rounded-md ${bg} flex items-center justify-center`}>
                  <Icon size={16} className={color} />
                </div>
              </div>
              <div className="text-2xl font-semibold tracking-tight" style={{ fontFamily: 'Outfit, sans-serif' }}>
                {"Rs. "}{fmt(value)}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Chart + Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 border shadow-sm">
          <CardContent className="p-5">
            <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4">Sales Trend (30 Days)</h3>
            {data?.sales_trend?.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={data.sales_trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={d => d.slice(5)} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v) => [`Rs. ${fmt(v)}`, "Sales"]} />
                  <Line type="monotone" dataKey="amount" stroke="#F59E0B" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
                No sales data yet. Create some invoices to see the trend.
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border shadow-sm">
          <CardContent className="p-5">
            <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4">Quick Stats</h3>
            <div className="space-y-4">
              {[
                { label: "Total Customers", value: data?.customer_count },
                { label: "Total Suppliers", value: data?.supplier_count },
                { label: "Total Orders", value: data?.order_count },
                { label: "Pending Orders", value: data?.pending_orders },
              ].map(s => (
                <div key={s.label} className="flex items-center justify-between py-2 border-b border-dashed last:border-0">
                  <span className="text-sm text-muted-foreground">{s.label}</span>
                  <span className="text-lg font-semibold" style={{ fontFamily: 'Outfit, sans-serif' }}>{s.value || 0}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Orders */}
      <Card className="border shadow-sm">
        <CardContent className="p-5">
          <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4">Recent Orders</h3>
          {data?.recent_orders?.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="data-table w-full">
                <thead>
                  <tr>
                    <th>Order #</th>
                    <th>Customer</th>
                    <th>Items</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent_orders.map(order => (
                    <tr key={order.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate("/orders")}>
                      <td className="font-medium">{order.order_number}</td>
                      <td>{order.customer_name}</td>
                      <td>{order.items?.length || 0}</td>
                      <td>{"Rs. "}{fmt(order.total_amount)}</td>
                      <td>
                        <Badge variant="secondary" className={`${STATUS_COLORS[order.status]} text-xs rounded-full`}>
                          {order.status}
                        </Badge>
                      </td>
                      <td className="text-muted-foreground">{order.created_at?.slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground text-sm">
              <ShoppingCart size={32} className="mx-auto mb-2 opacity-30" />
              No orders yet. Start by creating your first order.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
