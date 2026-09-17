import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import type { NewUserPayload } from '../types';

export async function createSystemUser(payload: NewUserPayload): Promise<{ uid: string }> {
  const callable = httpsCallable<NewUserPayload, { uid: string }>(functions, 'createUser');
  try {
    const response = await callable(payload);
    return response.data;
  } catch (error: unknown) {
    const message = (error as { message?: string })?.message;
    throw new Error(message || 'No se pudo crear el usuario.');
  }
}
