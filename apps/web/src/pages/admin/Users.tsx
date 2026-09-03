import { useEffect, useState } from 'react';
import { collection, doc, limit, onSnapshot, query, setDoc } from 'firebase/firestore';
import { Plus } from 'lucide-react';
import { db } from '../../lib/firebase';
import type { NewUserPayload, Role, Store, UserProfile } from '../../types';
import { createSystemUser } from '../../lib/admin-users';
import { clean } from '../../lib/utils';
import { Modal } from '../../components/ui/Modal';
import { FlashBar, useFlash } from '../../components/ui/Feedback';

const ROLE_LABEL: Record<Role, string> = {
  admin: 'Administrador',
  pos: 'Cajero POS',
  trabajador: 'Trabajador de piso'
};

export function UsersPage() {
  const [users, setUsers] = useState<(UserProfile & { id: string })[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const { msg, flash } = useFlash();

  useEffect(() => {
    return onSnapshot(query(collection(db, 'users'), limit(100)), (s) =>
      setUsers(s.docs.map((d) => ({ ...(d.data() as UserProfile), id: d.id })))
    );
  }, []);

  useEffect(() => {
    return onSnapshot(query(collection(db, 'stores'), limit(50)), (s) =>
      setStores(s.docs.map((d) => ({ ...(d.data() as Store), id: d.id })))
    );
  }, []);

  const create = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const role = clean(fd.get('role')) as Role;
    const payload: NewUserPayload = {
      email: clean(fd.get('email')).toLowerCase(),
      password: clean(fd.get('password')),
      displayName: clean(fd.get('displayName')),
      role,
      storeId: role === 'admin' ? null : clean(fd.get('storeId')) || null
    };
    if (payload.password.length < 6) {
      flash('Error: la clave debe tener al menos 6 caracteres');
      return;
    }
    if ((role === 'pos' || role === 'trabajador') && !payload.storeId) {
      flash('Error: asigna una tienda al usuario');
      return;
    }
    setBusy(true);
    try {
      await createSystemUser(payload);
      setCreating(false);
      flash('Usuario creado');
    } catch (err) {
      flash(`Error: ${err instanceof Error ? err.message : 'no se pudo crear'}`);
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (u: UserProfile & { id: string }) => {
    try {
      await setDoc(doc(db, 'users', u.id), { ...u, active: !u.active });
      flash(u.active ? `${u.displayName} desactivado` : `${u.displayName} activado`);
    } catch {
      flash('Error al actualizar');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl uppercase tracking-wide">Usuarios</h1>
        <button className="btn-brand" onClick={() => setCreating(true)}>
          <Plus size={16} /> Nuevo usuario
        </button>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[600px]">
          <thead className="border-b border-slate-200">
            <tr>
              <th className="th">Nombre</th>
              <th className="th">Correo</th>
              <th className="th">Rol</th>
              <th className="th">Tienda</th>
              <th className="th text-right">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-linea">
            {users.map((u) => (
              <tr key={u.id}>
                <td className="td font-medium">{u.displayName}</td>
                <td className="td text-sm">{u.email}</td>
                <td className="td">{ROLE_LABEL[u.role]}</td>
                <td className="td">{stores.find((s) => s.id === u.storeId)?.name ?? '—'}</td>
                <td className="td text-right">
                  <button onClick={() => void toggleActive(u)} className={`badge ${u.active ? 'bg-emerald-50 text-success' : 'bg-slate-100 text-slate-500'}`}>
                    {u.active ? 'activo' : 'inactivo'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={creating} title="Nuevo usuario" onClose={() => setCreating(false)}>
        <form onSubmit={create} className="space-y-3">
          <div>
            <label className="label">Nombre completo *</label>
            <input name="displayName" required className="field" />
          </div>
          <div>
            <label className="label">Correo *</label>
            <input name="email" type="email" required className="field" />
          </div>
          <div>
            <label className="label">Clave inicial * (mín. 6)</label>
            <input name="password" type="text" required minLength={6} className="field font-mono" />
          </div>
          <div>
            <label className="label">Rol *</label>
            <select name="role" required defaultValue="" className="field">
              <option value="" disabled>Elegir…</option>
              <option value="admin">{ROLE_LABEL.admin}</option>
              <option value="pos">{ROLE_LABEL.pos}</option>
              <option value="trabajador">{ROLE_LABEL.trabajador}</option>
            </select>
          </div>
          <div>
            <label className="label">Tienda (POS y Trabajador)</label>
            <select name="storeId" defaultValue="" className="field">
              <option value="">—</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <button disabled={busy} className="btn-primary w-full">
            {busy ? 'Creando…' : 'Crear usuario'}
          </button>
          <p className="text-xs text-slate-500">
            La cuenta se crea en Firebase Auth vía Cloud Function con permisos de servidor.
          </p>
        </form>
      </Modal>

      <FlashBar msg={msg} />
    </div>
  );
}
