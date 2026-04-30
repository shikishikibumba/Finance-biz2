// Opens a clean print-only window with the given HTML body.
// This guarantees that ONLY the report content is printed (no app chrome).
export function printHtml(title, bodyHtml) {
  const w = window.open("", "_blank", "width=1000,height=800");
  if (!w) return;
  w.document.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    @page { size: A4; margin: 14mm; }
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
    .entity { margin-bottom: 16px; }
    .entity-head {
      display: flex; justify-content: space-between; align-items: center;
      border-bottom: 1px solid #111827; padding: 4px 0; margin-bottom: 6px;
    }
    .entity-head .name { font-weight: 700; font-size: 13px; }
    .entity-head .amt { font-weight: 700; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    thead th {
      text-align: left; font-size: 10px; text-transform: uppercase;
      letter-spacing: 0.5px; padding: 6px 8px; border-bottom: 2px solid #111827;
      background: #f3f4f6;
    }
    tbody td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; font-size: 11px; }
    .right { text-align: right; }
    .center { text-align: center; }
    .totals {
      display: flex; justify-content: flex-end; margin-top: 14px;
      border-top: 2px solid #111827; padding-top: 8px;
    }
    .totals .label { font-weight: 600; margin-right: 24px; font-size: 13px; }
    .totals .value { font-weight: 700; font-size: 14px; }
    .footer { margin-top: 18px; font-size: 10px; color: #6b7280; text-align: center; }
    @media print { .no-print { display: none; } }
  </style>
</head>
<body>
${bodyHtml}
<script>
  window.onload = function() { setTimeout(function() { window.print(); }, 150); };
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
