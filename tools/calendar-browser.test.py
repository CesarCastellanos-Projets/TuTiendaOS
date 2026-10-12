import os
import subprocess
from pathlib import Path
from datetime import datetime
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent.parent
ORIGIN = 'http://127.0.0.1:5188'
ENV = {**os.environ, 'FIRESTORE_EMULATOR_HOST': '127.0.0.1:8080', 'FIREBASE_AUTH_EMULATOR_HOST': '127.0.0.1:9099'}

with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', headless=True)
    for role in ['admin', 'pos']:
        subprocess.run(['node', str(ROOT / 'tools/calendar-browser-fixture.mjs')], env=ENV, check=True, timeout=60)
        context = browser.new_context(viewport={'width': 1200, 'height': 900})
        context.route('**/*', lambda route: route.continue_() if route.request.url.startswith(('http://127.0.0.1:', 'http://localhost:', 'data:', 'blob:')) else route.abort())
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: (errors.append(str(error)), print(error.stack, flush=True)))
        page.clock.set_fixed_time(datetime.fromisoformat('2030-01-30T23:50:00-05:00'))
        page.route('**/src/main.tsx*', lambda route: route.fulfill(status=200, content_type='application/javascript', body=''))
        page.goto(ORIGIN)
        page.wait_for_load_state('networkidle')
        page.add_style_tag(content='.firebase-emulator-warning { pointer-events: none; }')
        page.evaluate('''async (role) => {
          await import('/src/styles/index.css');
          const source = await (await fetch('/src/lib/firebase.ts')).text();
          const f = await import('/src/lib/firebase.ts');
          if (f.firebaseConfig.projectId !== 'demo-denzoz-ops') throw new Error('Solo proyecto demo.');
          const authSdk = await import(source.match(/from "([^\"]*firebase_auth[^\"]*)"/)[1]);
          const fs = await import(source.match(/from "([^\"]*firebase_firestore[^\"]*)"/)[1]);
          await authSdk.signInWithEmailAndPassword(f.auth, `calendar-${role}@example.com`, 'LocalTest123!');
          const profile = (await fs.getDoc(fs.doc(f.db, 'users', f.auth.currentUser.uid))).data();
          (await import('/src/lib/auth.ts')).useAuth.setState({ user: f.auth.currentUser, profile, loading: false });
          const React = (await import('/node_modules/.vite/deps/react.js')).default;
          const root = (await import('/node_modules/.vite/deps/react-dom_client.js')).default.createRoot(document.getElementById('root'));
          const bellSource = await (await fetch('/src/components/calendar/CalendarBell.tsx')).text();
          const { MemoryRouter } = await import(bellSource.match(/from "([^\"]*react-router-dom[^\"]*)"/)[1]);
          const { CalendarBell } = await import('/src/components/calendar/CalendarBell.tsx');
          const file = role === 'admin' ? '/src/pages/admin/Calendar.tsx' : '/src/pages/pos/Calendar.tsx';
          const module = await import(file);
          root.render(React.createElement(MemoryRouter, null,
            React.createElement(CalendarBell), React.createElement(module[role === 'admin' ? 'AdminCalendar' : 'PosCalendar'])));
        }''', role)
        expect(page.get_by_role('heading', name='Evento today', exact=True)).to_be_visible(timeout=30000)
        expect(page.get_by_role('heading', name='Evento expired', exact=True)).to_have_count(0)
        page.get_by_label('Mostrar finalizados', exact=True).check()
        expect(page.get_by_role('heading', name='Evento expired', exact=True)).to_be_visible()
        expect(page.locator('article').filter(has_text='Evento expired').get_by_text('Vencido', exact=True)).to_be_visible()
        page.get_by_label('Mostrar finalizados', exact=True).uncheck()
        bell = page.get_by_role('button', name='Recordatorios del calendario, 1 pendientes', exact=True)
        expect(bell).to_be_visible()
        bell.click()
        inbox = page.get_by_role('dialog', name='Recordatorios del calendario', exact=True)
        expect(inbox.get_by_text('Aviso today', exact=True)).to_be_visible()
        expect(inbox.get_by_text('Aviso expired', exact=True)).to_have_count(0)
        inbox.get_by_role('button', name='Cerrar modal', exact=True).click()
        repeated = page.locator('article').filter(has_text='Evento repeat')
        expect(repeated.get_by_text('Cada día', exact=False)).to_be_visible()
        repeated.get_by_role('button', name='Completar esta fecha', exact=True).click()
        expect(page.get_by_text('Fecha completada. La próxima fecha queda pendiente.', exact=True)).to_be_visible(timeout=30000)
        expect(repeated).to_have_count(0)
        page.get_by_role('button', name='Mes siguiente', exact=True).click()
        repeated.get_by_role('button', name='Finalizar repetición', exact=True).click()
        expect(page.get_by_text('Repetición finalizada. No recibirás más avisos de este evento.', exact=True)).to_be_visible(timeout=30000)
        expect(repeated).to_have_count(0)
        page.get_by_label('Mostrar finalizados', exact=True).check()
        expect(repeated.get_by_text('completado', exact=True)).to_be_visible()
        page.get_by_label('Mostrar finalizados', exact=True).uncheck()
        page.get_by_role('button', name='Mes anterior', exact=True).click()
        page.clock.set_fixed_time(datetime.fromisoformat('2030-01-31T00:01:00-05:00'))
        page.evaluate("window.dispatchEvent(new Event('focus'))")
        expect(page.get_by_role('heading', name='Evento today', exact=True)).to_have_count(0)
        expect(page.get_by_role('button', name='Recordatorios del calendario', exact=True)).to_be_visible()
        expect(page.get_by_text('Recordatorio: Aviso today', exact=True)).to_have_count(0)
        page.get_by_label('Mostrar finalizados', exact=True).check()
        expect(page.locator('article').filter(has_text='Evento today').get_by_text('Vencido', exact=True)).to_be_visible()
        for width in [320, 390, 768, 1200]:
            page.set_viewport_size({'width': width, 'height': 900})
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), width
        assert not errors, errors
        context.close()
    browser.close()
print('Calendario admin/POS verificado: finalizados, repetición y avisos al pasar medianoche en Perú.')
