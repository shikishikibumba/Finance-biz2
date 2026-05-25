/**
 * Print utilities — open a clean dedicated window and let the browser
 * paginate naturally. This avoids dialog/modal CSS conflicts and gives
 * us full control over @page rules, repeating headers, watermarks, etc.
 */

const fmt = (n) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    n || 0
  );

const ITEMS_PER_PAGE = 10;

const escape = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const baseStyles = `
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #0f172a;
    font-family: 'Helvetica Neue', Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .doc { width: 100%; }
  .page { padding: 0 18mm; page-break-after: always; position: relative; }
  .page:last-child { page-break-after: auto; }
  .header { display: flex; justify-content: space-between; align-items: flex-start;
    border-bottom: 2px solid #0f172a; padding-bottom: 8px; margin-bottom: 10px; }
  .brand h1 { margin: 0; font-size: 22px; letter-spacing: -0.3px; }
  .brand p { margin: 2px 0 0; font-size: 11px; color: #64748b; }
  .doc-meta { text-align: right; font-size: 11px; }
  .doc-meta .doc-type { font-size: 18px; font-weight: 700; letter-spacing: 1px; color: #0f172a; }
  .doc-meta .doc-num { font-size: 13px; font-weight: 600; }
  .doc-meta .label { color: #64748b; text-transform: uppercase; letter-spacing: 0.08em; font-size: 10px; }
  .billing { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 12px; font-size: 11.5px; }
  .billing .box { padding: 6px 0; }
  .billing .label { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #64748b; margin-bottom: 3px; }
  .billing .name { font-size: 13px; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  thead { display: table-header-group; }
  tfoot { display: table-row-group; }
  tr { page-break-inside: avoid; }
  th { background: #0f172a; color: #fff; text-transform: uppercase; letter-spacing: 0.06em;
    font-size: 9.5px; font-weight: 700; padding: 6px 8px; text-align: left; }
  th.num, td.num { text-align: right; }
  td { padding: 6px 8px; border-bottom: 1px solid #e2e8f0; }
  .totals { margin-top: 10px; display: flex; justify-content: flex-end; }
  .totals table { width: 60%; max-width: 320px; }
  .totals td { padding: 4px 8px; border: none; font-size: 11.5px; }
  .totals tr.grand td { border-top: 2px solid #0f172a; font-weight: 700; font-size: 13px; padding-top: 6px; }
  .totals tr.credit td { color: #b45309; }
  .notes { margin-top: 16px; padding-top: 10px; border-top: 1px dashed #cbd5e1;
    font-size: 10.5px; color: #475569; }
  .footer { position: fixed; bottom: 6mm; left: 18mm; right: 18mm; font-size: 9px;
    color: #94a3b8; display: flex; justify-content: space-between; }
  .pageno::before { content: "Page " counter(page) " of " counter(pages); }
  .stamp { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-22deg);
    font-size: 110px; font-weight: 800; color: rgba(15, 23, 42, 0.05);
    letter-spacing: 6px; pointer-events: none; z-index: 0; user-select: none; }
  .credit-stamp { color: rgba(180, 83, 9, 0.07); }
  .content { position: relative; z-index: 1; }
  @media print {
    .no-print { display: none !important; }
    body { font-size: 10pt; }
  }
`;

