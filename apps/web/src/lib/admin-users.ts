import { initializeApp, getApps } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, updateProfile, signOut } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { db, firebaseConfig } from './firebase';
import type { NewUserPayload } from '../types';

/**
 * Crea un usuario en Firebase Authentication y registra su perfil en Firestore.
 * Utiliza una app secundaria de Firebase para que el administrador actual
 * NO pierda su sesión activa al registrar una nueva cuenta.
 */
export async function createSystemUser(payload: NewUserPayload): Promise<{ uid: string }> {
  const secondaryAppName = 'DenzozUserAdminApp';
  const secondaryApp =
    getApps().find((a) => a.name === secondaryAppName) ||
    initializeApp(firebaseConfig, secondaryAppName);
  const secondaryAuth = getAuth(secondaryApp);

  let newUid = '';
  try {
    const userCred = await createUserWithEmailAndPassword(
      secondaryAuth,
      payload.email,
      payload.password
    );
    newUid = userCred.user.uid;

    if (payload.displayName) {
      await updateProfile(userCred.user, { displayName: payload.displayName });
    }
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === 'auth/email-already-in-use') {
      throw new Error('El correo electrónico ya está registrado.');
    }
    if (code === 'auth/invalid-email') {
      throw new Error('El formato del correo electrónico es inválido.');
    }
    if (code === 'auth/weak-password') {
      throw new Error('La contraseña es muy débil. Usa al menos 6 caracteres.');
    }
    throw err instanceof Error ? err : new Error('No se pudo registrar en Firebase Auth');
  } finally {
    // Cerramos la sesión secundaria inmediatamente para mantenerla limpia
    await signOut(secondaryAuth).catch(() => {});
  }

  // Guardar el perfil en Firestore con la sesión y permisos del Administrador actual
  await setDoc(doc(db, 'users', newUid), {
    displayName: payload.displayName,
    email: payload.email,
    role: payload.role,
    storeId: payload.storeId ?? null,
    active: true,
    createdAt: Date.now()
  });

  return { uid: newUid };
}
