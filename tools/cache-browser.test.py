import json
import os
import subprocess
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
ORIGIN = 'http://127.0.0.1:5188'
NODE = os.environ.get('DENZOZ_TEST_NODE', 'node')
ENV = {**os.environ, 'FIRESTORE_EMULATOR_HOST': '127.0.0.1:8080', 'FIREBASE_AUTH_EMULATOR_HOST': '127.0.0.1:9099'}

def fixture(action, store, quantity='99'):
    subprocess.run([NODE, str(ROOT / 'tools/cache-browser-fixture.mjs'), action, store, quantity], env=ENV, check=True, capture_output=True, timeout=120)

def prepare(page, store):
    page.route('**/src/main.tsx*', lambda route: route.fulfill(status=200, content_type='application/javascript', body=''))
    if os.environ.get('DENZOZ_TEST_DEBUG') == '1':
        def instrument(route):
            response = route.fetch()
            source = response.text().replace('const updates = snapshot.docChanges()', 'console.log("REPO", snapshot.metadata.fromCache, snapshot.size, JSON.stringify(snapshot.docs[0]?.data()), snapshot.docChanges().length); const updates = snapshot.docChanges()')
            source = source.replace('listeners.forEach((listener) => listener(state));', 'console.log("PUBLISH", options.key, listeners.size, state.rows[0]?.quantity); listeners.forEach((listener) => listener(state));')
            source = source.replace('rows.set(id, row);', 'if(id === "P00000") console.log("APPLY", JSON.stringify(row)); rows.set(id, row);')
            route.fulfill(response=response, body=source)
        page.route('**/src/lib/live-collection.ts*', instrument)
    page.goto(ORIGIN)
    page.wait_for_load_state('networkidle')
    assert page.locator('#root').count() == 1
    page.evaluate('''async (store) => {
      const firebaseSource = await (await fetch('/src/lib/firebase.ts')).text();
      const authPath = firebaseSource.match(/from "([^"]*firebase_auth[^\"]*)"/)[1];
      const firestorePath = firebaseSource.match(/from "([^"]*firebase_firestore[^\"]*)"/)[1];
      const f = await import('/src/lib/firebase.ts');
      window.firestoreTest = await import(firestorePath);
      await (await import(authPath)).signInWithEmailAndPassword(f.auth, 'cache-browser@example.com', 'LocalTest123!');
      window.testDb = f.db;
      window.directSnapshots = [];
      window.testCache = (await import('/src/lib/catalog-cache.ts')).localDb;
      const repository = await import('/src/lib/stock-repository.ts');
      window.testRepository = repository.storeCatalogRepository('cache-browser', store);
      window.sameRepository = window.testRepository === repository.storeCatalogRepository('cache-browser', store);
      window.testState = null;
      window.stopOne = window.testRepository.subscribe(s => window.testState = s);
      window.stopTwo = window.testRepository.subscribe(() => {});
    }''', store)

results = []
with sync_playwright() as p:
    browser = p.chromium.launch(channel=os.environ.get('DENZOZ_TEST_BROWSER', 'msedge'), headless=True)
    context = browser.new_context()
    context.route('**/*', lambda route: route.continue_() if route.request.url.startswith(('http://127.0.0.1:', 'http://localhost:', 'data:', 'blob:')) else route.abort())
    page = context.new_page()
    page.on('console', lambda message: print('BROWSER:', message.text, flush=True) if message.type == 'error' or os.environ.get('DENZOZ_TEST_DEBUG') == '1' else None)
    page.on('pageerror', lambda error: print('PAGE:', str(error), flush=True))
    page.set_default_timeout(60000)
    try:
        for count in [int(value) for value in os.environ.get('DENZOZ_TEST_COUNTS', '50,500,5000').split(',')]:
            store = f'S{count}'
            fixture('seed', store)
            print('Seeded', store, flush=True)
            start = time.monotonic()
            prepare(page, store)
            page.wait_for_function('(count) => window.testState?.rows.length === count && !window.testState.error', arg=count)
            initial_ms = round((time.monotonic() - start) * 1000)
            print('Loaded', store, initial_ms, flush=True)
            page.evaluate('() => { window.stopOne(); window.stopOne = window.testRepository.subscribe(s => window.testState = s); }')
            assert page.evaluate('window.sameRepository')
            fixture('burst', store)
            print('Burst committed', store, flush=True)
            changed = min(count, 500)
            page.wait_for_function('(n) => window.testState.rows.filter(r => r.quantity === 99).length === n && !window.testState.error', arg=changed, timeout=15000)
            page.evaluate('async () => { await window.firestoreTest.disableNetwork(window.testDb); }')
            fixture('burst', store, '98')
            page.evaluate('async () => { await window.firestoreTest.enableNetwork(window.testDb); window.dispatchEvent(new Event("online")); }')
            page.wait_for_function('(n) => window.testState.rows.filter(r => r.quantity === 98).length === n && !window.testState.error', arg=changed)
            page.wait_for_function('''async (store) => {
              const checkpoint = await window.testCache.catalogMeta.get(`sync-v2:stocks:cache-browser:${store}`);
              const rows = await window.testCache.products.where('[tenantId+locationId]').equals(['cache-browser', store]).toArray();
              return checkpoint?.cursor && rows.filter(r => r.quantity === 98).length === Math.min(Number(store.slice(1)), 500);
            }''', arg=store)
            page.evaluate('window.stopOne(); window.stopTwo()')
            prepare(page, store)
            page.wait_for_function('(n) => window.testState?.rows.length === n && window.testState.rows.filter(r => r.quantity === 98).length === Math.min(n,500) && !window.testState.error', arg=count)
            results.append({'products': count, 'initial_ms_local': initial_ms, 'same_commit_burst': changed, 'reconnection': True, 'indexeddb_reload': True})
        print(json.dumps({'local_emulators_only': True, 'cases': results}, indent=2))
    except Exception:
        print('STATE:', page.evaluate('''() => ({ error: window.testState?.error, offline: window.testState?.offline,
            actual: window.testRepository.get().rows.slice(0,2), count: window.testState?.rows.length, sample: window.testState?.rows.slice(0, 2), direct: window.directSnapshots })'''), flush=True)
        raise
    finally:
        browser.close()
