/// <reference lib="webworker" />
import { initializeApp } from 'firebase/app';
import { getMessaging, onBackgroundMessage } from 'firebase/messaging/sw';
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { firebaseConfig } from './lib/firebase-config';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
clientsClaim();
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api/] }));
registerRoute(
  ({ request }) => request.destination === 'font',
  new CacheFirst({
    cacheName: 'fonts',
    plugins: [new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 31536000 })]
  })
);
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.stopImmediatePropagation();
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const client = clients.find((item) => new URL(item.url).origin === self.location.origin);
      if (client) {
        if (new URL(client.url).pathname === '/login') await client.navigate('/?calendar=1');
        else client.postMessage({ type: 'OPEN_CALENDAR' });
        await client.focus();
      } else await self.clients.openWindow('/?calendar=1');
    })()
  );
});
if ('PushManager' in self && 'Notification' in self && 'indexedDB' in self) {
  const messaging = getMessaging(initializeApp(firebaseConfig));
  onBackgroundMessage(messaging, async (payload) => {
    if (payload.data?.kind !== 'calendar') return;
    await self.registration.showNotification("D'ENZOZ · Calendario", {
      body: 'Tienes un recordatorio pendiente. Abre el calendario para revisarlo.',
      icon: '/icon.svg',
      badge: '/icon.svg',
      tag: payload.data.notificationId,
      data: { kind: 'calendar' }
    });
  });
}
