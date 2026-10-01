import base64
import os
import re
import time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('POS_TEST_BASE_URL', 'http://127.0.0.1:5174')
if not BASE.startswith('http://127.0.0.1:'):
    raise RuntimeError('Solo se permiten los emuladores locales.')
OUT = Path(os.environ.get('TEMP', '.')) / 'denzoz-ticket-review'
OUT.mkdir(exist_ok=True)
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=')


def login(page, role):
    page.goto(BASE)
    assert page.evaluate("async () => (await import('/src/lib/firebase.ts')).firebaseConfig.projectId") == 'demo-denzoz-ops'
    page.locator('input[type=email]').fill(f'{role}-ui@example.com')
    page.locator('input[type=password]').fill('UiTest123!')
    page.get_by_role('button', name='Ingresar al Sistema').click()
    page.wait_for_url(lambda url: url.endswith('/admin' if role == 'admin' else '/pos'))


def call(page, name, data):
    return page.evaluate("""async ({name,data}) => {
      const { functions } = await import('/src/lib/firebase.ts');
      const { httpsCallable } = await import('/node_modules/.vite/deps/firebase_functions.js');
      return (await httpsCallable(functions,name)(data)).data;
    }""", {'name': name, 'data': data})

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True, executable_path=os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE'))
    context = browser.new_context(viewport={'width': 1365, 'height': 900})
    context.add_init_script("window.printCalls=[]; window.print=()=>{window.printCalls.push({at:performance.now(),logo:document.querySelector('#ticket-print img')?.naturalWidth??0,text:document.querySelector('#ticket-print')?.textContent}); window.dispatchEvent(new Event('afterprint'));};")
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.route('**/test-ticket-logo.png*', lambda route: route.fulfill(body=PNG, content_type='image/png'))
    login(page, 'admin')
    page.goto(BASE + '/admin/tickets')
    url = page.get_by_label('Enlace directo de la imagen', exact=True)
    url.fill('')
    url.press_sequentially(BASE + '/test-ticket-logo.png')
    expect(url).to_have_value(BASE + '/test-ticket-logo.png')
    expect(page.get_by_alt_text('Logo cargado')).to_be_visible()
    page.get_by_label('Mostrar código de producto').check()
    page.get_by_label('Mensaje de pie de ticket').fill('Gracias por su compra\nCambios con comprobante')
    page.get_by_role('button', name='Guardar diseño', exact=True).click()
    page.get_by_text('Diseño del ticket guardado', exact=True).wait_for(timeout=30000)
    cfg = call(page, 'getCompanyConfig', {})
    assert cfg['ticketDesign']['showCode'] is True, cfg
    expect(page.locator('.thermal-ticket table')).to_be_visible()
    assert page.locator('.thermal-ticket .row').first.evaluate("el=>getComputedStyle(el).display") == 'flex'
    for width in [320, 390, 768, 1365]:
        page.set_viewport_size({'width': width, 'height': 900})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), width
        for ticket_width in ['58mm', '80mm']:
            page.get_by_label('Ancho de impresión', exact=False).select_option(ticket_width)
            assert page.locator('.thermal-ticket').evaluate('el=>el.scrollWidth<=el.clientWidth'), (width, ticket_width)
        page.screenshot(path=str(OUT / f'ticket-{width}.png'), full_page=True)
    page.get_by_label('Ancho de impresión', exact=False).select_option('80mm')
    page.get_by_role('button', name='Guardar diseño', exact=True).click()
    page.get_by_text('Diseño del ticket guardado', exact=True).wait_for()
    page.get_by_role('button', name='Imprimir ticket de prueba', exact=True).click()
    page.wait_for_function('window.printCalls.length===1')
    assert page.evaluate('window.printCalls[0].logo') == 1

    # Print must wait for a fresh, slow image and continue on a broken image.
    def slow_image(route):
        time.sleep(0.7)
        route.fulfill(body=PNG, content_type='image/png')
    page.route('**/slow-ticket-logo.png', slow_image)
    result = page.evaluate("""async () => {
      const {printTicket}=await import('/src/lib/print.ts');
      const started=performance.now();
      const result=await printTicket('<div class="thermal-ticket" data-ticket-width="80mm"><div class="ticket-logo"><img src="/slow-ticket-logo.png"></div></div>');
      return {...result,elapsed:performance.now()-started,logo:window.printCalls.at(-1).logo};
    }""")
    assert result['elapsed'] >= 650 and result['logo'] == 1 and result['missingImages'] == 0, result
    page.route('**/broken-ticket-logo.png', lambda route: route.fulfill(status=404, body='missing'))
    result = page.evaluate("async()=> (await import('/src/lib/print.ts')).printTicket('<div class=\"thermal-ticket\"><div class=\"ticket-logo\"><img src=\"/broken-ticket-logo.png\"></div></div>')")
    assert result['missingImages'] == 1, result

    # The exact requested ingress: 50 loose + 50 sealed boxes x30 = 1550.
    created = call(page, 'saveCatalogProduct', {'product': {'name': 'Cajas cerradas auditoria', 'category': 'Prueba', 'unit': 'UN', 'salePrice': 0.5, 'active': True, 'barcode': 'TICKET-UN', 'presentations': [{'id': 'closed30', 'unit': 'CJA', 'description': 'Caja cerrada x30', 'factor': 30, 'salePrice': 11.5, 'barcode': 'TICKET-BOX', 'autoUnpackEnabled': False, 'allowFractionalSale': False}]}})
    print('Producto de prueba:', created)
    page.goto(BASE + '/admin/ingresos')
    page.locator('select').first.select_option('S1')
    search = page.get_by_placeholder('Buscar producto por nombre o código', exact=False)
    search.fill('TICKET-BOX')
    page.get_by_role('button', name=re.compile('^Cajas cerradas auditoria')).click()
    page.locator('input[type=number]').first.fill('50')
    search.fill('TICKET-UN')
    page.get_by_role('button', name=re.compile('^Cajas cerradas auditoria')).click()
    page.locator('input[type=number]').nth(1).fill('50')
    expect(page.get_by_text('1550 unidades equivalentes a ingresar', exact=False)).to_be_visible()
    page.get_by_role('button', name='Registrar ingreso (2 líneas)', exact=True).click()
    page.get_by_text('Ingreso registrado:', exact=False).wait_for(timeout=30000)
    stock = page.evaluate("""async (id) => { const {auth}=await import('/src/lib/firebase.ts'); const token=await auth.currentUser.getIdToken(); const response=await fetch('http://127.0.0.1:8080/v1/projects/demo-denzoz-ops/databases/(default)/documents/tenants/tenant-ui/product_stocks/'+id+'_S1',{headers:{Authorization:'Bearer '+token}}); const data=await response.json(); const f=data.fields; return [{quantity:Number(f.quantity.integerValue??f.quantity.doubleValue),baseQuantity:Number(f.baseQuantity.integerValue??f.baseQuantity.doubleValue),presentationQuantities:Object.fromEntries(Object.entries(f.presentationQuantities.mapValue.fields).map(([k,v])=>[k,Number(v.integerValue??v.doubleValue)]))}]; }""", created['id'])
    assert len(stock) == 1 and stock[0]['quantity'] == 1550 and stock[0]['baseQuantity'] == 50 and stock[0]['presentationQuantities'] == {'closed30': 50}, stock

    page.goto(BASE + '/admin/productos')
    page.get_by_placeholder('Buscar por nombre, código de barra', exact=False).fill('Cajas cerradas auditoria')
    page.get_by_role('button', name='Editar', exact=True).click()
    dialog = page.get_by_role('dialog')
    expect(dialog.get_by_text('Abrir para vender unidades (compartir stock)', exact=True)).to_be_visible()
    expect(dialog.get_by_role('button', name='Quitar presentación', exact=True)).to_be_visible()
    expect(dialog.get_by_text('Permitir venta fraccionada', exact=True).locator('input')).to_be_disabled()
    page.screenshot(path=str(OUT / 'producto-1365.png'), full_page=True)
    page.set_viewport_size({'width': 390, 'height': 900})
    assert dialog.evaluate('el=>el.scrollWidth<=el.clientWidth')
    page.screenshot(path=str(OUT / 'producto-390.png'), full_page=True)

    # Separate POS context, preserving the confirmed sale if printing throws.
    pos_context = browser.new_context(viewport={'width': 1365, 'height': 900})
    pos_context.add_init_script("window.printCalls=[]; window.print=()=>{window.printCalls.push(document.querySelector('#ticket-print')?.textContent); window.dispatchEvent(new Event('afterprint'));};")
    pos = pos_context.new_page()
    pos.on('pageerror', lambda e: errors.append(str(e)))
    pos.route('**/test-ticket-logo.png*', lambda route: route.fulfill(body=PNG, content_type='image/png'))
    login(pos, 'pos')
    pos.goto(BASE + '/pos/caja')
    pos.get_by_role('button', name='Abrir caja e iniciar turno').click()
    pos.get_by_text('Turno activo (caja abierta)', exact=False).wait_for(timeout=30000)
    pos.goto(BASE + '/pos')
    pos.get_by_placeholder('Busca por nombre', exact=False).fill('TICKET-UN')
    expect(pos.get_by_role('button', name=re.compile('^Cajas cerradas auditoria'))).to_be_visible(timeout=30000)
    pos.get_by_placeholder('Busca por nombre', exact=False).press('Enter')
    expect(pos.get_by_role('textbox', name='Cantidad de Cajas cerradas auditoria', exact=True)).to_have_value('1')
    pos.get_by_role('button', name='Nota de Venta', exact=True).click()
    pos.get_by_role('button', name='Yape', exact=True).click()
    pos.get_by_role('button', name='Cobrar S/ 0.50', exact=True).click()
    pos.get_by_text('Venta Emitida con Éxito', exact=True).wait_for(timeout=30000)
    pos.wait_for_function('window.printCalls.length===1')
    expect(pos.get_by_role('button', name='Imprimir de nuevo', exact=True)).to_be_enabled()
    pos.get_by_role('button', name='Imprimir de nuevo', exact=True).click()
    pos.wait_for_function('window.printCalls.length===2')
    pos.get_by_role('button', name='Nueva Venta', exact=True).click()
    pos.get_by_placeholder('Busca por nombre', exact=False).fill('TICKET-UN')
    expect(pos.get_by_role('button', name=re.compile('^Cajas cerradas auditoria'))).to_be_visible(timeout=30000)
    pos.get_by_placeholder('Busca por nombre', exact=False).press('Enter')
    expect(pos.get_by_role('textbox', name='Cantidad de Cajas cerradas auditoria', exact=True)).to_have_value('1')
    pos.evaluate("() => { window.print=()=>{throw new Error('Impresora desconectada')}; }")
    pos.get_by_role('button', name='Nota de Venta', exact=True).click()
    pos.get_by_role('button', name='Yape', exact=True).click()
    pos.get_by_role('button', name='Cobrar S/ 0.50', exact=True).click()
    pos.get_by_text('Venta Emitida con Éxito', exact=True).wait_for(timeout=30000)
    expect(pos.get_by_text('La venta está registrada.', exact=False)).to_be_visible()
    expect(pos.get_by_role('button', name='Imprimir de nuevo', exact=True)).to_be_enabled()
    assert not pos.evaluate("Object.keys(localStorage).some(k=>k.startsWith('denzoz_pending_sale_v1_'))")
    assert not errors, errors
    print('PASS: diseñador responsive, reglas reales, logo lento/roto, ingreso 1550 separado, impresión automática/reimpresión/fallo sin afectar venta.')
    browser.close()



