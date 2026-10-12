import { getBlob, getMetadata, ref } from 'firebase/storage';
import { storage } from './firebase';
import { useAuth } from './auth';
import { createPhotoCache } from './photo-cache';

export const incidentPhotoCache = createPhotoCache(
  (path) => getBlob(ref(storage, path), 5 * 1024 * 1024),
  (path) => getMetadata(ref(storage, path))
);
export const photoSession = () => {
  const { user, profile } = useAuth.getState();
  return user && profile?.active ? JSON.stringify([user.uid, profile]) : '';
};
useAuth.subscribe((state, previous) => {
  if (state.user?.uid !== previous.user?.uid || state.profile !== previous.profile) incidentPhotoCache.clear();
});
