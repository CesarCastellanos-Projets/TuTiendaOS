import { doc, getDoc, setDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../lib/firebase';
import type { ClientDoc } from '../types';

interface LookupResult {
  tipo: 'DNI' | 'RUC';
  numero: string;
  nombre: string;
  direccion?: string;
}

/**
 * Consulta DNI/RUC SIEMPRE desde el backend (Cloud Function con el token
 * de APIS.net.pe) y cachea en Firestore para no gastar cuota de la API.
 */
export async function lookupClient(tipo: 'DNI' | 'RUC', numero: string): Promise<ClientDoc> {
  const cacheId = `${tipo}-${numero}`;
  const cached = await getDoc(doc(db, 'clients', cacheId));
  if (cached.exists()) {
    return cached.data() as ClientDoc;
  }

  const call = httpsCallable<{ type: 'dni' | 'ruc'; number: string }, LookupResult>(
    functions,
    'lookupClient'
  );
  const res = await call({ type: tipo === 'DNI' ? 'dni' : 'ruc', number: numero });
  const client: ClientDoc = {
    tipo,
    numero: res.data.numero,
    nombre: res.data.nombre
  };
  await setDoc(doc(db, 'clients', cacheId), { ...client, updatedAt: Date.now() });
  return client;
}
