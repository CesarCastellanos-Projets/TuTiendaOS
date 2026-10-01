import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const requireWeb = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { build } = requireWeb('esbuild');

async function load(relative) {
  const result = await build({ entryPoints: [new URL(relative, import.meta.url).pathname.replace(/^\/(\w:)/, '$1')], bundle: true, write: false, platform: 'node', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

test('búsqueda normaliza tildes, palabras, omisiones y letras transpuestas sin corregir códigos', async () => {
  const { normalizeSearch, searchScore } = await load('../apps/web/src/lib/catalog-search.ts');
  const name = normalizeSearch('Borrador BLANCO chico · Stándford');
  assert.ok(searchScore('borradr blanco', name, ['7751234']) > 0);
  assert.ok(searchScore('borardor', name, []) > 0);
  assert.ok(searchScore('blanco borrador', name, []) > 0);
  assert.equal(searchScore('7751235', name, ['7751234']), 0);
  assert.equal(searchScore('bebida roja', name, []), 0);
  assert.equal(searchScore('7751234', name, ['7751234']), 1000);
});

test('selector conserva IDs heredados y stock compartido en presentaciones que se pueden abrir', async () => {
  const { salePresentations } = await load('../apps/web/src/lib/sale-presentations.ts');
  const stock = { productId: 'P1', productName: 'Hojas', quantity: 950, stockModelVersion: 3, salePrice: 1 };
  const choices = salePresentations(stock, { unit: 'UN', salePrice: 0.2, presentations: [{ autoUnpackEnabled: true, unit: 'MIL', factor: 1000, salePrice: 100, allowFractionalSale: true, fractionStep: 0.5 }] });
  assert.equal(choices.length, 2); assert.equal(choices[0].quantity, 950);
  assert.equal(choices[1].presentationId, 'legacy-1'); assert.equal(choices[1].quantity, 0.95);
  assert.equal(salePresentations(stock, { unit: 'UN', salePrice: 1 }).length, 1);
});

test('CSV neutraliza fórmulas y conserva comillas y números', async () => {
  const { csvCell } = await load('../apps/web/src/lib/csv.ts');
  for (const value of ['=HYPERLINK("url")', '+SUM(1)', '-cmd', '@formula', '  =formula', '\t=cmd', '\n=cmd']) {
    assert.ok(csvCell(value).startsWith('"\''));
  }
  assert.equal(csvCell('Producto "A", B'), '"Producto ""A"", B"');
  assert.equal(csvCell(-10), '-10');
});

test('impresión limita ancho y escapa nombres y atributos', async () => {
  const { ticketHtml, cashCloseTicketHtml } = await load('../apps/web/src/lib/print.ts');
  const sale = {
    items: [{ name: '<img src=x onerror=alert(1)>', qty: 1, unitPrice: 1, total: 1 }],
    storeName: '<script>bad</script>', userName: 'Caja', type: 'boleta', code: 'B001-1',
    createdAt: Date.now(), clientDoc: { tipo: '-', nombre: '', numero: '' },
    subtotal: 1, igv: 0, total: 1, paymentMethod: 'efectivo', paidAmount: 1, changeAmount: 0
  };
  const company = { ticketWidth: '" onmouseover="alert(1)', razonSocial: 'Demo' };
  const html = ticketHtml(sale, company);
  assert.ok(html.startsWith('<div class="thermal-ticket" data-ticket-width="80mm"'));
  assert.ok(!html.includes('<script>bad'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('onmouseover='));
  assert.ok(ticketHtml(sale, { ...company, ticketWidth: '58mm' }).startsWith('<div class="thermal-ticket" data-ticket-width="58mm"'));
  const cash = cashCloseTicketHtml({ userName: 'Caja', openingAmount: 0, openedAt: Date.now() }, { totalSales: 0, cashSales: 0, yapeSales: 0, cardSales: 0, otherSales: 0, salesCount: 0 }, company);
  assert.ok(cash.startsWith('<div class="thermal-ticket" data-ticket-width="80mm"'));
  assert.ok(!cash.includes('onmouseover='));
});


test('disponibilidad compartida suma todas las equivalencias, solo de empaques que se pueden abrir, incluidos IDs heredados', async () => {
  const { availableBase } = await load('../apps/web/src/lib/stock-availability.ts');
  const stock = { baseQuantity: 2, quantity: 68, presentationQuantities: { 'legacy-1': 3, caja: 1 } };
  const presentations = [{ factor: 12, autoUnpackEnabled: true }, { id: 'caja', factor: 30, autoUnpackEnabled: false }];
  assert.equal(availableBase(stock, presentations), 38);
  assert.equal(availableBase(undefined, presentations), 0);
});

test('950 hojas permiten seleccionar 0.5 millar y comparten demanda del carrito', async () => {
  const { availablePresentation, initialSaleQuantity, saleQuantityError, remainingPresentation } = await load('../apps/web/src/lib/stock-availability.ts');
  const millar = { id: 'millar', autoUnpackEnabled: true, factor: 1000, allowFractionalSale: true, fractionStep: 0.5 };
  const stock = { quantity: 950, baseQuantity: 950, presentationQuantities: {}, stockModelVersion: 3 };
  assert.equal(availablePresentation(stock, [millar], millar), 0.95);
  assert.equal(initialSaleQuantity(0.95, millar), 0.5);
  assert.equal(initialSaleQuantity(0.95, { ...millar, allowFractionalSale: false }), 0);
  assert.equal(saleQuantityError(0.5, millar), null);
  assert.ok(saleQuantityError(0.95, millar));
  assert.ok(saleQuantityError(0.5, { factor: 3, allowFractionalSale: true, fractionStep: 0.5 }));
  assert.equal(remainingPresentation(stock, { presentations: [millar] }, [{ productId: 'P1', presentationId: 'millar', qty: 0.5 }, { productId: 'P1', qty: 400 }], 'P1'), 50);
  assert.ok(saleQuantityError(0.5));
  assert.equal(saleQuantityError(0.5, null, 'KG'), null);
});

test('selector y carrito separan 10 sueltos de dos cajas cerradas de 12', async () => {
  const { availableBase, availablePresentation, remainingPresentation, saleQuantityError } = await load('../apps/web/src/lib/stock-availability.ts');
  const box = { id: 'box', factor: 12, autoUnpackEnabled: false, allowFractionalSale: true };
  const other = { id: 'other', factor: 12, autoUnpackEnabled: false };
  const product = { presentations: [box, other] };
  const stock = { baseQuantity: 10, quantity: 34, stockModelVersion: 4, presentationQuantities: { box: 2 } };
  assert.equal(availableBase(stock, product.presentations), 10);
  assert.equal(availablePresentation(stock, product.presentations, box), 2);
  assert.equal(availablePresentation(stock, product.presentations, other), 0);
  const cart = [{ productId: 'P', qty: 10 }, { productId: 'P', presentationId: 'box', qty: 1 }];
  assert.equal(remainingPresentation(stock, product, cart, 'P'), 0);
  assert.equal(remainingPresentation(stock, product, cart, 'P', 'box'), 1);
  assert.ok(saleQuantityError(0.5, box));
});

test('ticket personalizable limita estilos, rechaza protocolos activos y conserva columnas y totales', async () => {
  const { ticketHtml, ticketDesign, ticketLogoSource } = await load('../apps/web/src/lib/print.ts');
  const sale = { items: [{ name: 'Caja <cerrada>', barcode: '775001', presentationUnit: 'CJA', presentationId: 'caja', presentationLabel: 'Caja x30', factor: 30, qty: 2, unitPrice: 11.5, total: 23 }], storeName: 'Tienda', userName: 'Caja', type: 'factura', code: 'F001-1', createdAt: 1, clientDoc: { tipo: 'RUC', nombre: 'Cliente', numero: '20123456789' }, subtotal: 19.49, igv: 3.51, igvRate: 0.18, total: 23, paymentMethod: 'efectivo', paidAmount: 30, changeAmount: 7 };
  assert.equal(ticketLogoSource('javascript:alert(1)'), '');
  assert.equal(ticketLogoSource('data:image/svg+xml;base64,AAA='), '');
  assert.equal(ticketLogoSource('https://ejemplo.com/logo.png'), 'https://ejemplo.com/logo.png');
  const design = ticketDesign({ ticketDesign: { fontSize: 100, logoWidth: -100, headerAlign: 'left; color:red' } });
  assert.equal(design.fontSize, 14); assert.equal(design.logoWidth, 40); assert.equal(design.headerAlign, 'center');
  const html = ticketHtml(sale, { ticketDesign: { ...design, showCode: true } });
  assert.match(html, /<table class="ticket-items">/); assert.match(html, /CÓD\./); assert.match(html, /775001/);
  assert.match(html, /Caja &#60;cerrada&#62;/); assert.match(html, /60 un/); assert.match(html, /FACTURA ELECTRÓNICA/); assert.match(html, /S\/ 23\.00/);
  const compact = ticketHtml(sale, { ticketDesign: { ...design, layout: 'compact', showUnitPrice: false, showCashier: false, showClient: false }, logoUrl: 'javascript:alert(1)' });
  assert.ok(!compact.includes('<table')); assert.ok(!compact.includes('Cajero:')); assert.ok(!compact.includes('Cliente:')); assert.ok(!compact.includes('javascript:'));
});
