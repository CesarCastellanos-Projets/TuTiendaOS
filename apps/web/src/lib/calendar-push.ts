import { httpsCallable } from 'firebase/functions';
import { firebaseApp, functions } from './firebase';
import { useAuth } from './auth';
import { canReceiveNotifications } from './notification-permissions';

let registered: { token: string; uid: string; confirmed: boolean; confirmedAt: number; permissions: string } | null = null;
let pending: Promise<void> | null = null;
let generation = 0;
export async function enableCalendarPush(requestPermission = true): Promise<void> {
  if (pending) {
    await pending.catch(() => undefined);
    return enableCalendarPush(requestPermission);
  }
  const session = useAuth.getState();
  if (!session.user || !canReceiveNotifications(session.profile))
    throw new Error('Tu cuenta no tiene acceso a estas notificaciones.');
  const uid = session.user.uid;
  const permissions = `${session.profile?.role}:${session.profile?.storeAccess}:${session.profile?.canManageCalendar}`;
  if (registered?.confirmed && registered.uid === uid && registered.permissions === permissions
    && Date.now() - registered.confirmedAt < 12 * 3600000
    && 'Notification' in window && Notification.permission === 'granted') return;
  const revision = generation;
  pending = (async () => {
    if (!('Notification' in window) || !('serviceWorker' in navigator))
      throw new Error('Este navegador no admite notificaciones.');
    const key = import.meta.env.VITE_FIREBASE_VAPID_KEY;
    if (!key)
      throw new Error(
        'Las notificaciones fuera del sistema aún no están habilitadas. Contacta al administrador.'
      );
    if (import.meta.env.VITE_USE_EMULATORS === '1')
      throw new Error(
        'Los avisos externos se verifican en la app publicada. Los avisos internos sí están disponibles aquí.'
      );
    if (requestPermission && Notification.permission === 'default') await Notification.requestPermission();
    if (Notification.permission !== 'granted')
      throw new Error('Permite las notificaciones de este sitio en tu navegador.');
    const { getMessaging, getToken, isSupported } = await import('firebase/messaging');
    if (!(await isSupported())) throw new Error('Este navegador no admite notificaciones.');
    const worker = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Abre la app publicada para activar las notificaciones.')), 10000)
      )
    ]);
    const token = await getToken(getMessaging(firebaseApp), {
      vapidKey: key,
      serviceWorkerRegistration: worker
    });
    if (
      generation !== revision ||
      useAuth.getState().user?.uid !== uid ||
      !canReceiveNotifications(useAuth.getState().profile)
    ) {
      const { deleteToken } = await import('firebase/messaging');
      await deleteToken(getMessaging(firebaseApp)).catch(() => undefined);
      throw new Error('Tu sesión cambió. Vuelve a activar las notificaciones.');
    }
    registered = { token, uid, confirmed: false, confirmedAt: 0, permissions };
    await httpsCallable(functions, 'registerCalendarDevice', { timeout: 15000 })({ token });
    if (
      generation !== revision ||
      useAuth.getState().user?.uid !== uid ||
      !canReceiveNotifications(useAuth.getState().profile)
    )
      throw new Error('Tu sesión cambió. Vuelve a activar las notificaciones.');
    registered = { token, uid, confirmed: true, confirmedAt: Date.now(), permissions };
  })().finally(() => {
    pending = null;
  });
  return pending;
}

export async function disableCalendarPush(): Promise<void> {
  generation++;
  await pending?.catch(() => undefined);
  const device = registered;
  registered = null;
  if (!device) return;
  try {
    if (useAuth.getState().user?.uid === device.uid)
      await httpsCallable(functions, 'unregisterCalendarDevice', { timeout: 5000 })({ token: device.token });
  } finally {
    const { deleteToken, getMessaging } = await import('firebase/messaging');
    await deleteToken(getMessaging(firebaseApp)).catch(() => undefined);
  }
}
