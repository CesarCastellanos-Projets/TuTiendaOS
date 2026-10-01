import base64
import os
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('POS_TEST_BASE_URL', 'http://127.0.0.1:5174')
if not BASE.startswith('http://127.0.0.1:'):
    raise RuntimeError('Solo se permite el servidor local con emuladores.')
OUT = Path(os.environ['TEMP']) / 'denzoz-quotation-review'
OUT.mkdir(exist_ok=True)


def login(page, role):
    page.goto(BASE)
    assert page.evaluate("async () => (await import('/src/lib/firebase.ts')).firebaseConfig.projectId") == 'demo-denzoz-ops'
    page.locator('input[type=email]').fill(f'{role}-ui@example.com')
    page.locator('input[type=password]').fill('UiTest123!')
    page.get_by_role('button', name='Ingresar al Sistema').click()
    page.wait_for_url(lambda u: u.endswith('/admin' if role == 'admin' else '/w' if role == 'worker' else '/pos'))

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True, executable_path=os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE'))
    admin = browser.new_page(viewport={'width': 1365, 'height': 900})
    errors = []
    admin.on('pageerror', lambda error: errors.append(str(error)))
    login(admin, 'admin')
    admin.goto(BASE + '/admin/ingresos')
    parent = admin.get_by_role('heading', name='Ingreso de mercadería', exact=True).locator('..').bounding_box()
    main = admin.locator('main').bounding_box()
    assert abs(parent['x'] + parent['width']/2 - main['x'] - main['width']/2) < 2
    admin.get_by_placeholder('Buscar producto por nombre o código', exact=False).fill('MARK-BOX')
    admin.get_by_role('button', name=re.compile('^Plumones cerrados')).click()
    qty = admin.locator('input[type=number]')
    qty.fill('0'); qty.press('Backspace')
    expect(qty).to_have_value('')
    qty.press_sequentially('50'); expect(qty).to_have_value('50')
    admin.screenshot(path=str(OUT / 'ingreso-centrado.png'))
    admin.goto(BASE + '/admin/tickets')
    size = admin.get_by_label('Tamaño de texto', exact=True)
    size.fill(''); expect(size).to_have_value('')
    size.press_sequentially('1'); expect(size).to_have_value('1')
    size.press_sequentially('2'); expect(size).to_have_value('12')
    size.press('Tab'); expect(size).to_have_value('12')
    png = admin.evaluate("() => { const c=document.createElement('canvas'); c.width=240;c.height=80;const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,240,80);ctx.fillStyle='#253e68';ctx.font='bold 34px sans-serif';ctx.fillText('DEMO LOGO',12,52);return c.toDataURL('image/png').split(',')[1]; }")
    logo = OUT / 'logo-demo.png'; logo.write_bytes(base64.b64decode(png))
    admin.locator('input[type=file]').set_input_files(str(logo))
    expect(admin.get_by_alt_text('Logo cargado')).to_be_visible()
    admin.get_by_role('button', name='Guardar diseño', exact=True).click()
    admin.get_by_text('Diseño del ticket guardado', exact=True).wait_for(timeout=30000)

    worker = browser.new_page(viewport={'width': 1365, 'height': 900}, accept_downloads=True)
    worker.on('pageerror', lambda error: errors.append(str(error)))
    login(worker, 'worker')
    worker.goto(BASE + '/w/cotizaciones')
    search = worker.get_by_placeholder('Escribe el nombre o escanea código', exact=False)
    search.fill('MARK-BOX')
    worker.get_by_role('button', name=re.compile('Plumones cerrados')).first.click()
    q = worker.locator('input[type=number]')
    q.fill('0'); q.press('Backspace'); expect(q).to_have_value('')
    q.press_sequentially('2'); expect(q).to_have_value('2')
    worker.get_by_placeholder('Nombre del cliente o empresa', exact=True).fill('José Pérez')
    worker.get_by_role('button', name='Compartir PDF', exact=True).click()
    dialog = worker.get_by_role('dialog')
    expect(dialog.get_by_role('button', name='Descargar PDF', exact=True)).to_be_enabled(timeout=30000)
    assert not dialog.locator('iframe').get_attribute('src').startswith('http')
    with worker.expect_download() as download:
        dialog.get_by_role('button', name='Descargar PDF', exact=True).click()
    download.value.save_as(str(OUT / 'cotizacion.pdf'))
    worker.screenshot(path=str(OUT / 'cotizacion-dialogo.png'))
    for width in [390, 768, 1365]:
        worker.set_viewport_size({'width': width, 'height': 900})
        assert dialog.evaluate('el=>el.scrollWidth<=el.clientWidth'), width
    worker.evaluate("""() => { window.sharedFiles=[]; Object.defineProperty(navigator,'canShare',{configurable:true,value:({files})=>files.every(f=>f.type==='application/pdf')});Object.defineProperty(navigator,'share',{configurable:true,value:async({files})=>{window.sharedFiles=files.map(f=>({name:f.name,size:f.size,type:f.type}));}}); }""")
    dialog.get_by_role('button', name='Compartir PDF', exact=True).click()
    worker.wait_for_function('window.sharedFiles.length===1')
    assert worker.evaluate('window.sharedFiles[0].type') == 'application/pdf'
    assert worker.evaluate('window.sharedFiles[0].size') > 1000
    worker.evaluate("""() => { window.waOpened=0;window.waFocused=0;window.fakeWa={closed:false,location:{href:''},focus:()=>window.waFocused++,opener:window};window.open=(url,name)=>{window.waOpened++;window.waTarget=name;window.fakeWa.location.href=url;return window.fakeWa;}; }""")
    dialog.get_by_label('Número de WhatsApp (opcional)', exact=True).fill('952085118')
    dialog.get_by_role('button', name='WhatsApp Web', exact=True).click()
    dialog.get_by_role('button', name='WhatsApp Web', exact=True).click()
    assert worker.evaluate('window.waOpened') == 1
    assert worker.evaluate('window.waTarget') == 'denzoz-whatsapp'
    assert worker.evaluate('window.fakeWa.location.href') == 'https://web.whatsapp.com/send?phone=51952085118'
    assert worker.evaluate('window.waFocused') == 2
    worker.evaluate("() => { window.fakeWa.closed=true; window.open=()=>null; }")
    dialog.get_by_role('button', name='WhatsApp Web', exact=True).click()
    expect(dialog.get_by_text('El navegador bloqueó la ventana', exact=False)).to_be_visible()
    assert worker.evaluate("async()=> (await import('/src/lib/share-quotation.ts')).quotationWhatsAppUrl('+51 952 085 118',true)") == 'whatsapp://send?phone=51952085118'
    worker.evaluate("Object.defineProperty(navigator,'userAgent',{configurable:true,value:'Mozilla/5.0 (Android; Mobile)'})")
    assert worker.evaluate("async()=> (await import('/src/lib/share-quotation.ts')).quotationWhatsAppUrl('952085118')") == 'https://wa.me/51952085118'
    # Multi-page PDF with long rows retains every item and readable totals.
    pages = worker.evaluate("""async () => {
      const {createQuotationPdf}=await import('/src/lib/quotation-pdf.ts');
      const items=Array.from({length:90},(_,i)=>({productId:String(i),name:'Artículo de nombre largo '+i+' presentación caja cerrada de treinta unidades',unit:'CJA',presentationLabel:'Caja cerrada x30',qty:2,unitPrice:11.5,total:23,availableQty:10,isAvailable:true}));
      const f=await createQuotationPdf({items,clientName:'Cliente de prueba',storeName:'Tienda UI',note:'Entrega por coordinar',createdAt:Date.now()},{razonSocial:'Demo PDF',ruc:'20123456789'});
      return Array.from(new Uint8Array(await f.arrayBuffer()));
    }""")
    (OUT / 'cotizacion-multipagina.pdf').write_bytes(bytes(pages))
    assert not errors, errors
    print('PASS: campo vacío y edición normal, ingreso centrado, PDF con logo, compartir archivo nativo, reutilización controlada de ventana y rutas PC/móvil.')
    browser.close()
