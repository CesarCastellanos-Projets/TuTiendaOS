import { useEffect, useState } from 'react';
import { collection, doc, limit, query, updateDoc, where } from 'firebase/firestore';
import { onSnapshot } from '../../lib/firestore-listener';
import { Plus } from 'lucide-react';
import { db } from '../../lib/firebase';
import { useAuth } from '../../lib/auth';
import { tenantCollection } from '../../lib/tenant-firestore';
import type { NewUserPayload, PosStoreAccess, Role, Store, UserProfile } from '../../types';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../lib/firebase';
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
  const [newRole, setNewRole] = useState<Role | ''>('');
  const [posStoreAccess, setPosStoreAccess] = useState<PosStoreAccess>('assigned');
  const [calendarAccess, setCalendarAccess] = useState(false);
  const { msg, flash } = useFlash();
  const tenantId = useAuth((state) => state.profile?.tenantId);

  useEffect(() => {
    if (!tenantId) return;
    return onSnapshot(query(collection(db, 'users'), where('tenantId', '==', tenantId), limit(100)), (s) =>
      setUsers(s.docs.map((d) => ({ ...(d.data() as UserProfile), id: d.id })))
    );
  }, [tenantId]);

  useEffect(() => {
    return onSnapshot(query(tenantCollection('stores'), limit(50)), (s) =>
      setStores(s.docs.map((d) => ({ ...(d.data() as Store), id: d.id })))
    );
  }, []);

  const create = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const role = clean(fd.get('role')) as Role;
    const storeAccess: PosStoreAccess = role === 'pos' && posStoreAccess === 'all' ? 'all' : 'assigned';
    const payload: NewUserPayload = {
      email: clean(fd.get('email')).toLowerCase(),
      password: clean(fd.get('password')),
      displayName: clean(fd.get('displayName')),
      role,
      storeId: role === 'admin' || storeAccess === 'all' ? null : clean(fd.get('storeId')) || null,
      storeAccess,
      canManageCalendar: role === 'admin' || (role === 'pos' && calendarAccess)
    };
    if (payload.password.length < 6) {
      flash('Error: la clave debe tener al menos 6 caracteres');
      return;
    }
    if (((role === 'pos' && storeAccess === 'assigned') || role === 'trabajador') && !payload.storeId) {
      flash('Error: asigna una tienda al usuario');
      return;
    }
    setBusy(true);
    try {
      await createSystemUser(payload);
      setCreating(false);
      setNewRole('');
      setPosStoreAccess('assigned');
      setCalendarAccess(false);
      flash('Usuario creado');
    } catch (err) {
      flash(`Error: ${err instanceof Error ? err.message : 'no se pudo crear'}`);
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (u: UserProfile & { id: string }) => {
    try {
      await updateDoc(doc(db, 'users', u.id), { active: !u.active });
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
              <th className="th">Calendario</th>
              <th className="th text-right">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-linea">
            {users.map((u) => (
              <tr key={u.id}>
                <td className="td font-medium">{u.displayName}</td>
                <td className="td text-sm">{u.email}</td>
                <td className="td">{u.role === 'pos' && u.storeAccess === 'all' ? 'Cajero POS multi-tienda' : ROLE_LABEL[u.role]}</td>
                <td className="td">{u.role === 'pos' && u.storeAccess === 'all' ? 'Elige dentro del POS' : stores.find((s) => s.id === u.storeId)?.name ?? '—'}</td>
                <td className="td">{u.role === 'admin' ? 'Incluido' : u.role === 'pos' ? <button className="btn-ghost text-xs" onClick={async () => {
                  const enabled = !(u.canManageCalendar === true || (u.canManageCalendar === undefined && u.storeAccess === 'all'));
                  try { await httpsCallable(functions, 'setCalendarPermission')({ uid: u.id, enabled }); flash(enabled ? 'Acceso al calendario activado' : 'Acceso al calendario retirado'); }
                  catch (error) { flash(`Error: ${error instanceof Error ? error.message : 'no se pudo actualizar'}`); }
                }}>{u.canManageCalendar === true || (u.canManageCalendar === undefined && u.storeAccess === 'all') ? 'Permitido' : 'Sin acceso'}</button> : '—'}</td>
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

      <Modal
        open={creating}
        title="Nuevo usuario"
        onClose={() => {
          setCreating(false);
          setNewRole('');
          setPosStoreAccess('assigned');
      setCalendarAccess(false);
        }}
      >
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
            <select
              name="role"
              required
              value={newRole}
              onChange={(event) => {
                setNewRole(event.target.value as Role | '');
                setPosStoreAccess('assigned');
      setCalendarAccess(false);
              }}
              className="field"
            >
              <option value="" disabled>Elegir…</option>
              <option value="admin">{ROLE_LABEL.admin}</option>
              <option value="pos">{ROLE_LABEL.pos}</option>
              <option value="trabajador">{ROLE_LABEL.trabajador}</option>
            </select>
          </div>
          {newRole === 'pos' && (
            <div>
              <label className="label">Tipo de acceso POS *</label>
              <select
                value={posStoreAccess}
                onChange={(event) => { setPosStoreAccess(event.target.value as PosStoreAccess); setCalendarAccess(event.target.value === 'all'); }}
                className="field"
              >
                <option value="assigned">POS fijo — trabaja en una sola tienda</option>
                <option value="all">POS multi-tienda — elige tienda al ingresar y puede cambiar precios</option>
              </select>
            </div>
          )}
          {newRole === 'pos' && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={calendarAccess} onChange={(event) => setCalendarAccess(event.target.checked)} />Administrar calendario y recibir recordatorios de la empresa</label>}
          {(newRole === 'trabajador' || (newRole === 'pos' && posStoreAccess === 'assigned')) && (
            <div>
              <label className="label">Tienda asignada *</label>
              <select name="storeId" defaultValue="" required className="field">
                <option value="">Elegir tienda…</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          )}
          {newRole === 'pos' && posStoreAccess === 'all' && (
            <p className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-900">
              Esta cuenta podrá escoger la tienda dentro del POS y modificar el precio únicamente para la venta actual. Los precios del catálogo no cambiarán.
            </p>
          )}
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
