import { create } from 'zustand';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { auth, db } from './firebase';
import type { UserProfile } from '../types';

interface AuthState {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  error: string | null;
  init: () => () => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setProfileStoreId: (storeId: string) => void;
}

let pendingProfile: { uid: string; promise: Promise<UserProfile | null> } | null = null;

function sessionStore(profile: UserProfile, uid: string): string | null {
  if (profile.role !== 'pos' || profile.storeAccess !== 'all') return profile.storeId ?? null;
  const selected = sessionStorage.getItem(`active-store:${profile.tenantId}:${uid}`);
  return selected && /^[\w-]{1,128}$/.test(selected) ? selected : profile.storeId ?? null;
}

function readProfile(user: User): Promise<UserProfile | null> {
  if (pendingProfile?.uid === user.uid) return pendingProfile.promise;
  const promise = Promise.all([
    getDoc(doc(db, 'users', user.uid)),
    user.getIdTokenResult()
  ])
    .then(([snapshot, token]) => {
      if (!snapshot.exists()) return null;
      const profile = snapshot.data() as UserProfile;
      const resolved = {
        ...profile,
        storeAccess: profile.storeAccess === 'all' && token.claims.posStoreAccess === 'all' ? 'all' : 'assigned',
        canOverridePrices: profile.storeAccess === 'all' && token.claims.posStoreAccess === 'all' && token.claims.canOverridePrices === true,
        canManageCalendar: profile.role === 'admin' || (profile.role === 'pos' && (profile.canManageCalendar === true || (profile.canManageCalendar === undefined && profile.storeAccess === 'all')))
      } satisfies UserProfile;
      return { ...resolved, storeId: sessionStore(resolved, user.uid) };
    })
    .finally(() => {
      if (pendingProfile?.promise === promise) pendingProfile = null;
    });
  pendingProfile = { uid: user.uid, promise };
  return promise;
}

export const useAuth = create<AuthState>((set) => {
  async function establishSession(user: User): Promise<void> {
    const profile = await readProfile(user);
    if (!profile) throw new Error('El usuario no tiene un perfil configurado.');
    if (!profile.active) {
      await signOut(auth);
      throw new Error('Este usuario está desactivado.');
    }
    set({ user, profile, loading: false, error: null });
  }

  return {
    user: null,
    profile: null,
    loading: true,
    error: null,
    init: () => {
      let active = true;
      let revision = 0;
      let stopProfile: (() => void) | undefined;
      const unsubscribe = onAuthStateChanged(auth, async (user) => {
        const currentRevision = ++revision;
        stopProfile?.();
        stopProfile = undefined;
        if (!user) {
          if (active) set({ user: null, profile: null, loading: false, error: null });
          return;
        }

        if (active) set({ loading: true, error: null });
        try {
          const profile = await readProfile(user);
          if (!active || currentRevision !== revision) return;
          if (!profile) {
            await signOut(auth);
            set({ user: null, profile: null, loading: false, error: 'El usuario no tiene un perfil configurado.' });
            return;
          }
          if (!profile.active) {
            await signOut(auth);
            set({ user: null, profile: null, loading: false, error: 'Este usuario está desactivado.' });
            return;
          }
          set({ user, profile, loading: false, error: null });
          stopProfile = onSnapshot(doc(db, 'users', user.uid), (snapshot) => {
            if (!active || currentRevision !== revision) return;
            const current = snapshot.data() as UserProfile | undefined;
            if (!current?.active || current.tenantId !== profile.tenantId || current.role !== profile.role) { void signOut(auth); return; }
            set({ profile: { ...profile, ...current, storeId: sessionStore({ ...current, storeAccess: profile.storeAccess === 'all' && current.storeAccess === 'all' ? 'all' : 'assigned' }, user.uid), storeAccess: profile.storeAccess === 'all' && current.storeAccess === 'all' ? 'all' : 'assigned', canOverridePrices: profile.canOverridePrices && current.storeAccess === 'all',
              canManageCalendar: current.role === 'admin' || (current.role === 'pos' && (current.canManageCalendar === true || (current.canManageCalendar === undefined && current.storeAccess === 'all'))) } });
          }, () => set((state) => ({ profile: state.profile ? { ...state.profile, canManageCalendar: false, inventoryAccess: undefined } : null })));

        } catch {
          if (active && currentRevision === revision) {
            set({ user, profile: null, loading: false, error: 'No se pudo cargar el perfil. Revisa tu conexión e intenta nuevamente.' });
          }
        }
      });

      return () => {
        active = false;
        unsubscribe();
        stopProfile?.();
      };
    },
    login: async (email, password) => {
      set({ loading: true, error: null });
      try {
        const credential = await signInWithEmailAndPassword(auth, email, password);
        await credential.user.getIdToken(true);
        await establishSession(credential.user);
      } catch (error) {
        set({ loading: false });
        throw error;
      }
    },
    logout: async () => {
      const { disableCalendarPush } = await import('./calendar-push');
      await Promise.race([disableCalendarPush(), new Promise<void>((resolve) => setTimeout(resolve, 2500))]).catch(() => undefined);
      await signOut(auth);
      set({ user: null, profile: null, loading: false, error: null });
    },
    setProfileStoreId: (storeId) => set((state) => {
      if (!state.profile || !state.user || state.profile.storeAccess !== 'all') return {};
      sessionStorage.setItem(`active-store:${state.profile.tenantId}:${state.user.uid}`, storeId);
      return { profile: { ...state.profile, storeId } };
    })
  };
});

export function homeFor(role: UserProfile['role']): string {
  switch (role) {
    case 'admin':
      return '/admin';
    case 'pos':
      return '/pos';
    case 'trabajador':
      return '/w';
  }
}
