import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import API from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SearchableSelect } from "@/components/SearchableSelect";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Printer, FileText, Settings as SettingsIcon } from "lucide-react";
import { printHtml, escapeHtml, fmtRs } from "@/lib/printer";

const fmt = (n) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

export default function ReportsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(searchParams.get("tab") || "customer");
  const [customers, setCustomers] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [customerReport, setCustomerReport] = useState(null);
  const [globalReport, setGlobalReport] = useState(null);
  const [supplierReport, setSupplierReport] = useState(null);
  const [loading, setLoading] = useState(false);

  // Per-supplier outstanding
  const [selectedSupplierId, setSelectedSupplierId] = useState(searchParams.get("id") || "");
  const [supplierOutReport, setSupplierOutReport] = useState(null);

  const [custPayFrom, setCustPayFrom] = useState(daysAgo(30));
  const [custPayTo, setCustPayTo] = useState(today());
  const [custPayReport, setCustPayReport] = useState(null);
  const [supPayFrom, setSupPayFrom] = useState(daysAgo(30));
  const [supPayTo, setSupPayTo] = useState(today());
  const [supPayReport, setSupPayReport] = useState(null);

  const [finFrom, setFinFrom] = useState(daysAgo(30));
  const [finTo, setFinTo] = useState(today());
  const [finReport, setFinReport] = useState(null);

  const [counters, setCounters] = useState({});
  const [counterValues, setCounterValues] = useState({});

  useEffect(() => {
    API.get("/customers").then(r => setCustomers(r.data)).catch(console.error);
    API.get("/suppliers").then(r => setSuppliers(r.data)).catch(console.error);
  }, []);

  const loadCounters = useCallback(async () => {
    try {
      const { data } = await API.get("/settings/counters");
      setCounters(data); setCounterValues(data);
    } catch (err) { console.error(err); }
  }, []);
  useEffect(() => { if (tab === "settings") loadCounters(); }, [tab, loadCounters]);

  const customerOptions = customers.map(c => ({ value: c.id, label: `${c.name}${c.shop_name ? ` (${c.shop_name})` : ""}` }));
  const supplierOptions = suppliers.map(s => ({ value: s.id, label: s.name }));

  const fetchCustomerReport = async (cid) => {
    setLoading(true);
    try { const { data } = await API.get(`/reports/customer-outstanding/${cid}`); setCustomerReport(data); }
    catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const fetchGlobalReport = async () => {
    setLoading(true);
    try { const { data } = await API.get("/reports/global-outstanding"); setGlobalReport(data); }
    catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const fetchSupplierReport = async () => {
    setLoading(true);
    try { const { data } = await API.get("/reports/supplier-payable"); setSupplierReport(data); }
    catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const fetchSupplierOutstanding = async (sid) => {
    setLoading(true);
    try { const { data } = await API.get(`/reports/supplier-outstanding/${sid}`); setSupplierOutReport(data); }
    catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  // Auto-fetch when arriving via /reports?tab=supplier-out&id=...
  useEffect(() => {
    if (tab === "supplier-out" && selectedSupplierId) fetchSupplierOutstanding(selectedSupplierId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchCustomerPayments = async () => {
    setLoading(true);
    try { const { data } = await API.get("/reports/customer-payments", { params: { date_from: custPayFrom, date_to: custPayTo } }); setCustPayReport(data); }
    catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const fetchSupplierPayments = async () => {
    setLoading(true);
    try { const { data } = await API.get("/reports/supplier-payments", { params: { date_from: supPayFrom, date_to: supPayTo } }); setSupPayReport(data); }
    catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const fetchFinancialSummary = async () => {
    setLoading(true);
    try { const { data } = await API.get("/reports/financial-summary", { params: { date_from: finFrom, date_to: finTo } }); setFinReport(data); }
    catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  // ── Print helpers ─────────────────────────────────────────────────
  const printCustomerOutstanding = () => {
    if (!customerReport) return;
    const rows = customerReport.items.map((item, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td>${escapeHtml(item.invoice_number)}</td>
        <td>${escapeHtml(item.date)}</td>
        <td class="right">${fmtRs(item.total_amount)}</td>
        <td class="right">${fmtRs(item.paid)}</td>
        <td class="right">${fmtRs(item.returned)}</td>
        <td class="right"><strong>${fmtRs(item.balance)}</strong></td>
      </tr>`).join("");

    // Annexure pages: each credit note on its own
    const annexure = (customerReport.credit_notes || []).map((cn, i) => {
      const itRows = (cn.items || []).map((it, j) => `
        <tr>
          <td>${j + 1}</td>
          <td>${escapeHtml(it.product_name)}</td>
          <td class="right">${it.quantity}</td>
          <td class="right">${fmtRs(it.unit_price)}</td>
          <td class="right"><strong>${fmtRs(it.amount)}</strong></td>
        </tr>`).join("");
      return `
        <div class="annexure" style="page-break-before: always;">
          <h2>Annexure ${i + 1}: Credit Note ${escapeHtml(cn.credit_note_number)}</h2>
          <div class="meta">Against Invoice ${escapeHtml(cn.invoice_number || "-")} · Date ${escapeHtml(cn.date)} · Total ${fmtRs(cn.total_amount)}</div>
          <table>
            <thead><tr><th style="width:30px">#</th><th>Item</th><th class="right">Qty</th><th class="right">Unit Price</th><th class="right">Credit</th></tr></thead>
            <tbody>${itRows || `<tr><td colspan="5" class="center">No items.</td></tr>`}</tbody>
          </table>
          ${cn.notes ? `<p style="font-size:11px;color:#475569;"><strong>Notes:</strong> ${escapeHtml(cn.notes)}</p>` : ""}
        </div>`;
    }).join("");

    const body = `
      <h1>Commercial Trading</h1>
      <h2>Customer Outstanding Statement</h2>
      <div class="meta">Generated: ${new Date().toLocaleString()}</div>
      <div class="entity">
        <div><strong>${escapeHtml(customerReport.customer_shop || customerReport.customer_name)}</strong></div>
        ${customerReport.customer_name && customerReport.customer_shop ? `<div>${escapeHtml(customerReport.customer_name)}</div>` : ""}
        ${customerReport.customer_phone ? `<div>${escapeHtml(customerReport.customer_phone)}</div>` : ""}
      </div>
      <table>
        <thead><tr><th style="width:30px">#</th><th>Invoice</th><th>Date</th><th class="right">Amount</th><th class="right">Paid</th><th class="right">Returns</th><th class="right">Balance</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="7" class="center">No outstanding invoices.</td></tr>`}</tbody>
      </table>
      <div class="totals"><span class="label">Total Outstanding</span><span class="value">${fmtRs(customerReport.total_outstanding)}</span></div>
      ${customerReport.credit_notes_total > 0
        ? `<div class="totals" style="border-top:none;padding-top:0;color:#b45309;"><span class="label">Credit Notes Issued</span><span class="value">${fmtRs(customerReport.credit_notes_total)}</span></div>`
        : ""}
      <div class="footer">— End of statement. Credit note annexures follow. —</div>
      ${annexure}
    `;
    printHtml(`Customer Outstanding - ${customerReport.customer_shop || customerReport.customer_name}`, body);
  };

  const printSupplierOutstanding = () => {
    if (!supplierOutReport) return;
    const rows = supplierOutReport.purchases.map((it, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td>${escapeHtml(it.purchase_number)}</td>
        <td>${escapeHtml(it.supplier_invoice_number || "-")}</td>
        <td>${escapeHtml(it.date)}</td>
        <td class="right">${fmtRs(it.amount)}</td>
        <td class="right">${fmtRs(it.credit_notes)}</td>
        <td class="right">${fmtRs(it.paid)}</td>
        <td class="right"><strong>${fmtRs(it.balance)}</strong></td>
      </tr>`).join("");

    const annexure = (supplierOutReport.credit_notes || []).map((cn, i) => {
      const itRows = (cn.items || []).map((it, j) => `
        <tr>
          <td>${j + 1}</td>
          <td>${escapeHtml(it.product_name || "")}</td>
          <td class="right">${it.quantity}</td>
          <td class="right">${fmtRs(it.unit_price || 0)}</td>
          <td class="right"><strong>${fmtRs(it.amount || 0)}</strong></td>
        </tr>`).join("");
      return `
        <div class="annexure" style="page-break-before: always;">
          <h2>Annexure ${i + 1}: Supplier Credit Note ${escapeHtml(cn.credit_note_number)}</h2>
          <div class="meta">Linked Purchase ${escapeHtml(cn.purchase_number || "-")} · Date ${escapeHtml(cn.date)} · Total ${fmtRs(cn.total_amount)}</div>
          <table>
            <thead><tr><th style="width:30px">#</th><th>Item</th><th class="right">Qty</th><th class="right">Unit Price</th><th class="right">Amount</th></tr></thead>
            <tbody>${itRows || `<tr><td colspan="5" class="center">No items.</td></tr>`}</tbody>
          </table>
          ${cn.notes ? `<p style="font-size:11px;color:#475569;"><strong>Notes:</strong> ${escapeHtml(cn.notes)}</p>` : ""}
        </div>`;
    }).join("");

    const body = `
      <h1>Commercial Trading</h1>
      <h2>Supplier Outstanding Statement</h2>
      <div class="meta">Generated: ${new Date().toLocaleString()}</div>
      <div class="entity">
        <div><strong>${escapeHtml(supplierOutReport.supplier_name)}</strong></div>
        ${supplierOutReport.supplier_phone ? `<div>${escapeHtml(supplierOutReport.supplier_phone)}</div>` : ""}
      </div>
      <table>
        <thead><tr><th style="width:30px">#</th><th>Purchase</th><th>Sup Inv</th><th>Date</th><th class="right">Original</th><th class="right">Credit Notes</th><th class="right">Paid</th><th class="right">Balance</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="8" class="center">No outstanding purchases.</td></tr>`}</tbody>
      </table>
      <div class="totals"><span class="label">Total Payable</span><span class="value">${fmtRs(supplierOutReport.total_payable)}</span></div>
      ${supplierOutReport.credit_notes_total > 0
        ? `<div class="totals" style="border-top:none;padding-top:0;color:#b45309;"><span class="label">Credit Notes Issued</span><span class="value">${fmtRs(supplierOutReport.credit_notes_total)}</span></div>`
        : ""}
      <div class="footer">— End of statement. Credit note annexures follow. —</div>
      ${annexure}
    `;
    printHtml(`Supplier Outstanding - ${supplierOutReport.supplier_name}`, body);
  };

  const printGlobalOutstanding = () => {
    if (!globalReport) return;
    const blocks = globalReport.items.map((c, idx) => {
      const rows = c.invoices.map(i => `
        <tr>
          <td>${escapeHtml(i.invoice_number)}</td>
          <td>${escapeHtml(i.date)}</td>
          <td>${escapeHtml(i.status)}</td>
          <td class="right">${fmtRs(i.amount)}</td>
        </tr>`).join("");
      return `
        <div class="entity">
          <div class="entity-head"><span class="name">${idx + 1}. ${escapeHtml(c.customer_shop || c.customer_name)}</span><span class="amt">${fmtRs(c.outstanding)}</span></div>
          ${rows ? `<table><thead><tr><th>Invoice</th><th>Date</th><th>Status</th><th class="right">Amount</th></tr></thead><tbody>${rows}</tbody></table>` : ""}
        </div>`;
    }).join("");
    const body = `
      <h1>Commercial Trading</h1>
      <h2>Global Outstanding Report</h2>
      <div class="meta">Generated: ${new Date().toLocaleString()}</div>
      ${blocks || `<p class="center">No outstanding balances.</p>`}
      <div class="totals"><span class="label">Grand Total</span><span class="value">${fmtRs(globalReport.grand_total)}</span></div>
    `;
    printHtml("Global Outstanding", body);
  };

  const printSupplierPayable = () => {
    if (!supplierReport) return;
    const blocks = supplierReport.items.map((s, idx) => {
      const rows = s.purchases.map(p => `
        <tr>
          <td>${escapeHtml(p.purchase_number)}</td>
          <td>${escapeHtml(p.supplier_invoice_number || "-")}</td>
          <td>${escapeHtml(p.date)}</td>
          <td class="right">${fmtRs(p.amount)}</td>
          <td class="right">${fmtRs(p.credit_notes || 0)}</td>
          <td class="right">${fmtRs(p.net_amount || p.amount)}</td>
        </tr>`).join("");
      return `
        <div class="entity">
          <div class="entity-head"><span class="name">${idx + 1}. ${escapeHtml(s.supplier_name)}</span><span class="amt">${fmtRs(s.payable)}</span></div>
          ${rows ? `<table><thead><tr><th>Purchase</th><th>Sup Inv</th><th>Date</th><th class="right">Original</th><th class="right">Credit Notes</th><th class="right">Net</th></tr></thead><tbody>${rows}</tbody></table>` : ""}
        </div>`;
    }).join("");
    const body = `
      <h1>Commercial Trading</h1>
      <h2>Supplier Payable Report</h2>
      <div class="meta">Generated: ${new Date().toLocaleString()}</div>
      ${blocks || `<p class="center">No outstanding payables.</p>`}
      <div class="totals"><span class="label">Grand Total</span><span class="value">${fmtRs(supplierReport.grand_total)}</span></div>
    `;
    printHtml("Supplier Payable", body);
  };

  const printPaymentsReport = (report, kind) => {
    if (!report) return;
    const entityLabel = kind === "customer" ? "Customer" : "Supplier";
    const rows = report.items.map((p, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td>${escapeHtml(p.date)}</td>
        <td>${escapeHtml(kind === "customer" ? p.customer_name : p.supplier_name)}</td>
        <td class="right">${fmtRs(p.amount)}</td>
        <td>${escapeHtml(p.payment_method)}</td>
        <td>${escapeHtml(
          p.payment_method === "cheque"
            ? (p.cheques && p.cheques.length > 0
                ? p.cheques.map(c => `#${c.cheque_number}${c.bank_name ? " / " + c.bank_name : ""}`).join(", ")
                : `#${p.cheque_number}${p.bank_name ? " / " + p.bank_name : ""}`)
            : (p.notes || "")
        )}</td>
      </tr>`).join("");
    const body = `
      <h1>Commercial Trading</h1>
      <h2>${entityLabel} Payments Report</h2>
      <div class="meta">Period: ${escapeHtml(report.date_from || "-")} to ${escapeHtml(report.date_to || "-")} · Generated: ${new Date().toLocaleString()}</div>
      <table>
        <thead><tr><th style="width:30px">#</th><th>Date</th><th>${entityLabel}</th><th class="right">Amount</th><th>Method</th><th>Details</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="6" class="center">No payments in this period.</td></tr>`}</tbody>
      </table>
      <div class="totals"><span class="label">Total ${report.count} Payments</span><span class="value">${fmtRs(report.total)}</span></div>
    `;
    printHtml(`${entityLabel} Payments`, body);
  };

  const printFinancialSummary = () => {
    if (!finReport) return;
    const body = `
      <h1>Commercial Trading</h1>
      <h2>Financial Summary</h2>
      <div class="meta">Period: ${escapeHtml(finReport.date_from || "-")} to ${escapeHtml(finReport.date_to || "-")} · Generated: ${new Date().toLocaleString()}</div>
      <table>
        <tbody>
          <tr><td>Total Sales (Invoices)</td><td class="right"><strong>${fmtRs(finReport.total_sales)}</strong></td></tr>
          <tr><td>Total Cost (Goods Sold)</td><td class="right">${fmtRs(finReport.total_cost)}</td></tr>
          <tr><td><strong>Total Profit</strong></td><td class="right"><strong>${fmtRs(finReport.total_profit)}</strong></td></tr>
          <tr><td>Total Purchases (Supplier Bills)</td><td class="right">${fmtRs(finReport.total_purchases)}</td></tr>
          <tr><td>Supplier Credit Notes</td><td class="right">${fmtRs(finReport.total_credit_notes || 0)}</td></tr>
          <tr><td>Total Supplier Paid</td><td class="right">${fmtRs(finReport.total_supplier_paid)}</td></tr>
          <tr><td><strong>Total Payables</strong></td><td class="right"><strong>${fmtRs(finReport.total_payables)}</strong></td></tr>
          <tr><td>Invoices Issued</td><td class="right">${finReport.invoice_count}</td></tr>
          <tr><td>Customers Involved</td><td class="right">${finReport.customer_count}</td></tr>
        </tbody>
      </table>
    `;
    printHtml("Financial Summary", body);
  };

  const saveCounter = async (name) => {
    try {
      const val = parseInt(counterValues[name], 10);
      if (isNaN(val) || val < 0) { toast.error("Invalid value"); return; }
      const { data } = await API.put(`/settings/counters/${name}`, { value: val });
      toast.success(`${name} counter set to ${data.value} (next = ${data.next})`);
      loadCounters();
    } catch (err) { toast.error(err.response?.data?.detail || "Failed"); }
  };

  return (
    <div className="space-y-6" data-testid="reports-page">
      <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight" style={{ fontFamily: 'Outfit, sans-serif' }}>Reports</h1>

      <Tabs value={tab} onValueChange={(v) => { setTab(v); setSearchParams({ tab: v }); }}>
        <TabsList className="bg-muted flex-wrap h-auto">
          <TabsTrigger value="customer" data-testid="customer-report-tab">Customer Outstanding</TabsTrigger>
          <TabsTrigger value="global" data-testid="global-report-tab">Global Outstanding</TabsTrigger>
          <TabsTrigger value="supplier" data-testid="supplier-report-tab">Supplier Payable</TabsTrigger>
          <TabsTrigger value="supplier-out" data-testid="supplier-out-tab">Supplier Outstanding</TabsTrigger>
          <TabsTrigger value="customer-pay" data-testid="customer-pay-report-tab">Customer Payments</TabsTrigger>
          <TabsTrigger value="supplier-pay" data-testid="supplier-pay-report-tab">Supplier Payments</TabsTrigger>
          <TabsTrigger value="financial" data-testid="financial-summary-tab">Financial Summary</TabsTrigger>
          <TabsTrigger value="settings" data-testid="settings-tab">Bill Numbering</TabsTrigger>
        </TabsList>

        {/* Customer Outstanding */}
        <TabsContent value="customer" className="mt-4 space-y-4">
          <div className="flex gap-3 items-end flex-wrap">
            <div className="w-72">
              <SearchableSelect options={customerOptions} value={selectedCustomerId} onSelect={(id) => { setSelectedCustomerId(id); fetchCustomerReport(id); }} placeholder="Select customer..." />
            </div>
            <Button variant="outline" size="sm" className="rounded-sm" onClick={printCustomerOutstanding} disabled={!customerReport} data-testid="print-customer-outstanding"><Printer size={14} className="mr-1" /> Print</Button>
          </div>

          {loading ? <div className="text-muted-foreground text-sm">Loading...</div> : customerReport && (
            <Card className="border shadow-sm">
              <CardContent className="p-6">
                <div className="mb-4">
                  <p className="font-medium">{customerReport.customer_shop || customerReport.customer_name}</p>
                  {customerReport.customer_phone && <p className="text-sm text-muted-foreground">{customerReport.customer_phone}</p>}
                </div>
                <Separator className="mb-4" />
                {customerReport.items.length > 0 ? (
                  <table className="w-full text-sm">
                    <thead><tr className="border-b-2 border-[#0F172A]">
                      <th className="text-left py-2 text-xs font-bold uppercase">#</th>
                      <th className="text-left py-2 text-xs font-bold uppercase">Invoice</th>
                      <th className="text-left py-2 text-xs font-bold uppercase">Date</th>
                      <th className="text-right py-2 text-xs font-bold uppercase">Amount</th>
                      <th className="text-right py-2 text-xs font-bold uppercase">Paid</th>
                      <th className="text-right py-2 text-xs font-bold uppercase">Returns</th>
                      <th className="text-right py-2 text-xs font-bold uppercase">Balance</th>
                    </tr></thead>
                    <tbody>
                      {customerReport.items.map((item, idx) => (
                        <tr key={item.invoice_id} className="border-b">
                          <td className="py-2">{idx + 1}</td>
                          <td>{item.invoice_number}</td>
                          <td>{item.date}</td>
                          <td className="text-right">Rs. {fmt(item.total_amount)}</td>
                          <td className="text-right">Rs. {fmt(item.paid)}</td>
                          <td className="text-right text-amber-700">Rs. {fmt(item.returned)}</td>
                          <td className="text-right font-semibold">Rs. {fmt(item.balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : <p className="text-sm text-muted-foreground">No outstanding invoices.</p>}
                <Separator className="my-4" />
                <div className="flex justify-between flex-wrap gap-4">
                  {customerReport.credit_notes_total > 0 && (
                    <div className="text-sm text-amber-700">Credit Notes Issued: <strong>Rs. {fmt(customerReport.credit_notes_total)}</strong> ({customerReport.credit_notes.length})</div>
                  )}
                  <div className="text-lg font-semibold ml-auto" style={{ fontFamily: 'Outfit, sans-serif' }}>Total Outstanding: Rs. {fmt(customerReport.total_outstanding)}</div>
                </div>

                {customerReport.credit_notes?.length > 0 && (
                  <div className="mt-6">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3">Credit Notes (Annexure)</h3>
                    <table className="w-full text-xs">
                      <thead><tr className="border-b">
                        <th className="text-left py-1.5">CN #</th>
                        <th className="text-left py-1.5">Invoice</th>
                        <th className="text-left py-1.5">Date</th>
                        <th className="text-right py-1.5">Total</th>
                      </tr></thead>
                      <tbody>
                        {customerReport.credit_notes.map(cn => (
                          <tr key={cn.credit_note_number} className="border-b" data-testid={`cust-cn-row-${cn.credit_note_number}`}>
                            <td className="py-1.5 font-medium text-amber-700">{cn.credit_note_number}</td>
                            <td>{cn.invoice_number}</td>
                            <td className="text-muted-foreground">{cn.date}</td>
                            <td className="text-right">Rs. {fmt(cn.total_amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Global Outstanding */}
        <TabsContent value="global" className="mt-4 space-y-4">
          <div className="flex gap-3">
            <Button onClick={fetchGlobalReport} className="bg-[#0F172A] hover:bg-[#1E293B] rounded-sm gap-2" data-testid="generate-global-report"><FileText size={14} /> Generate Report</Button>
            <Button variant="outline" size="sm" className="rounded-sm" onClick={printGlobalOutstanding} disabled={!globalReport} data-testid="print-global-outstanding"><Printer size={14} className="mr-1" /> Print</Button>
          </div>
          {loading ? <div className="text-muted-foreground text-sm">Loading...</div> : globalReport && (
            <Card className="border shadow-sm">
              <CardContent className="p-6">
                {globalReport.items.map((c, idx) => (
                  <div key={c.customer_id} className="mb-6">
                    <div className="flex items-center justify-between mb-2"><span className="font-medium">{idx + 1}. {c.customer_shop || c.customer_name}</span><span className="font-semibold text-amber-600">Rs. {fmt(c.outstanding)}</span></div>
                    {c.invoices.length > 0 && (
                      <table className="w-full text-xs ml-4 mb-2"><tbody>
                        {c.invoices.map(i => (<tr key={i.invoice_number} className="border-b border-dashed"><td className="py-1">{i.invoice_number}</td><td className="py-1">{i.date}</td><td className="py-1 text-right">Rs. {fmt(i.amount)}</td><td className="py-1"><Badge variant="secondary" className="text-[10px] rounded-full">{i.status}</Badge></td></tr>))}
                      </tbody></table>
                    )}
                  </div>
                ))}
                <Separator className="my-4" />
                <div className="flex justify-end"><div className="text-lg font-semibold" style={{ fontFamily: 'Outfit, sans-serif' }}>Grand Total: Rs. {fmt(globalReport.grand_total)}</div></div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Supplier Payable (Global) */}
        <TabsContent value="supplier" className="mt-4 space-y-4">
          <div className="flex gap-3">
            <Button onClick={fetchSupplierReport} className="bg-[#0F172A] hover:bg-[#1E293B] rounded-sm gap-2" data-testid="generate-supplier-report"><FileText size={14} /> Generate Report</Button>
            <Button variant="outline" size="sm" className="rounded-sm" onClick={printSupplierPayable} disabled={!supplierReport} data-testid="print-supplier-payable"><Printer size={14} className="mr-1" /> Print</Button>
          </div>
          {loading ? <div className="text-muted-foreground text-sm">Loading...</div> : supplierReport && (
            <Card className="border shadow-sm">
              <CardContent className="p-6">
                {supplierReport.items.map((s, idx) => (
                  <div key={s.supplier_id} className="mb-6">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium">{idx + 1}. {s.supplier_name}</span>
                      <span className="font-semibold text-red-600">Rs. {fmt(s.payable)}</span>
                    </div>
                    {s.purchases.length > 0 && (
                      <table className="w-full text-xs ml-4 mb-2"><tbody>
                        {s.purchases.map(p => (
                          <tr key={p.purchase_number} className="border-b border-dashed">
                            <td className="py-1">{p.purchase_number}</td>
                            <td className="py-1 text-muted-foreground">{p.supplier_invoice_number || p.order || "-"}</td>
                            <td className="py-1">{p.date}</td>
                            <td className="py-1 text-right">Rs. {fmt(p.amount)}</td>
                            {(p.credit_notes ?? 0) > 0 && <td className="py-1 text-right text-amber-700">- Rs. {fmt(p.credit_notes)}</td>}
                            <td className="py-1 text-right font-medium">Rs. {fmt(p.net_amount ?? p.amount)}</td>
                          </tr>
                        ))}
                      </tbody></table>
                    )}
                  </div>
                ))}
                <Separator className="my-4" />
                <div className="flex justify-end"><div className="text-lg font-semibold" style={{ fontFamily: 'Outfit, sans-serif' }}>Grand Total: Rs. {fmt(supplierReport.grand_total)}</div></div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Supplier Outstanding (per supplier) */}
        <TabsContent value="supplier-out" className="mt-4 space-y-4">
          <div className="flex gap-3 items-end flex-wrap">
            <div className="w-72">
              <SearchableSelect options={supplierOptions} value={selectedSupplierId} onSelect={(id) => { setSelectedSupplierId(id); fetchSupplierOutstanding(id); }} placeholder="Select supplier..." />
            </div>
            <Button variant="outline" size="sm" className="rounded-sm" onClick={printSupplierOutstanding} disabled={!supplierOutReport} data-testid="print-supplier-outstanding"><Printer size={14} className="mr-1" /> Print</Button>
          </div>

          {loading ? <div className="text-muted-foreground text-sm">Loading...</div> : supplierOutReport && (
            <Card className="border shadow-sm">
              <CardContent className="p-6">
                <div className="mb-4">
                  <p className="font-medium">{supplierOutReport.supplier_name}</p>
                  {supplierOutReport.supplier_phone && <p className="text-sm text-muted-foreground">{supplierOutReport.supplier_phone}</p>}
                </div>
                <Separator className="mb-4" />
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                  <div><p className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">Total Purchases</p><p className="font-semibold">Rs. {fmt(supplierOutReport.purchase_total)}</p></div>
                  <div><p className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">Credit Notes</p><p className="font-semibold text-amber-600">Rs. {fmt(supplierOutReport.credit_notes_total)}</p></div>
                  <div><p className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">Paid (Allocated)</p><p className="font-semibold">Rs. {fmt(supplierOutReport.paid_total)}</p></div>
                  <div><p className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">Net Payable</p><p className="font-semibold text-red-600">Rs. {fmt(supplierOutReport.total_payable)}</p></div>
                </div>
                {supplierOutReport.purchases.length > 0 ? (
                  <table className="w-full text-sm" data-testid="supplier-out-table">
                    <thead><tr className="border-b-2 border-[#0F172A]">
                      <th className="text-left py-2 text-xs font-bold uppercase">#</th>
                      <th className="text-left py-2 text-xs font-bold uppercase">Purchase</th>
                      <th className="text-left py-2 text-xs font-bold uppercase">Sup Inv</th>
                      <th className="text-left py-2 text-xs font-bold uppercase">Date</th>
                      <th className="text-right py-2 text-xs font-bold uppercase">Original</th>
                      <th className="text-right py-2 text-xs font-bold uppercase">Credit Notes</th>
                      <th className="text-right py-2 text-xs font-bold uppercase">Paid</th>
                      <th className="text-right py-2 text-xs font-bold uppercase">Balance</th>
                    </tr></thead>
                    <tbody>
                      {supplierOutReport.purchases.map((it, idx) => (
                        <tr key={it.purchase_id} className="border-b">
                          <td className="py-2">{idx + 1}</td>
                          <td>{it.purchase_number}</td>
                          <td className="text-muted-foreground">{it.supplier_invoice_number || "-"}</td>
                          <td>{it.date}</td>
                          <td className="text-right">Rs. {fmt(it.amount)}</td>
                          <td className="text-right text-amber-700">{it.credit_notes > 0 ? `- Rs. ${fmt(it.credit_notes)}` : "—"}</td>
                          <td className="text-right">Rs. {fmt(it.paid)}</td>
                          <td className="text-right font-semibold">Rs. {fmt(it.balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : <p className="text-sm text-muted-foreground">No purchases.</p>}

                {supplierOutReport.credit_notes?.length > 0 && (
                  <div className="mt-6">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3">Credit Notes (Annexure)</h3>
                    <table className="w-full text-xs">
                      <thead><tr className="border-b">
                        <th className="text-left py-1.5">CN #</th>
                        <th className="text-left py-1.5">Linked Purchase</th>
                        <th className="text-left py-1.5">Date</th>
                        <th className="text-right py-1.5">Sales Amt</th>
                        <th className="text-right py-1.5">Cost Adjusted</th>
                      </tr></thead>
                      <tbody>
                        {supplierOutReport.credit_notes.map((cn, i) => (
                          <tr key={i} className="border-b">
                            <td className="py-1.5 font-medium text-amber-700">{cn.credit_note_number}</td>
                            <td>{cn.purchase_number || "-"}</td>
                            <td className="text-muted-foreground">{cn.date}</td>
                            <td className="text-right">Rs. {fmt(cn.total_amount)}</td>
                            <td className="text-right">Rs. {fmt(cn.adjusted_amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Customer Payments */}
        <TabsContent value="customer-pay" className="mt-4 space-y-4">
          <div className="flex gap-3 flex-wrap items-end">
            <div><Label className="text-xs">From</Label><Input type="date" value={custPayFrom} onChange={e => setCustPayFrom(e.target.value)} data-testid="cust-pay-from" /></div>
            <div><Label className="text-xs">To</Label><Input type="date" value={custPayTo} onChange={e => setCustPayTo(e.target.value)} data-testid="cust-pay-to" /></div>
            <Button onClick={fetchCustomerPayments} className="bg-[#0F172A] hover:bg-[#1E293B] rounded-sm gap-2" data-testid="generate-cust-pay"><FileText size={14} /> Generate</Button>
            <Button variant="outline" size="sm" className="rounded-sm" onClick={() => printPaymentsReport(custPayReport, "customer")} disabled={!custPayReport} data-testid="print-cust-pay"><Printer size={14} className="mr-1" /> Print</Button>
          </div>
          {custPayReport && (
            <Card className="border shadow-sm">
              <CardContent className="p-6">
                <p className="text-sm text-muted-foreground mb-3">{custPayReport.date_from} → {custPayReport.date_to} · {custPayReport.count} payments · Total: <strong>Rs. {fmt(custPayReport.total)}</strong></p>
                <table className="w-full text-sm">
                  <thead><tr className="border-b-2 border-[#0F172A]">
                    <th className="text-left py-2 text-xs font-bold uppercase">Date</th>
                    <th className="text-left py-2 text-xs font-bold uppercase">Customer</th>
                    <th className="text-right py-2 text-xs font-bold uppercase">Amount</th>
                    <th className="text-left py-2 text-xs font-bold uppercase">Method</th>
                  </tr></thead>
                  <tbody>
                    {custPayReport.items.map(p => (
                      <tr key={p.id} className="border-b">
                        <td className="py-2">{p.date}</td>
                        <td>{p.customer_name}</td>
                        <td className="text-right font-medium">Rs. {fmt(p.amount)}</td>
                        <td><Badge variant="secondary" className="text-xs rounded-full">{p.payment_method}</Badge>{p.payment_method === "cheque" && p.cheques?.length > 1 && <span className="text-[10px] text-muted-foreground ml-2">({p.cheques.length} cheques)</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Supplier Payments */}
        <TabsContent value="supplier-pay" className="mt-4 space-y-4">
          <div className="flex gap-3 flex-wrap items-end">
            <div><Label className="text-xs">From</Label><Input type="date" value={supPayFrom} onChange={e => setSupPayFrom(e.target.value)} data-testid="sup-pay-from" /></div>
            <div><Label className="text-xs">To</Label><Input type="date" value={supPayTo} onChange={e => setSupPayTo(e.target.value)} data-testid="sup-pay-to" /></div>
            <Button onClick={fetchSupplierPayments} className="bg-[#0F172A] hover:bg-[#1E293B] rounded-sm gap-2" data-testid="generate-sup-pay"><FileText size={14} /> Generate</Button>
            <Button variant="outline" size="sm" className="rounded-sm" onClick={() => printPaymentsReport(supPayReport, "supplier")} disabled={!supPayReport} data-testid="print-sup-pay"><Printer size={14} className="mr-1" /> Print</Button>
          </div>
          {supPayReport && (
            <Card className="border shadow-sm">
              <CardContent className="p-6">
                <p className="text-sm text-muted-foreground mb-3">{supPayReport.date_from} → {supPayReport.date_to} · {supPayReport.count} payments · Total: <strong>Rs. {fmt(supPayReport.total)}</strong></p>
                <table className="w-full text-sm">
                  <thead><tr className="border-b-2 border-[#0F172A]">
                    <th className="text-left py-2 text-xs font-bold uppercase">Date</th>
                    <th className="text-left py-2 text-xs font-bold uppercase">Supplier</th>
                    <th className="text-right py-2 text-xs font-bold uppercase">Amount</th>
                    <th className="text-left py-2 text-xs font-bold uppercase">Method</th>
                  </tr></thead>
                  <tbody>
                    {supPayReport.items.map(p => (
                      <tr key={p.id} className="border-b">
                        <td className="py-2">{p.date}</td>
                        <td>{p.supplier_name}</td>
                        <td className="text-right font-medium">Rs. {fmt(p.amount)}</td>
                        <td><Badge variant="secondary" className="text-xs rounded-full">{p.payment_method}</Badge>{p.payment_method === "cheque" && p.cheques?.length > 1 && <span className="text-[10px] text-muted-foreground ml-2">({p.cheques.length} cheques)</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Financial Summary */}
        <TabsContent value="financial" className="mt-4 space-y-4">
          <div className="flex gap-3 flex-wrap items-end">
            <div><Label className="text-xs">From</Label><Input type="date" value={finFrom} onChange={e => setFinFrom(e.target.value)} data-testid="fin-from" /></div>
            <div><Label className="text-xs">To</Label><Input type="date" value={finTo} onChange={e => setFinTo(e.target.value)} data-testid="fin-to" /></div>
            <Button onClick={fetchFinancialSummary} className="bg-[#0F172A] hover:bg-[#1E293B] rounded-sm gap-2" data-testid="generate-financial"><FileText size={14} /> Generate</Button>
            <Button variant="outline" size="sm" className="rounded-sm" onClick={printFinancialSummary} disabled={!finReport} data-testid="print-financial"><Printer size={14} className="mr-1" /> Print</Button>
          </div>
          {finReport && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                { label: "Total Sales", val: finReport.total_sales, color: "text-blue-700" },
                { label: "Total Profit", val: finReport.total_profit, color: "text-emerald-700" },
                { label: "Total Payables", val: finReport.total_payables, color: "text-red-700" },
                { label: "Supplier Credit Notes", val: finReport.total_credit_notes, color: "text-amber-700" },
                { label: "Total Cost", val: finReport.total_cost, color: "text-gray-700" },
                { label: "Invoices Issued", val: finReport.invoice_count, raw: true, color: "text-gray-700" },
              ].map(m => (
                <Card key={m.label} className="border shadow-sm" data-testid={`fin-metric-${m.label.toLowerCase().replace(/\s+/g, "-")}`}>
                  <CardContent className="p-5">
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">{m.label}</p>
                    <p className={`text-2xl font-semibold ${m.color}`} style={{ fontFamily: 'Outfit, sans-serif' }}>{m.raw ? m.val : `Rs. ${fmt(m.val)}`}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Settings — Counter Configuration */}
        <TabsContent value="settings" className="mt-4 space-y-4">
          <Card className="border shadow-sm">
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center gap-2 mb-3">
                <SettingsIcon size={16} />
                <h3 className="text-sm font-bold uppercase tracking-wider">Bill Numbering</h3>
              </div>
              <p className="text-xs text-muted-foreground">
                Set the current counter value. The next generated number will be <strong>value + 1</strong>.
              </p>
              {["invoices", "purchases", "orders"].map(name => {
                const prefix = name === "invoices" ? "INV-" : name === "purchases" ? "PUR-" : "ORD-";
                return (
                  <div key={name} className="grid grid-cols-[140px_120px_auto_auto] items-end gap-3" data-testid={`counter-row-${name}`}>
                    <div>
                      <Label className="text-xs uppercase">{name}</Label>
                      <div className="text-[11px] text-muted-foreground">Current: {counters[name] ?? 0} · Next: {prefix}{String((counters[name] || 0) + 1).padStart(4, "0")}</div>
                    </div>
                    <Input
                      type="number" min="0"
                      value={counterValues[name] ?? ""}
                      onChange={e => setCounterValues(v => ({ ...v, [name]: e.target.value }))}
                      data-testid={`counter-input-${name}`}
                    />
                    <Button size="sm" className="bg-[#0F172A] hover:bg-[#1E293B] rounded-sm" onClick={() => saveCounter(name)} data-testid={`counter-save-${name}`}>Save</Button>
                    <span className="text-xs text-muted-foreground">Next will be {prefix}{String((parseInt(counterValues[name], 10) || 0) + 1).padStart(4, "0")}</span>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
