// Opens a clean print-only window with the given HTML body.
// This guarantees that ONLY the report content is printed (no app chrome
// and no platform badges such as the "Made with Emergent" watermark).
export function printHtml(title, bodyHtml, opts = {}) {
  const landscape = !!opts.landscape;
  const w = window.open("", "_blank", "width=1000,height=800");
  if (!w) return;
  w.document.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    @page { size: A4 ${landscape ? "landscape" : "portrait"}; margin: 12mm; }
    * { box-sizing: border-box; }
    body {
      font-family: 'Helvetica Neue', Arial, sans-serif;
      color: #111827;
      font-size: 12px;
      margin: 0;
      padding: 0;
    }
    h1 { font-size: 18px; margin: 0 0 4px; text-align: center; letter-spacing: 0.5px; }
    h2 { font-size: 13px; margin: 0 0 14px; text-align: center; font-weight: 500; color: #4b5563; }
    h3 { font-size: 13px; margin: 16px 0 6px; font-weight: 700; }
    .meta { text-align: center; font-size: 11px; color: #6b7280; margin-bottom: 14px; }
    .entity { margin-bottom: 12px; font-size: 12px; }
    .entity-head {
      display: flex; justify-content: space-between; align-items: center;
      border-bottom: 1px solid #111827; padding: 4px 0; margin-bottom: 6px;
    }
    .entity-head .name { font-weight: 700; font-size: 13px; }
    .entity-head .amt { font-weight: 700; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 8px; table-layout: auto; }
    thead { display: table-header-group; }        /* repeat headers on multi-page print */
    tr { page-break-inside: avoid; }
    thead th {
      text-align: left; font-size: 10px; text-transform: uppercase;
      letter-spacing: 0.5px; padding: 6px 8px; border-bottom: 2px solid #111827;
      background: #f3f4f6;
    }
    tbody td { padding: 5px 8px; border-bottom: 1px solid #e5e7eb; font-size: 11px; vertical-align: top; word-wrap: break-word; }
    .right { text-align: right; }
    .center { text-align: center; }
    .ledger-table tbody td { font-size: 10.5px; padding: 4px 6px; }
    .totals {
      display: flex; justify-content: flex-end; margin-top: 12px;
      border-top: 2px solid #111827; padding-top: 6px;
    }
    .totals .label { font-weight: 600; margin-right: 24px; font-size: 13px; }
    .totals .value { font-weight: 700; font-size: 14px; }
    .footer { margin-top: 18px; font-size: 10px; color: #6b7280; text-align: center; }
    /* Hide platform badges (e.g. Made with Emergent) if anything injects them */
    [data-testid*="emergent"], [class*="emergent-badge"], .made-with-emergent,
    iframe[src*="emergent"] { display: none !important; }
    @media print { .no-print { display: none !important; } }
  </style>
</head>
<body>
${bodyHtml}
<script>
  window.onload = function() { setTimeout(function() { window.print(); }, 200); };
</script>
</body>
</html>`);
  w.document.close();
}

export function escapeHtml(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function fmtRs(n) {
  const x = Number(n || 0);
  return "Rs. " + new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x);
}
