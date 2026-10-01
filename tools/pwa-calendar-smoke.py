import json
import os
from playwright.sync_api import sync_playwright

url = 'http://127.0.0.1:5175'
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=os.environ['PLAYWRIGHT_CHROMIUM_EXECUTABLE'])
    context = browser.new_context(permissions=['notifications'])
    context.route('**/*google*/**', lambda route: route.abort())
    page = context.new_page()
    page.goto(url)
    page.wait_for_load_state('networkidle')
    page.evaluate('async () => { await navigator.serviceWorker.ready; }')
    worker = context.service_workers[0]
    assert worker.url.endswith('/sw.js'), worker.url
    page.reload()
    page.wait_for_load_state('networkidle')
    assert page.evaluate('!!navigator.serviceWorker.controller')
    # La ruta de calendario conserva la petición al pasar por el inicio de sesión.
    page.goto(url + '/?calendar=1')
    page.wait_for_url('**/login?calendar=1')
    context.set_offline(True)
    page.reload()
    page.get_by_role('button', name='Ingresar al Sistema').wait_for()
    context.set_offline(False)
    # Evento push sintético con todas las ventanas de la app cerradas.
    helper = context.new_page()
    cdp = context.new_cdp_session(helper)
    registrations = []
    cdp.on('ServiceWorker.workerRegistrationUpdated', lambda event: registrations.extend(event['registrations']))
    cdp.send('ServiceWorker.enable')
    page.close()
    helper.wait_for_timeout(1000)
    registration = next(item for item in registrations if item['scopeURL'] == url + '/' and not item['isDeleted'])
    data = json.dumps({'from': 'calendar-test', 'fcmMessageId': 'smoke-test', 'data': {'kind': 'calendar', 'notificationId': 'calendar-smoke-test'}})
    cdp.send('ServiceWorker.deliverPushMessage', {'origin': url, 'registrationId': registration['registrationId'], 'data': data})
    helper.wait_for_timeout(1500)
    notifications = worker.evaluate("async () => (await self.registration.getNotifications()).map(n => ({title:n.title,body:n.body,tag:n.tag}))")
    assert any(item['tag'] == 'calendar-smoke-test' for item in notifications), notifications
    assert all('alquiler' not in item['body'].lower() for item in notifications)
    print('PWA verificada: instalación del worker, navegación offline, enlace a calendario y push sintético con la app cerrada.')
    browser.close()
