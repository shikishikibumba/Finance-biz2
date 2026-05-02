import { useState, useEffect, useCallback } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import API from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BookOpen, Calendar, ArrowLeft, Printer } from "lucide-react";
import { printHtml, escapeHtml, fmtRs } from "@/lib/printer";

const fmt = (n) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

/**
 * Ledger page — works for both customers and suppliers.
 * Usage: <Route path="ledger/:type/:id" /> where type is "customer" | "supplier".
 */
export default function LedgerPage() {
  const { type = "customer", id } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const [dateFrom, setDateFrom] = useState(search.get("from") || "");
  const [dateTo, setDateTo] = useState(search.get("to") || "");
  const [ledger, setLedger] = useState(null);
  const [loading, setLoading] = useState(true);

  const endpoint = type === "supplier" ? "supplier-ledger" : "customer-ledger";
  const label = type === "supplier" ? "Supplier" : "Customer";

  const fetchLedger = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      const { data } = await API.get(`/reports/${endpoint}/${id}`, { params });
      setLedger(data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [endpoint, id, dateFrom, dateTo]);

  useEffect(() => { fetchLedger(); }, [fetchLedger]);

  const handlePrint = () => {
    if (!ledger) return;
    const rows = [
      `<tr>
        <td>—</td>
        <td><em>Opening</em></td>
        <td></td>
        <td><em>Balance brought forward</em></td>
        <td class="right">—</td>
        <td class="right">—</td>
        <td class="right"><strong>${fmtRs(ledger.opening_balance)}</strong></td>
      </tr>`,
      ...(ledger.entries || []).map(e => `
        <tr>
          <td>${escapeHtml(e.date || "")}</td>
          <td style="text-transform:uppercase;font-size:10px;font-weight:600;">${escapeHtml((e.type || "").replace(/_/g, " "))}</td>
          <td>${escapeHtml(e.ref || "—")}</td>
          <td>${escapeHtml(e.description || "")}</td>
          <td class="right">${e.debit ? fmtRs(e.debit) : "—"}</td>
          <td class="right">${e.credit ? fmtRs(e.credit) : "—"}</td>
          <td class="right"><strong>${fmtRs(e.balance)}</strong></td>
        </tr>`),
      `<tr style="background:#f1f5f9;font-weight:600;">
        <td colspan="4" class="right">Totals</td>
        <td class="right">${fmtRs(totalDebit)}</td>
        <td class="right">${fmtRs(totalCredit)}</td>
        <td class="right">${fmtRs(ledger.closing_balance)}</td>
      </tr>`,
    ].join("");

    const entityName = type === "supplier" ? ledger.supplier_name : ledger.customer_name;
    const body = `
      <h1>Commercial Trading</h1>
      <h2>${label} Ledger</h2>
      <div class="meta">Generated: ${new Date().toLocaleString()}${(dateFrom || dateTo) ? ` · Range: ${escapeHtml(dateFrom || "start")} → ${escapeHtml(dateTo || "today")}` : ""}</div>
      <div class="entity"><strong>${escapeHtml(entityName || "")}</strong></div>
      <table class="ledger-table">
        <thead>
          <tr>
            <th style="width:85px;">Date</th>
            <th style="width:95px;">Type</th>
            <th style="width:120px;">Reference</th>
            <th>Description</th>
            <th class="right" style="width:90px;">Debit</th>
            <th class="right" style="width:90px;">Credit</th>
            <th class="right" style="width:100px;">Balance</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="totals"><span class="label">Closing Balance</span><span class="value">${fmtRs(ledger.closing_balance)}</span></div>
    `;
    printHtml(`${label} Ledger - ${entityName || ""}`, body, { landscape: true });
  };

  if (loading) {
    return <div className="space-y-4"><Skeleton className="h-20" /><Skeleton className="h-72" /></div>;
  }
  if (!ledger || ledger.error) {
    return <div className="p-6 text-muted-foreground">{ledger?.error || "Ledger not available."}</div>;
  }

  const totalDebit = (ledger.entries || []).reduce((s, e) => s + (e.debit || 0), 0);
  const totalCredit = (ledger.entries || []).reduce((s, e) => s + (e.credit || 0), 0);

  const TYPE_COLORS = {
    invoice: "bg-red-50 text-red-700 border border-red-200",
    purchase: "bg-red-50 text-red-700 border border-red-200",
    payment: "bg-emerald-50 text-emerald-700 border border-emerald-200",
    credit_note: "bg-amber-50 text-amber-700 border border-amber-200",
    supplier_return: "bg-amber-50 text-amber-700 border border-amber-200",
  };

  return (
    <div className="space-y-6 print:space-y-3" data-testid={`${type}-ledger-page`}>
      <div className="flex items-center justify-between gap-3 flex-wrap no-print">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-1">
            <ArrowLeft size={14} /> Back
          </Button>
          <div className="flex items-center gap-3">
            <BookOpen size={24} />
            <div>
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight" style={{ fontFamily: 'Outfit, sans-serif' }}>
                {label} Ledger
              </h1>
              <p className="text-sm text-muted-foreground" data-testid="ledger-entity-name">
                {type === "supplier" ? ledger.supplier_name : ledger.customer_name}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          <div>
            <Label className="text-[10px] font-bold uppercase tracking-wider">From</Label>
            <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-9 w-[145px]" data-testid="ledger-from" />
          </div>
          <div>
            <Label className="text-[10px] font-bold uppercase tracking-wider">To</Label>
            <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-9 w-[145px]" data-testid="ledger-to" />
          </div>
          {(dateFrom || dateTo) && (
            <Button variant="outline" size="sm" onClick={() => { setDateFrom(""); setDateTo(""); }} className="h-9">
              Clear
            </Button>
          )}
          <Button onClick={handlePrint} className="bg-[#0F172A] hover:bg-[#1E293B] text-white rounded-sm gap-1 h-9" data-testid="ledger-print">
            <Printer size={14} /> Print
          </Button>
        </div>
      </div>

      <div className="print-only text-center">
        <h1 className="text-2xl font-bold" style={{ fontFamily: 'Outfit, sans-serif' }}>Commercial Trading</h1>
        <h2 className="text-lg font-semibold mt-1">{label} Ledger — {type === "supplier" ? ledger.supplier_name : ledger.customer_name}</h2>
        {(dateFrom || dateTo) && <p className="text-sm text-muted-foreground">Range: {dateFrom || "start"} → {dateTo || "today"}</p>}
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <Card className="border shadow-sm"><CardContent className="p-4">
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Opening</div>
          <div className="text-xl font-semibold mt-1" data-testid="ledger-opening">Rs. {fmt(ledger.opening_balance)}</div>
        </CardContent></Card>
        <Card className="border shadow-sm"><CardContent className="p-4">
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{type === "supplier" ? "Purchases (Credit)" : "Invoices (Debit)"}</div>
          <div className="text-xl font-semibold mt-1 text-red-700">Rs. {fmt(type === "supplier" ? totalCredit : totalDebit)}</div>
        </CardContent></Card>
        <Card className="border shadow-sm"><CardContent className="p-4">
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{type === "supplier" ? "Paid / Returns (Debit)" : "Payments / CN (Credit)"}</div>
          <div className="text-xl font-semibold mt-1 text-emerald-700">Rs. {fmt(type === "supplier" ? totalDebit : totalCredit)}</div>
        </CardContent></Card>
        <Card className="border shadow-sm"><CardContent className="p-4">
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Closing Balance</div>
          <div className="text-xl font-semibold mt-1" data-testid="ledger-closing">Rs. {fmt(ledger.closing_balance)}</div>
        </CardContent></Card>
      </div>

      <Card className="border shadow-sm">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="data-table w-full">
              <thead>
                <tr>
                  <th className="w-28">Date</th>
                  <th className="w-28">Type</th>
                  <th className="w-36">Reference</th>
                  <th>Description</th>
                  <th className="text-right">Debit</th>
                  <th className="text-right">Credit</th>
                  <th className="text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="text-muted-foreground">—</td>
                  <td className="text-muted-foreground text-xs uppercase">Opening</td>
                  <td colSpan="3" className="text-muted-foreground italic">Balance brought forward</td>
                  <td className="text-right font-medium">Rs. {fmt(ledger.opening_balance)}</td>
                </tr>
                {(ledger.entries || []).map((e, idx) => (
                  <tr key={idx} data-testid={`ledger-row-${idx}`}>
                    <td className="text-muted-foreground">{e.date}</td>
                    <td>
                      <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${TYPE_COLORS[e.type] || "bg-muted"}`}>
                        {e.type.replace("_", " ")}
                      </span>
                    </td>
                    <td className="font-medium">{e.ref || "—"}</td>
                    <td className="text-xs">{e.description}</td>
                    <td className="text-right">{e.debit ? `Rs. ${fmt(e.debit)}` : "—"}</td>
                    <td className="text-right">{e.credit ? `Rs. ${fmt(e.credit)}` : "—"}</td>
                    <td className="text-right font-medium">Rs. {fmt(e.balance)}</td>
                  </tr>
                ))}
                <tr className="bg-muted/50 font-semibold">
                  <td colSpan="4" className="text-right">Totals</td>
                  <td className="text-right">Rs. {fmt(totalDebit)}</td>
                  <td className="text-right">Rs. {fmt(totalCredit)}</td>
                  <td className="text-right">Rs. {fmt(ledger.closing_balance)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
