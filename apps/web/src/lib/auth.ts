import { create } from 'zustand';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
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

function readProfile(user: User): Promise<UserProfile | null> {
  if (pendingProfile?.uid === user.uid) return pendingProfile.promise;
  const promise = Promise.all([
    getDoc(doc(db, 'users', user.uid)),
    user.getIdTokenResult()
  ])
    .then(([snapshot, token]) => {
      if (!snapshot.exists()) return null;
      const profile = snapshot.data() as UserProfile;
      return {
        ...profile,
        storeAccess: token.claims.posStoreAccess === 'all' ? 'all' : 'assigned',
        canOverridePrices: token.claims.canOverridePrices === true
      } satisfies UserProfile;
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
      const unsubscribe = onAuthStateChanged(auth, async (user) => {
        const currentRevision = ++revision;
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
        } catch {
          if (active && currentRevision === revision) {
            set({ user, profile: null, loading: false, error: 'No se pudo cargar el perfil. Revisa tu conexión e intenta nuevamente.' });
          }
        }
      });

      return () => {
        active = false;
        unsubscribe();
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
      await signOut(auth);
      set({ user: null, profile: null, loading: false, error: null });
    },
    setProfileStoreId: (storeId) => set((state) => ({
      profile: state.profile ? { ...state.profile, storeId } : null
    }))
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
