import { create } from 'zustand';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import type { UserProfile } from '../types';

interface AuthState {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  init: () => () => void;
  logout: () => Promise<void>;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  profile: null,
  loading: true,
  init: () =>
    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        set({ user: null, profile: null, loading: false });
        return;
      }
      const snap = await getDoc(doc(db, 'users', user.uid));
      const profile = snap.exists() ? (snap.data() as UserProfile) : null;
      if (profile && !profile.active) {
        await signOut(auth);
        set({ user: null, profile: null, loading: false });
        return;
      }
      set({ user, profile, loading: false });
    }),
  logout: async () => {
    await signOut(auth);
    set({ user: null, profile: null });
  }
}));

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
