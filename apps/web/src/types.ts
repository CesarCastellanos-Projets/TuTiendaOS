export type Role = 'admin' | 'pos' | 'trabajador';

export interface UserProfile {
  displayName: string;
  email: string;
  role: Role;
  storeId?: string;
  active: boolean;
  createdAt?: number;
}

export type Unit = 'UN' | 'KG' | 'LT' | 'PAQ' | 'CJA' | 'DOC';

export interface Product {
  name: string;
  category: string;
  brand?: string;
  unit: Unit;
  internalCode?: string;
  barcode?: string;
  salePrice: number;
  minStock: number;
  locationHint?: string;
  promoLabel?: string;
  promoActive?: boolean;
  sunatCode?: string;
  active: boolean;
  updatedAt?: number;
}

export type LocationType = 'store' | 'warehouse';

export interface LocationBase {
  id: string;
  name: string;
  code: string;
}

export interface Store extends LocationBase {
  address?: string;
}

export interface Warehouse extends LocationBase {
  isCentral: boolean;
}

export type AnyLocation = (
  | ({ kind: 'store' } & Store)
  | ({ kind: 'warehouse' } & Warehouse)
);

export interface ProductStock {
  productId: string;
  productName: string;
  barcode?: string | null;
  salePrice: number;
  locationType: LocationType;
  locationId: string;
  locationName: string;
  quantity: number;
  updatedAt?: number;
}

export type MovementType = 'venta' | 'ingreso' | 'transferencia' | 'ajuste' | 'merma' | 'recepcion';

export interface StockMovement {
  type: MovementType;
  productId: string;
  productName: string;
  qty: number;
  fromLocationId?: string | null;
  toLocationId?: string | null;
  reason?: string | null;
  refId?: string | null;
  userId: string;
  userName: string;
  userStoreId?: string | null;
  createdAt: number;
}

export interface TransferItem {
  productId: string;
  name: string;
  qtySent: number;
  qtyReceived: number;
}

export type TransferStatus = 'pendiente' | 'en_transito' | 'recibido' | 'cancelado';

export interface Transfer {
  code: string;
  fromLocationId: string;
  fromLocationName: string;
  toLocationId: string;
  toLocationName: string;
  status: TransferStatus;
  items: TransferItem[];
  createdBy: string;
  createdByName: string;
  createdAt: number;
  note?: string;
  receivedBy?: string;
  receivedByName?: string;
  receivedAt?: number;
}

export interface ReplenishmentItem {
  productId: string;
  name: string;
  currentQty: number;
  requestedQty: number;
}

export type ReplenishmentStatus = 'pendiente' | 'atendida' | 'rechazada';

export interface ReplenishmentRequest {
  storeId: string;
  storeName: string;
  items: ReplenishmentItem[];
  status: ReplenishmentStatus;
  createdBy: string;
  createdByName: string;
  createdAt: number;
  note?: string;
}

export type IncidentType = 'danado' | 'vencido' | 'sin_etiqueta' | 'sin_codigo' | 'otro';
export type IncidentStatus = 'abierta' | 'resuelta';

export interface Incident {
  storeId: string;
  storeName: string;
  productId?: string;
  productName?: string;
  type: IncidentType;
  description: string;
  photoUrl?: string | null;
  status: IncidentStatus;
  createdBy: string;
  createdByName: string;
  createdAt: number;
  resolutionNote?: string;
  resolvedBy?: string;
  resolvedByName?: string;
  resolvedAt?: number;
}

export interface ClientDoc {
  tipo: '-' | 'DNI' | 'RUC';
  numero: string;
  nombre: string;
}

export interface SaleItem {
  productId: string;
  name: string;
  qty: number;
  unitPrice: number;
  total: number;
}

export type PaymentMethod = 'efectivo' | 'tarjeta' | 'yape' | 'plin' | 'otro';
export type SunatStatus = 'no_enviado' | 'pendiente' | 'aceptado' | 'rechazado' | 'observado';

export interface AnulationRequest {
  reason: string;
  byUserId: string;
  byUserName: string;
  requestedAt: number;
}

export interface Sale {
  code: string;
  serie: string;
  correlativo: number;
  type: 'boleta' | 'factura';
  storeId: string;
  storeName: string;
  userId: string;
  userName: string;
  clientDoc: ClientDoc;
  items: SaleItem[];
  subtotal: number;
  igv: number;
  total: number;
  paymentMethod: PaymentMethod;
  paidAmount: number;
  changeAmount: number;
  consolidated: boolean;
  sunatStatus: SunatStatus;
  sunatMessage?: string | null;
  status: 'activa' | 'anulada';
  cashSessionId?: string | null;
  anulationRequest?: AnulationRequest | null;
  createdAt: number;
}

export interface CashSession {
  storeId: string;
  userId: string;
  userName: string;
  openingAmount: number;
  closingAmount?: number;
  expectedAmount?: number;
  difference?: number;
  status: 'abierta' | 'cerrada';
  openedAt: number;
  closedAt?: number;
}

export interface CompanyConfig {
  ruc: string;
  razonSocial: string;
  direccion?: string;
  regimen?: string;
  serieFactura: string;
  serieBoleta: string;
  entornoSunat: 'beta' | 'produccion';
  igvRate: number;
  minBoletaSinDni: number;
  umbralConsolidacion: number;
  solUser?: string;
  solPassword?: string;
  certFileName?: string;
  certExpiresAt?: string;
  certIssuer?: string;
  isDemoMode?: boolean;
  apiFactUrl?: string;
  apiFactToken?: string;
  updatedAt?: number;
}

export const DEFAULT_COMPANY: CompanyConfig = {
  ruc: '',
  razonSocial: "D'ENZOZ",
  serieFactura: 'F001',
  serieBoleta: 'B001',
  entornoSunat: 'beta',
  igvRate: 0.18,
  minBoletaSinDni: 700,
  umbralConsolidacion: 5,
  solUser: 'MODDATOS',
  solPassword: 'MODDATOS',
  apiFactUrl: 'http://localhost:8000',
  apiFactToken: 'cambia-este-token-largo-y-seguro',
  isDemoMode: true
};

