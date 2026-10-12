import json
import os
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
ORIGIN = 'http://127.0.0.1:5188'
ENV = {**os.environ, 'FIRESTORE_EMULATOR_HOST': '127.0.0.1:8080', 'FIREBASE_AUTH_EMULATOR_HOST': '127.0.0.1:9099'}
subprocess.run([os.environ.get('DENZOZ_TEST_NODE', 'node'), str(ROOT / 'tools/stage3-browser-fixture.mjs')], env=ENV, check=True, timeout=120)

with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', headless=True)
    context = browser.new_context(viewport={'width': 1200, 'height': 700})
    context.route('**/*', lambda route: route.continue_() if route.request.url.startswith(('http://127.0.0.1:', 'http://localhost:', 'data:', 'blob:')) else route.abort())
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.route('**/src/main.tsx*', lambda route: route.fulfill(status=200, content_type='application/javascript', body=''))
    page.goto(ORIGIN)
    page.wait_for_load_state('networkidle')
    page.add_style_tag(content='.firebase-emulator-warning { pointer-events: none; }')
    page.evaluate('''async () => {
      const source = await (await fetch('/src/lib/firebase.ts')).text();
      const f = await import('/src/lib/firebase.ts');
      const authSdk = await import(source.match(/from "([^\"]*firebase_auth[^\"]*)"/)[1]);
      const fs = await import(source.match(/from "([^\"]*firebase_firestore[^\"]*)"/)[1]);
      await authSdk.signInWithEmailAndPassword(f.auth, 'stage3-browser@example.com', 'LocalTest123!');
      window.testAuth = (await import('/src/lib/auth.ts')).useAuth;
      const profile = (await fs.getDoc(fs.doc(f.db, 'users', f.auth.currentUser.uid))).data();
      window.testAuth.setState({ user: f.auth.currentUser, profile, loading: false });
      window.testReact = (await import('/node_modules/.vite/deps/react.js')).default;
      window.testRoot = (await import('/node_modules/.vite/deps/react-dom_client.js')).default.createRoot(document.getElementById('root'));
      window.renderComponent = async (file, name) => {
        const Component = (await import(file))[name];
        window.testRoot.render(window.testReact.createElement(Component));
      };
      await window.renderComponent('/src/pages/pos/Receiving.tsx', 'ReceivingPage');
    }''')
    page.get_by_text('TR-99', exact=True).wait_for()
    assert page.get_by_role('button', name='Recibir mercadería', exact=True).count() == 100
    page.get_by_role('button', name='Siguiente', exact=True).click()
    page.get_by_text('TR-100', exact=True).wait_for()
    assert page.get_by_role('button', name='Recibir mercadería', exact=True).count() == 1
    page.get_by_role('button', name='Anterior', exact=True).click()
    page.get_by_text('TR-0', exact=True).wait_for()
    page.evaluate("window.renderComponent('/src/pages/admin/Adjustments.tsx', 'AdjustmentsPage')")
    page.get_by_text('Ajuste 20', exact=True).wait_for()
    assert page.locator('.adjustment-history li').count() == 20
    page.get_by_role('button', name='Siguiente', exact=True).click()
    page.get_by_text('Ajuste 0', exact=True).wait_for()
    assert page.locator('.adjustment-history li').count() == 1
    page.get_by_role('button', name='Cargar más ubicaciones', exact=True).click()
    page.locator('select').first.locator('option', has_text='Tienda 50').wait_for(state='attached')
    assert page.locator('select').first.locator('option').count() == 52

    # Storage simulado en el navegador: permite contar cuerpos y metadata sin URLs públicas.
    page.evaluate('''async () => {
      const module = await import('/src/components/IncidentPhoto.tsx');
      window.Photo = module.IncidentPhoto;
      window.photoPaths = ['one', 'two', 'three'].map(name => `tenants/stage3-browser/incidents/S000/user/${name}`);
      window.renderPhotos = (visible = false) => window.testRoot.render(window.testReact.createElement('div', null,
        window.testReact.createElement('div', { style: { height: visible ? 0 : 2000 } }),
        ...window.photoPaths.map(path => window.testReact.createElement(window.Photo, { key: path, path }))));
    }''')
    requests = []
    def photo_response(route):
        media = 'alt=media' in route.request.url
        requests.append('blob' if media else 'metadata')
        if media:
            route.fulfill(status=200, content_type='image/png', body=bytes.fromhex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b4944415478da636000020000050001a5f645400000000049454e44ae426082'))
        else:
            route.fulfill(status=200, content_type='application/json', body=json.dumps({'name': 'test', 'bucket': 'demo', 'size': '68', 'contentType': 'image/png'}))
    page.route('http://127.0.0.1:9199/**', photo_response)
    page.evaluate('window.renderPhotos()')
    page.wait_for_function('document.querySelectorAll("#root p").length === 3')
    assert requests == []
    page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
    page.wait_for_function('document.querySelectorAll("#root img").length === 3')
    assert requests.count('blob') == 3
    page.evaluate('window.testRoot.render(null)')
    page.wait_for_function('document.getElementById("root").childElementCount === 0')
    page.evaluate('window.renderPhotos(true)')
    page.wait_for_function('document.querySelectorAll("#root img").length === 3')
    assert requests.count('blob') == 3
    assert requests.count('metadata') == 3
    assert not errors, errors
    print(json.dumps({'local_only': True, 'pending_transfers': 101, 'location_options': 51, 'adjustments_despite_recent_sales': 21,
        'photos_outside_viewport': 0, 'photo_body_downloads': 3, 'authorized_metadata_checks_on_remount': 3}))
    browser.close()
