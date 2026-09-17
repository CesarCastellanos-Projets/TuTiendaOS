import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';
import type { ClientDoc } from '../types';

interface LookupResult {
  tipo: 'DNI' | 'RUC';
  numero: string;
  nombre: string;
}

export async function lookupClient(tipo: 'DNI' | 'RUC', numero: string): Promise<ClientDoc> {
  const callable = httpsCallable<{ type: 'dni' | 'ruc'; number: string }, LookupResult>(
    functions,
    'lookupClient'
  );
  const response = await callable({
    type: tipo === 'DNI' ? 'dni' : 'ruc',
    number: numero
  });
  return {
    tipo,
    numero: response.data.numero,
    nombre: response.data.nombre
  };
}
