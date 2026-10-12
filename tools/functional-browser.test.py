import os
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent.parent
ENV = {**os.environ, 'FIRESTORE_EMULATOR_HOST': '127.0.0.1:8080', 'FIREBASE_AUTH_EMULATOR_HOST': '127.0.0.1:9099'}
ORIGIN = 'http://127.0.0.1:5188'
subprocess.run(['node', str(ROOT / 'tools/functional-browser-fixture.mjs')], env=ENV, check=True, timeout=60)

with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', headless=True)
    for role in ['pos', 'trabajador', 'admin']:
        context = browser.new_context(viewport={'width': 1200, 'height': 900})
        context.route('**/*', lambda route: route.continue_() if route.request.url.startswith(('http://127.0.0.1:', 'http://localhost:', 'data:', 'blob:')) else route.abort())
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: (errors.append(str(error)), print(error.stack, flush=True)))
        page.goto(ORIGIN + '/login')
        page.add_style_tag(content='.firebase-emulator-warning { pointer-events: none; }')
        page.get_by_label('Correo electrónico', exact=True).fill(f'functional-{role}@example.com')
        page.get_by_label('Contraseña', exact=True).fill('LocalTest123!')
        page.get_by_role('button', name='Ingresar', exact=False).click()
        path = {'pos': '/pos', 'trabajador': '/w', 'admin': '/admin'}[role]
        expect(page).to_have_url(ORIGIN + path, timeout=45000)
        if role != 'admin':
            bell = page.get_by_role('button', name='Notificaciones:', exact=False)
            expect(bell).to_be_visible(timeout=30000)
            bell.click()
            inbox = page.get_by_role('dialog', name='Notificaciones', exact=True)
            expect(inbox.get_by_text('Lapicero de prueba', exact=True)).to_be_visible()
            expect(inbox.get_by_text('UN: S/ 1.50 → S/ 2.00', exact=True)).to_be_visible()
            inbox.get_by_role('button', name='Marcar leído', exact=True).click()
            expect(inbox.get_by_role('button', name='Leído', exact=True)).to_be_visible()
            inbox.get_by_role('button', name='Cerrar modal').click()
        if role == 'pos':
            product = page.get_by_role('button', name='Seleccionar Lapicero de prueba', exact=True)
            expect(product).to_be_enabled(timeout=30000)
            product.click()
            stock = page.get_by_role('dialog', name='Stock en tiendas y almacenes', exact=True)
            expect(stock.get_by_text('Almacén: Central', exact=True)).to_be_visible(timeout=30000)
            expect(stock.get_by_text('Docena cerrada: 2 disponibles', exact=True)).to_be_visible()
            expect(stock.get_by_text('Sin stock disponible en ninguna ubicación.', exact=True)).to_have_count(0)
            stock.get_by_role('button', name='Costo y proveedor', exact=True).click()
            expect(stock.get_by_text('Proveedor privado', exact=False)).to_be_visible(timeout=30000)
            page.screenshot(path=str(ROOT / 'docs/fixtures/funcional-pos-stock-desktop.png'))
            page.set_viewport_size({'width': 390, 'height': 900})
            page.screenshot(path=str(ROOT / 'docs/fixtures/funcional-pos-stock-mobile.png'))
            page.set_viewport_size({'width': 1200, 'height': 900})
            stock.get_by_role('button', name='Cerrar modal').click()
            page.get_by_role('button', name='+ Agregar DNI / RUC', exact=True).click()
            client = page.get_by_role('dialog', name='Identificación del Cliente', exact=True)
            client.get_by_label('Nombre o razón social').fill('Ana Cliente')
            client.get_by_role('button', name='Aplicar datos manualmente').click()
            expect(page.locator('.sale-cart').get_by_text('Ana Cliente', exact=True)).to_be_visible()
            page.get_by_role('button', name='Cotizaciones', exact=True).click()
            quotes = page.get_by_role('dialog', name='Cargar Cotización de Útiles / Pedido', exact=True)
            quotes.get_by_label('Buscar cotización').fill('cesar')
            expect(quotes.get_by_text('COT-PRUEBA', exact=True)).to_be_visible(timeout=30000)
            quotes.get_by_role('button', name='Cerrar modal').click()
        elif role == 'trabajador':
            page.goto(ORIGIN + '/w/cotizaciones')
            page.get_by_role('button', name='Historial', exact=False).click()
            page.get_by_label('Buscar cotización').fill('999123456')
            expect(page.get_by_text('COT-PRUEBA', exact=True)).to_be_visible(timeout=30000)
            expect(page.get_by_role('button', name='Eliminar cotización', exact=True)).to_be_visible()
            expect(page.get_by_text('Proveedor privado', exact=False)).to_have_count(0)
        else:
            page.goto(ORIGIN + '/admin/usuarios')
            page.get_by_role('row').filter(has_text='functional-trabajador@example.com').get_by_role('button', name='Permisos y cuenta', exact=True).click()
            settings = page.get_by_role('dialog', name='Administrar:', exact=False)
            settings.get_by_label('Restringir horario (hora de Perú)').check()
            expect(settings.get_by_label('Desde', exact=True)).to_be_visible()
            expect(settings.get_by_label('Hasta', exact=True)).to_be_visible()
            settings.get_by_role('button', name='Cerrar modal').click()
            page.get_by_role('row').filter(has_text='functional-admin@example.com').get_by_role('button', name='Permisos y cuenta', exact=True).click()
            settings.get_by_role('button', name='Cambiar contraseña', exact=True).click()
            password = page.get_by_role('dialog', name='Cambiar contraseña', exact=True)
            expect(password.get_by_label('Contraseña actual', exact=True)).to_be_visible()
            expect(password.get_by_label('Nueva contraseña', exact=True)).to_be_visible()
            password.get_by_role('button', name='Cerrar modal').click()
            settings.get_by_role('button', name='Cerrar modal').click()
            page.goto(ORIGIN + '/admin/productos')
            page.get_by_role('button', name='Nuevo producto', exact=True).click()
            new_product = page.get_by_role('dialog', name='Nuevo producto', exact=True)
            new_product.get_by_role('button', name='Avanzado: costo y proveedor').click()
            new_product.get_by_label('Registrar datos de compra', exact=True).check()
            expect(new_product.get_by_label('Costo de compra S/', exact=True)).to_be_visible()
            expect(new_product.get_by_label('Proveedor', exact=True)).to_be_visible()
            new_product.get_by_role('button', name='Cerrar modal').click()
        for width in [320, 390, 768, 1200]:
            page.set_viewport_size({'width': width, 'height': 900})
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), (role, width)
        if role == 'pos':
            subprocess.run(['node', str(ROOT / 'tools/functional-browser-fixture.mjs'), 'block'], env=ENV, check=True, timeout=60)
            expect(page.get_by_role('heading', name='Horario de acceso', exact=True)).to_be_visible(timeout=30000)
            expect(page.get_by_role('button', name='Seleccionar Lapicero de prueba')).to_have_count(0)
            page.evaluate('Date.now = () => 1; window.dispatchEvent(new Event("focus"))')
            expect(page.get_by_role('heading', name='Horario de acceso', exact=True)).to_be_visible()
            subprocess.run(['node', str(ROOT / 'tools/functional-browser-fixture.mjs')], env=ENV, check=True, timeout=60)
        assert not errors, errors
        context.close()
    browser.close()
print('Pantallas funcionales verificadas en admin, POS y trabajador, incluyendo móvil y bloqueo por horario.')
