import { useState, useEffect, useCallback } from "react";
import API from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, AreaChart, Area } from "recharts";
import { TrendingUp, DollarSign, Wallet, Calendar } from "lucide-react";

const fmt = (n) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

const PERIODS = [
  { value: "30d", label: "30 Days" },
  { value: "60d", label: "60 Days" },
  { value: "90d", label: "90 Days" },
  { value: "1y", label: "1 Year" },
];

export default function AnalyticsPage() {
  const [period, setPeriod] = useState("30d");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sales, setSales] = useState(null);
  const [profit, setProfit] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = useCustom && (dateFrom || dateTo)
        ? { date_from: dateFrom || undefined, date_to: dateTo || undefined }
        : { period };
      const [s, p] = await Promise.all([
        API.get("/analytics/sales", { params }),
        API.get("/analytics/profit", { params }),
      ]);
      setSales(s.data);
      setProfit(p.data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [period, useCustom, dateFrom, dateTo]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const tickFmt = (v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v);
  const tooltipFmt = (v) => [`Rs. ${fmt(v)}`, ""];
  const dateFmt = (d) => (d || "").slice(5);

  return (
    <div className="space-y-6" data-testid="analytics-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight" style={{ fontFamily: 'Outfit, sans-serif' }}>Analytics</h1>
        <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
          <div className="flex gap-1 bg-muted rounded-sm p-0.5" data-testid="period-selector">
            {PERIODS.map(p => (
              <Button
                key={p.value}
                size="sm"
                variant={!useCustom && period === p.value ? "default" : "ghost"}
                onClick={() => { setUseCustom(false); setPeriod(p.value); }}
                className={`rounded-sm h-8 ${!useCustom && period === p.value ? "bg-[#0F172A] text-white hover:bg-[#1E293B]" : ""}`}
                data-testid={`period-${p.value}`}
              >
                {p.label}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-2 bg-muted rounded-sm p-1">
            <Calendar size={14} className="text-muted-foreground ml-1" />
            <Input type="date" value={dateFrom} onChange={e => { setUseCustom(true); setDateFrom(e.target.value); }} className="h-7 w-[135px] text-xs border-0 bg-transparent" data-testid="analytics-date-from" />
            <span className="text-xs text-muted-foreground">→</span>
            <Input type="date" value={dateTo} onChange={e => { setUseCustom(true); setDateTo(e.target.value); }} className="h-7 w-[135px] text-xs border-0 bg-transparent" data-testid="analytics-date-to" />
            {useCustom && (
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setUseCustom(false); setDateFrom(""); setDateTo(""); }} data-testid="analytics-clear-range">Clear</Button>
            )}
          </div>
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold uppercase tracking-[0.15em] text-muted-foreground">Total Sales</span>
              <div className="w-8 h-8 rounded-md bg-blue-50 flex items-center justify-center"><DollarSign size={16} className="text-blue-600" /></div>
            </div>
            <div className="text-2xl font-semibold tracking-tight" style={{ fontFamily: 'Outfit, sans-serif' }} data-testid="analytics-total-sales">
              Rs. {fmt(sales?.total)}
            </div>
          </CardContent>
        </Card>
        <Card className="border shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold uppercase tracking-[0.15em] text-muted-foreground">Total Profit</span>
              <div className="w-8 h-8 rounded-md bg-emerald-50 flex items-center justify-center"><Wallet size={16} className="text-emerald-600" /></div>
            </div>
            <div className="text-2xl font-semibold tracking-tight" style={{ fontFamily: 'Outfit, sans-serif' }} data-testid="analytics-total-profit">
              Rs. {fmt(profit?.total_profit)}
            </div>
          </CardContent>
        </Card>
        <Card className="border shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold uppercase tracking-[0.15em] text-muted-foreground">Data Points</span>
              <div className="w-8 h-8 rounded-md bg-amber-50 flex items-center justify-center"><TrendingUp size={16} className="text-amber-600" /></div>
            </div>
            <div className="text-2xl font-semibold tracking-tight" style={{ fontFamily: 'Outfit, sans-serif' }} data-testid="analytics-count">
              {sales?.data?.length || 0} days
            </div>
          </CardContent>
        </Card>
      </div>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-72 rounded-md" />
          <Skeleton className="h-72 rounded-md" />
        </div>
      ) : (
        <>
          {/* Sales Trend */}
          <Card className="border shadow-sm">
            <CardContent className="p-5">
              <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4">Sales Trend</h3>
              {sales?.data?.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={sales.data}>
                    <defs>
                      <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#2563eb" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={dateFmt} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={tickFmt} />
                    <Tooltip formatter={tooltipFmt} />
                    <Area type="monotone" dataKey="amount" stroke="#2563eb" strokeWidth={2} fill="url(#salesGrad)" name="Sales" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">No sales data in this period.</div>
              )}
            </CardContent>
          </Card>

          {/* Revenue Trend (Sales + Cost) */}
          <Card className="border shadow-sm">
            <CardContent className="p-5">
              <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4">Revenue vs Cost Trend</h3>
              {profit?.data?.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={profit.data}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={dateFmt} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={tickFmt} />
                    <Tooltip formatter={tooltipFmt} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="sales" stroke="#2563eb" strokeWidth={2} dot={false} name="Sales" />
                    <Line type="monotone" dataKey="cost" stroke="#ef4444" strokeWidth={2} dot={false} name="Cost" />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">No revenue data in this period.</div>
              )}
            </CardContent>
          </Card>

          {/* Profit Trend */}
          <Card className="border shadow-sm">
            <CardContent className="p-5">
              <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4">Profit Trend</h3>
              {profit?.data?.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={profit.data}>
                    <defs>
                      <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={dateFmt} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={tickFmt} />
                    <Tooltip formatter={tooltipFmt} />
                    <Area type="monotone" dataKey="profit" stroke="#10b981" strokeWidth={2} fill="url(#profitGrad)" name="Profit" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">No profit data in this period.</div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