/* --------- INVOICE ---------- */
function renderInvoiceHtml(inv, opts = {}) {
  const orientation = opts.orientation || "landscape";
  const items = inv.items || [];
  const pages = chunk(items, ITEMS_PER_PAGE);
  if (pages.length === 0) pages.push([]);

  const subtotal = inv.total_amount || 0;
  const creditTotal = (inv.credit_notes || []).reduce((s, c) => s + (c.total_amount || 0), 0);
  const paid = inv.paid_amount || 0;
  const settled = inv.manual_settled_amount || 0;
  const balance = inv.balance != null ? inv.balance : subtotal - creditTotal - paid - settled;
  const netPayable = inv.net_payable != null ? inv.net_payable : subtotal - creditTotal;

  const pageHtml = pages
    .map((chunkItems, idx) => {
      const isLast = idx === pages.length - 1;
      const startNo = idx * ITEMS_PER_PAGE;
      return `
      <section class="page">
        <div class="stamp">${escape(inv.status === "paid" ? "PAID" : "INVOICE")}</div>
        <div class="content">
          <header class="header">
            <div class="brand">
              <h1>Commercial Trading</h1>
              <p>Tax Invoice / Sales Receipt</p>
            </div>
            <div class="doc-meta">
              <div class="doc-type">INVOICE</div>
              <div class="doc-num">#${escape(inv.invoice_number)}</div>
              <div class="label">Issued</div>
              <div>${escape((inv.created_at || "").slice(0, 10))}</div>
            </div>
          </header>
          <div class="billing">
            <div class="box">
              <div class="label">Bill To</div>
              <div class="name">${escape(inv.customer_shop_name || inv.customer_name || "")}</div>
              ${inv.customer_shop_name ? `<div>${escape(inv.customer_name)}</div>` : ""}
              ${inv.order_number ? `<div>Order: ${escape(inv.order_number)}</div>` : ""}
            </div>
            <div class="box" style="text-align:right;">
              <div class="label">Status</div>
              <div class="name" style="text-transform:capitalize;">${escape(inv.status || "unpaid")}</div>
              ${inv.linked_purchase_number ? `<div class="label" style="margin-top:4px;">Linked Purchase</div><div>${escape(inv.linked_purchase_number)}</div>` : ""}
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th style="width:36px;">#</th>
                <th>Item</th>
                <th class="num" style="width:60px;">Qty</th>
                <th class="num" style="width:100px;">Unit Price</th>
                <th class="num" style="width:110px;">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${chunkItems
                .map(
                  (it, j) => `
                <tr>
                  <td>${startNo + j + 1}</td>
                  <td>${escape(it.product_name)}</td>
                  <td class="num">${it.quantity}</td>
                  <td class="num">Rs. ${fmt(it.unit_price)}</td>
                  <td class="num"><b>Rs. ${fmt(it.amount)}</b></td>
                </tr>`
                )
                .join("")}
            </tbody>
          </table>
          ${
            isLast
              ? `
            <div class="totals">
              <table>
                <tr><td>Subtotal</td><td class="num">Rs. ${fmt(subtotal)}</td></tr>
                ${(inv.credit_notes || [])
                  .map(
                    (c) =>
                      `<tr class="credit"><td>${escape(
                        c.credit_note_number || c.return_number
                      )} (Credit Note)</td><td class="num">- Rs. ${fmt(c.total_amount)}</td></tr>`
                  )
                  .join("")}
                ${creditTotal > 0 ? `<tr><td>Net Payable</td><td class="num">Rs. ${fmt(netPayable)}</td></tr>` : ""}
                ${paid > 0 ? `<tr><td>Paid</td><td class="num">- Rs. ${fmt(paid)}</td></tr>` : ""}
                ${settled > 0 ? `<tr><td>Manually Settled</td><td class="num">- Rs. ${fmt(settled)}</td></tr>` : ""}
                <tr class="grand"><td>Total Due</td><td class="num">Rs. ${fmt(balance)}</td></tr>
              </table>
            </div>
            ${inv.notes ? `<div class="notes"><b>Notes:</b> ${escape(inv.notes)}</div>` : ""}
            <div class="notes" style="text-align:center; margin-top:18px; border:none;">
              Thank you for your business.
            </div>
          `
              : `<div style="text-align:right; margin-top:8px; font-size:10px; color:#64748b;">Continued on next page →</div>`
          }
        </div>
      </section>
    `;
    })
    .join("");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<title>Invoice ${escape(inv.invoice_number)}</title>
<style>
  @page { size: A4 ${orientation}; margin: 10mm 0; }
  ${baseStyles}
</style>
</head>
<body><div class="doc">${pageHtml}</div>
<div class="footer no-print-not"><span>Commercial Trading · Invoice ${escape(
    inv.invoice_number
  )}</span><span class="pageno"></span></div>
<script>window.onload = function(){ setTimeout(function(){ window.print(); }, 350); };</script>
</body></html>`;
}

/* --------- CREDIT NOTE ---------- */
function renderCreditNoteHtml(cn, invoice = null) {
  const items = cn.items || [];
  const pages = chunk(items, ITEMS_PER_PAGE);
  if (pages.length === 0) pages.push([]);
  const cnNumber = cn.credit_note_number || cn.return_number || "";

  const pageHtml = pages
    .map((chunkItems, idx) => {
      const isLast = idx === pages.length - 1;
      const startNo = idx * ITEMS_PER_PAGE;
      return `
      <section class="page">
        <div class="stamp credit-stamp">CREDIT NOTE</div>
        <div class="content">
          <header class="header" style="border-color:#b45309;">
            <div class="brand">
              <h1>Commercial Trading</h1>
              <p>Credit Note (Return Adjustment)</p>
            </div>
            <div class="doc-meta">
              <div class="doc-type" style="color:#b45309;">CREDIT NOTE</div>
              <div class="doc-num">#${escape(cnNumber)}</div>
              <div class="label">Issued</div>
              <div>${escape((cn.created_at || "").slice(0, 10))}</div>
            </div>
          </header>
          <div class="billing">
            <div class="box">
              <div class="label">Issued To</div>
              <div class="name">${escape(cn.customer_name || "")}</div>
              <div>Against Invoice: <b>${escape(cn.invoice_number || "")}</b></div>
            </div>
            <div class="box" style="text-align:right;">
              ${invoice ? `<div class="label">Invoice Total</div><div>Rs. ${fmt(invoice.total_amount)}</div>` : ""}
              <div class="label" style="margin-top:4px;">Credit Amount</div>
              <div class="name" style="color:#b45309;">Rs. ${fmt(cn.total_amount)}</div>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th style="width:36px;">#</th>
                <th>Returned Item</th>
                <th class="num" style="width:60px;">Qty</th>
                <th class="num" style="width:100px;">Unit Price</th>
                <th class="num" style="width:110px;">Credit</th>
              </tr>
            </thead>
            <tbody>
              ${chunkItems
                .map(
                  (it, j) => `
                <tr>
                  <td>${startNo + j + 1}</td>
                  <td>${escape(it.product_name)}</td>
                  <td class="num">${it.quantity}</td>
                  <td class="num">Rs. ${fmt(it.unit_price)}</td>
                  <td class="num"><b>Rs. ${fmt(it.amount)}</b></td>
                </tr>`
                )
                .join("")}
            </tbody>
          </table>
          ${
            isLast
              ? `
            <div class="totals">
              <table>
                <tr class="grand"><td>Total Credit</td><td class="num" style="color:#b45309;">Rs. ${fmt(
                  cn.total_amount
                )}</td></tr>
              </table>
            </div>
            ${cn.notes ? `<div class="notes"><b>Notes:</b> ${escape(cn.notes)}</div>` : ""}
            <div class="notes" style="text-align:center; margin-top:18px; border:none;">
              This credit note has been recorded against invoice ${escape(cn.invoice_number || "")}.
            </div>
          `
              : `<div style="text-align:right; margin-top:8px; font-size:10px; color:#64748b;">Continued on next page →</div>`
          }
        </div>
      </section>
    `;
    })
    .join("");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<title>Credit Note ${escape(cnNumber)}</title>
<style>
  @page { size: A5 portrait; margin: 8mm; }
  ${baseStyles}
</style>
</head>
<body><div class="doc">${pageHtml}</div>
<div class="footer"><span>Commercial Trading · Credit Note ${escape(cnNumber)}</span><span class="pageno"></span></div>
<script>window.onload = function(){ setTimeout(function(){ window.print(); }, 350); };</script>
</body></html>`;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function openPrintWindow(html) {
  const w = window.open("", "_blank", "width=900,height=1000");
  if (!w) {
    alert("Please allow pop-ups for this site to print.");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

export function printInvoice(invoice, opts = {}) {
  // Heuristic: long product names or many cols → portrait; default landscape.
  const orientation =
    opts.orientation ||
    ((invoice.items || []).some((i) => (i.product_name || "").length > 40) ? "portrait" : "landscape");
  openPrintWindow(renderInvoiceHtml(invoice, { orientation }));
}

export function printCreditNote(creditNote, invoice = null) {
  openPrintWindow(renderCreditNoteHtml(creditNote, invoice));
}

/* --------- PAYMENT VOUCHER ---------- */
function renderPaymentVoucherHtml(p) {
  const cheques = p.payment_method === "cheque"
    ? (p.cheques?.length > 0
        ? p.cheques
        : [{ cheque_number: p.cheque_number, bank_name: p.bank_name, cheque_date: p.cheque_date, amount: p.amount }])
    : [];
  const allocations = p.allocations || [];
  const isCustomer = p.payment_type === "customer";
  const docTitle = isCustomer ? "RECEIPT" : "PAYMENT VOUCHER";
  const refLabel = isCustomer ? "Invoice" : "Purchase";

  const chequeRows = cheques.map((c, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${escape(c.cheque_number || "-")}</td>
      <td>${escape(c.bank_name || "-")}</td>
      <td>${escape(c.cheque_date || "-")}</td>
      <td class="num"><b>Rs. ${fmt(c.amount)}</b></td>
    </tr>`).join("");

  const allocRows = allocations.map((a, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${escape(a.reference_number || a.reference_id?.slice(0, 8))}</td>
      <td class="num">${a.reference_total ? `Rs. ${fmt(a.reference_total)}` : "-"}</td>
      <td class="num"><b>Rs. ${fmt(a.amount)}</b></td>
    </tr>`).join("");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<title>${escape(docTitle)} — ${escape(p.entity_name)}</title>
<style>
  @page { size: A5 portrait; margin: 10mm; }
  ${baseStyles}
</style>
</head>
<body><div class="doc">
  <section class="page">
    <div class="stamp">${escape(docTitle)}</div>
    <div class="content">
      <header class="header">
        <div class="brand">
          <h1>Commercial Trading</h1>
          <p>${escape(docTitle)}</p>
        </div>
        <div class="doc-meta">
          <div class="doc-type">${escape(docTitle)}</div>
          <div class="doc-num">${escape((p.id || "").slice(0, 8).toUpperCase())}</div>
          <div class="label">Date</div>
          <div>${escape((p.created_at || "").slice(0, 10))}</div>
        </div>
      </header>

      <div class="billing">
        <div class="box">
          <div class="label">${isCustomer ? "Received From" : "Paid To"}</div>
          <div class="name">${escape(p.entity_name || "")}</div>
        </div>
        <div class="box" style="text-align:right;">
          <div class="label">Method</div>
          <div class="name" style="text-transform:capitalize;">${escape(p.payment_method || "")}</div>
          <div class="label" style="margin-top:4px;">Total</div>
          <div class="name" style="font-size:18px;">Rs. ${fmt(p.amount)}</div>
        </div>
      </div>

      ${cheques.length > 0 ? `
        <div style="margin-top:6px;">
          <div class="label" style="font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.08em; color:#64748b; margin-bottom:4px;">Cheque Breakdown</div>
          <table>
            <thead>
              <tr>
                <th style="width:30px;">#</th>
                <th>Cheque #</th>
                <th>Bank</th>
                <th>Date</th>
                <th class="num">Amount</th>
              </tr>
            </thead>
            <tbody>${chequeRows}</tbody>
          </table>
        </div>` : ""}

      ${allocations.length > 0 ? `
        <div style="margin-top:10px;">
          <div class="label" style="font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.08em; color:#64748b; margin-bottom:4px;">Allocated to ${refLabel}s</div>
          <table>
            <thead>
              <tr>
                <th style="width:30px;">#</th>
                <th>${refLabel} #</th>
                <th class="num">${refLabel} Total</th>
                <th class="num">Allocated</th>
              </tr>
            </thead>
            <tbody>${allocRows}</tbody>
          </table>
        </div>` : ""}

      <div class="totals">
        <table>
          <tr class="grand">
            <td>Total ${isCustomer ? "Received" : "Paid"}</td>
            <td class="num">Rs. ${fmt(p.amount)}</td>
          </tr>
        </table>
      </div>

      ${p.notes ? `<div class="notes"><b>Notes:</b> ${escape(p.notes)}</div>` : ""}
      <div class="notes" style="text-align:center; margin-top:20px; border:none;">
        ${isCustomer ? "Thank you for your payment." : "Authorised signatory."}
      </div>
    </div>
  </section>
</div>
<div class="footer"><span>Commercial Trading · ${escape(docTitle)}</span><span class="pageno"></span></div>
<script>window.onload = function(){ setTimeout(function(){ window.print(); }, 350); };</script>
</body></html>`;
}

export function printPaymentVoucher(payment) {
  openPrintWindow(renderPaymentVoucherHtml(payment));
}

