'use strict';

const PDFDocument = require('pdfkit');

const fmtMoney = (v) => 'R$ ' + (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Formato compacto (sem segundos) — a versão longa do toLocaleString
// não cabia na largura da coluna e ficava cortada.
const fmtDate = (ts) => {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
};

const STATUS_LABELS = {
  PENDING: 'Aguardando pagamento',
  CONFIRMED: 'Pago',
  RECEIVED: 'Pago',
  RECEIVED_IN_CASH: 'Pago (dinheiro)',
  OVERDUE: 'Vencido',
  REFUNDED: 'Estornado',
};
function statusLabel(s) { return STATUS_LABELS[s] || s || '—'; }

// Gera o PDF de uma lista (já filtrada) de pedidos e escreve direto no
// response — não guarda nada em disco.
function streamOrdersPdf(res, orders, filterSummary) {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="naipe-azul-pedidos.pdf"');
  doc.pipe(res);

  doc.fontSize(18).fillColor('#0B1220').text('Naipe Azul — Relatório de Pedidos', { align: 'left' });
  doc.fontSize(9).fillColor('#6B7280').text('Gerado em ' + fmtDate(Date.now()));
  if (filterSummary) doc.text('Filtros: ' + filterSummary);
  doc.moveDown(0.6);

  const total = orders.reduce((sum, o) => sum + (o.value || 0), 0);
  const paidCount = orders.filter((o) => ['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH'].includes(o.status)).length;
  doc.fontSize(10).fillColor('#0B1220').text(
    `${orders.length} pedido(s) — ${paidCount} pago(s) — total ${fmtMoney(total)}`
  );
  doc.moveDown(0.8);

  // Soma <= largura útil da página (A4 - margens = ~515pt), com folga
  // pra nenhuma célula quebrar linha e cortar o conteúdo.
  const cols = [
    { key: 'date', label: 'Data', width: 90 },
    { key: 'name', label: 'Cliente', width: 90 },
    { key: 'contact', label: 'Contato', width: 105 },
    { key: 'plan', label: 'Plano', width: 62 },
    { key: 'method', label: 'Método', width: 40 },
    { key: 'value', label: 'Valor', width: 58 },
    { key: 'status', label: 'Status', width: 60 },
  ];
  const tableX = doc.page.margins.left;
  const rowH = 22;

  function drawHeader(y) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#fff');
    doc.rect(tableX, y, cols.reduce((s, c) => s + c.width, 0), rowH).fill('#0B1220');
    let x = tableX;
    cols.forEach((c) => {
      doc.fillColor('#fff').text(c.label, x + 4, y + 6, { width: c.width - 8 });
      x += c.width;
    });
    return y + rowH;
  }

  function ensureSpace(y) {
    if (y > doc.page.height - doc.page.margins.bottom - rowH) {
      doc.addPage();
      return drawHeader(doc.page.margins.top);
    }
    return y;
  }

  let y = drawHeader(doc.y);

  doc.font('Helvetica').fontSize(8.5);
  orders.forEach((o, i) => {
    y = ensureSpace(y);
    if (i % 2 === 1) {
      doc.rect(tableX, y, cols.reduce((s, c) => s + c.width, 0), rowH).fill('#F4F6FA');
    }
    const cells = {
      date: fmtDate(o.createdAt),
      name: o.name || '—',
      contact: (o.email || '') + (o.phone ? '\n' + o.phone : ''),
      plan: o.planName || o.plan || '—',
      method: o.method === 'PIX' ? 'Pix' : 'Cartão',
      value: fmtMoney(o.value),
      status: statusLabel(o.status),
    };
    let x = tableX;
    cols.forEach((c) => {
      doc.fillColor('#0B1220').text(String(cells[c.key]), x + 4, y + 5, { width: c.width - 8, height: rowH - 4 });
      x += c.width;
    });
    y += rowH;
  });

  doc.end();
}

module.exports = { streamOrdersPdf, statusLabel };
