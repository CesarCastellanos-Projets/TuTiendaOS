import os
from playwright.sync_api import sync_playwright, expect

base_url = os.environ.get('POS_TEST_BASE_URL', 'http://127.0.0.1:5174')
if not base_url.startswith('http://127.0.0.1:'):
    raise RuntimeError('Solo se permite el servidor local con emuladores.')

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=os.environ['PLAYWRIGHT_CHROMIUM_EXECUTABLE'])
    page = browser.new_page(viewport={'width': 1365, 'height': 900})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(base_url)
    page.wait_for_load_state('networkidle')
    assert page.evaluate("async () => (await import('/src/lib/firebase.ts')).firebaseConfig.projectId") == 'demo-denzoz-ops'
    page.locator('input[type=email]').fill('pos-ui@example.com')
    page.locator('input[type=password]').fill('UiTest123!')
    page.get_by_role('button', name='Ingresar al Sistema').click()
    page.wait_for_url('**/pos')
    field = page.get_by_role('combobox', name='Buscar productos')
    field.fill('Plumones cerrados')
    page.get_by_role('option').first.get_by_role('button').click()
    dialog = page.get_by_role('dialog', name='Plumones cerrados', exact=True)
    dialog.get_by_role('button', name='Unidad base', exact=False).click()
    loose = page.get_by_role('textbox', name='Cantidad de Plumones cerrados', exact=True)
    for invalid in ['0.5', '11']:
        loose.fill(invalid)
        loose.press('Enter')
        expect(loose).to_have_value('1')
    loose.fill('10')
    loose.press('Enter')
    expect(loose).to_have_value('10')
    field.fill('')
    field.focus()
    page.keyboard.type('MARK-BOX', delay=5)
    page.keyboard.press('Enter')
    box = page.get_by_role('textbox', name='Cantidad de Plumones cerrados (CJA x12)', exact=True)
    expect(box).to_have_value('1')
    for invalid in ['0.5', '3']:
        box.fill(invalid)
        box.press('Enter')
        expect(box).to_have_value('1')
    box.fill('2')
    box.press('Enter')
    expect(box).to_have_value('2')
    expect(loose).to_have_value('10')
    page.goto(base_url + '/pos/reposicion')
    search = page.get_by_placeholder('Buscar por nombre o código de cualquier presentación…')
    search.fill('Plumones cerrados')
    page.get_by_role('button', name='Plumones cerrados', exact=False).filter(has_text='Unidad base').click()
    page.locator('#req-MARKERS-base').fill('10')
    search.fill('Plumones cerrados')
    page.get_by_role('button', name='Plumones cerrados', exact=False).filter(has_text='Caja sellada').click()
    page.locator('#req-MARKERS-caja12').fill('2')
    page.get_by_role('button', name='Enviar solicitud (2)', exact=True).click()
    expect(page.get_by_text('Solicitud enviada al administrador', exact=True)).to_be_visible(timeout=30000)
    assert not errors, errors
    print('Stock mixto UI: unidades enteras, cajas completas, carrito con saldos independientes y reposición en dos líneas.')
    browser.close()
