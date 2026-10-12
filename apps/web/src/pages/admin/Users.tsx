import { UserSettings } from '../../components/users/UserSettings';
import { useEffect, useMemo, useState } from 'react';
import { collection, documentId, limit, orderBy, query, where } from 'firebase/firestore';
import { usePagedQuery } from '../../hooks/usePagedQuery';
import { Pagination } from '../../components/ui/Pagination';
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
  const [selected, setSelected] = useState<(UserProfile & { id: string }) | null>(null);
  const [purchaseAccess, setPurchaseAccess] = useState(false);
  const [stores, setStores] = useState<Store[]>([]);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newRole, setNewRole] = useState<Role | ''>('');
  const [posStoreAccess, setPosStoreAccess] = useState<PosStoreAccess>('assigned');
  const [overrideAccess, setOverrideAccess] = useState(true);
  const [calendarAccess, setCalendarAccess] = useState(false);
  const { msg, flash } = useFlash();
  const tenantId = useAuth((state) => state.profile?.tenantId);

  const userQuery = useMemo(() => tenantId ? query(collection(db, 'users'), where('tenantId', '==', tenantId), orderBy(documentId())) : null, [tenantId]);
  const userPage = usePagedQuery<UserProfile & { id: string }>(userQuery);
  const users = userPage.rows.filter((user) => !user.deletedAt);

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
      canOverridePrices: role === 'pos' && storeAccess === 'all' && overrideAccess,
      canViewPurchaseCosts: role === 'pos' && purchaseAccess,
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
      setPurchaseAccess(false);
      setOverrideAccess(true);
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
      await httpsCallable(functions, 'setUserActive')({ uid: u.id, active: !u.active });
      flash(u.active ? `${u.displayName} desactivado` : `${u.displayName} activado`);
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Error al actualizar');
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

      {userPage.error && <p role="alert" className="text-critical">{userPage.error}</p>}
      <Pagination {...userPage} />
      <div className="card overflow-x-auto">
        <table className="responsive-table w-full min-w-[600px]">
          <thead className="border-b border-slate-200">
            <tr>
              <th className="th">Nombre</th>
              <th className="th">Correo</th>
              <th className="th">Rol</th>
              <th className="th">Tienda</th>
              <th className="th">Calendario</th>
              <th className="th text-right">Estado</th><th className="th">Administrar</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-linea">
            {users.map((u) => (
              <tr key={u.id}>
                <td data-label="Nombre" className="td font-medium">{u.displayName}</td>
                <td data-label="Correo" className="td text-sm">{u.email}</td>
                <td data-label="Rol" className="td">{u.role === 'pos' && u.storeAccess === 'all' ? 'Cajero POS multi-tienda' : ROLE_LABEL[u.role]}</td>
                <td data-label="Tienda" className="td">{u.role === 'pos' && u.storeAccess === 'all' ? 'Elige dentro del POS' : stores.find((s) => s.id === u.storeId)?.name ?? '—'}</td>
                <td data-label="Calendario" className="td">{u.role === 'admin' ? 'Incluido' : u.role === 'pos' ? <button className="btn-ghost text-xs" onClick={async () => {
                  const enabled = !(u.canManageCalendar === true || (u.canManageCalendar === undefined && u.storeAccess === 'all'));
                  try { await httpsCallable(functions, 'setCalendarPermission')({ uid: u.id, enabled }); flash(enabled ? 'Acceso al calendario activado' : 'Acceso al calendario retirado'); }
                  catch (error) { flash(`Error: ${error instanceof Error ? error.message : 'no se pudo actualizar'}`); }
                }}>{u.canManageCalendar === true || (u.canManageCalendar === undefined && u.storeAccess === 'all') ? 'Permitido' : 'Sin acceso'}</button> : '—'}</td>
                <td data-label="Estado" className="td text-right">
                  <button onClick={() => void toggleActive(u)} className={`badge ${u.active ? 'bg-emerald-50 text-success' : 'bg-slate-100 text-slate-500'}`}>
                    {u.active ? 'activo' : 'inactivo'}
                  </button>
                </td>
                <td data-label="Administrar" className="td"><button className="btn-ghost" onClick={() => setSelected(u)}>Permisos y cuenta</button></td>
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
          setPurchaseAccess(false);
      setOverrideAccess(true);
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
            <input name="password" type="password" autoComplete="new-password" required minLength={6} className="field font-mono" />
          </div>
          <div>
            <label className="label">Rol *</label>
            <select
              name="role"
              required
              value={newRole}
              onChange={(event) => {
                setNewRole(event.target.value as Role | '');
                setPurchaseAccess(false);
                setOverrideAccess(true);
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
          {newRole === 'pos' && posStoreAccess === 'all' && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={overrideAccess} onChange={(event) => setOverrideAccess(event.target.checked)} />Ajustar el precio de la venta actual</label>}
          {newRole === 'pos' && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={purchaseAccess} onChange={(event) => setPurchaseAccess(event.target.checked)} />Consultar costo de compra y proveedor</label>}
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
            <p className="rounded-xl border border-brand-200 bg-brand-50 p-3 text-xs text-brand-900">
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

      {selected && <UserSettings key={selected.id} user={selected} close={() => setSelected(null)} saved={flash} />}
      <FlashBar msg={msg} />
    </div>
  );
}
