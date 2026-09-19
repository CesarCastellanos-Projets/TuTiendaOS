export type Role = 'admin' | 'pos' | 'trabajador';
export type PosStoreAccess = 'assigned' | 'all';

export interface UserProfile {
  tenantId: string;
  displayName: string;
  email: string;
  role: Role;
  storeId?: string | null;
  storeAccess?: PosStoreAccess;
  canOverridePrices?: boolean;
  active: boolean;
  createdAt?: number;
}

export interface NewUserPayload {
  email: string;
  password: string;
  displayName: string;
  role: Role;
  storeId: string | null;
  storeAccess?: PosStoreAccess;
}

export type Unit = 'UN' | 'KG' | 'LT' | 'PAQ' | 'CJA' | 'DOC' | string;

export interface ProductPresentation {
  id: string;
  unit: string;
  description?: string;
  factor: number;
  barcode?: string;
  salePrice: number;
  allowFractionalSale?: boolean;
  fractionStep?: number;
  autoUnpackEnabled?: boolean;
  autoUnpackPriority?: number;
}

export interface Product {
  tenantId?: string;
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
  presentations?: ProductPresentation[];
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
  tenantId?: string;
  productId: string;
  productName: string;
  barcode?: string | null;
  salePrice: number;
  locationType: LocationType;
  locationId: string;
  locationName: string;
  quantity: number;
  baseQuantity?: number;
  presentationQuantities?: Record<string, number>;
  stockModelVersion?: 2;
  unit?: string | null;
  updatedAt?: number;
}

export type MovementType = 'venta' | 'ingreso' | 'transferencia' | 'ajuste' | 'merma' | 'recepcion' | 'conversion';

export interface StockMovement {
  tenantId?: string;
  type: MovementType;
  productId: string;
  productName: string;
  qty: number;
  presentationId?: string | null;
  presentationLabel?: string | null;
  presentationQty?: number | null;
  baseQty?: number | null;
  packagesOpened?: number | null;
  remainderToBase?: number | null;
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
  presentationId?: string | null;
  presentationLabel?: string;
  factor?: number;
  baseEquivalent?: number;
}

export type TransferStatus = 'pendiente' | 'en_transito' | 'recibido' | 'cancelado';

export interface Transfer {
  tenantId?: string;
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
  presentationId?: string | null;
  presentationLabel?: string;
}

export type ReplenishmentStatus = 'pendiente' | 'atendida' | 'rechazada';

export interface ReplenishmentRequest {
  tenantId?: string;
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
  tenantId?: string;
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
  presentationUnit?: string;
  presentationId?: string;
  presentationLabel?: string;
  factor?: number;
  barcode?: string;
  catalogUnitPrice?: number;
  priceOverridden?: boolean;
  baseUnitsSold?: number;
  packagesConsumed?: number;
  remainderToBase?: number;
}

export type PaymentMethod = 'efectivo' | 'transferencia' | 'tarjeta' | 'yape' | 'plin' | 'sip' | 'otro';
export type SunatStatus = 'no_enviado' | 'pendiente' | 'aceptado' | 'rechazado' | 'observado' | 'error' | 'no_aplica';

export interface AnulationRequest {
  reason: string;
  byUserId: string;
  byUserName: string;
  requestedAt: number;
}

export type AnulationStatus = 'solicitada' | 'nc_pendiente' | 'anulada' | 'error';

export interface Sale {
  tenantId?: string;
  code: string;
  serie: string;
  correlativo: number;
  type: 'boleta' | 'factura' | 'nota';
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
  bankName?: string | null;
  operationNumber?: string | null;
  paidAmount: number;
  changeAmount: number;
  consolidated: boolean;
  igvRate?: number;
  minBoletaSinDni?: number;
  sunatStatus: SunatStatus;
  sunatMessage?: string | null;
  sunatSummaryRef?: string | null;
  status: 'activa' | 'anulada';
  cashSessionId?: string | null;
  anulationRequest?: AnulationRequest | null;
  anulationStatus?: AnulationStatus | null;
  creditNoteStatus?: 'pendiente' | 'aceptado' | 'rechazado' | 'observado' | 'requiere_revision' | 'error' | null;
  creditNoteMessage?: string | null;
  creditNoteRef?: string | null;
  creditNoteSerie?: string | null;
  creditNoteCorrelativo?: number | null;
  createdAt: number;
}

export interface CashSession {
  tenantId?: string;
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
  serieNota?: string;
  entornoSunat: 'beta' | 'produccion';
  igvRate: number;
  minBoletaSinDni: number;
  umbralConsolidacion: number;
  certFileName?: string;
  certExpiresAt?: string;
  certIssuer?: string;
  isDemoMode?: boolean;
  // Personalización de Ticket
  logoUrl?: string;
  slogan?: string;
  phone?: string;
  footerText?: string;
  ticketWidth?: '80mm' | '58mm';
  customUnits?: string[];
  updatedAt?: number;
}

export const DEFAULT_COMPANY: CompanyConfig = {
  ruc: '',
  razonSocial: "D'ENZOZ",
  serieFactura: 'F001',
  serieBoleta: 'B001',
  serieNota: 'NV01',
  entornoSunat: 'beta',
  igvRate: 0.18,
  minBoletaSinDni: 700,
  umbralConsolidacion: 5,
  isDemoMode: true,
  slogan: 'Calidad y confianza en cada compra',
  footerText: '¡Gracias por su preferencia!',
  ticketWidth: '80mm',
  customUnits: ['UN', 'KG', 'LT', 'PAQ', 'CJA', 'DOC', 'DISPLAY', 'TIRA', 'SACHET', 'BOLSA', 'LATA', 'BOTELLA', 'SOBRE']
};

export interface QuotationItem {
  productId: string;
  presentationId?: string;
  presentationLabel?: string;
  factor?: number;
  name: string;
  barcode?: string;
  unit?: string;
  unitPrice: number;
  qty: number;
  total: number;
  availableQty: number;
  isAvailable: boolean;
}

export interface Quotation {
  tenantId?: string;
  id: string;
  code: string;
  clientName?: string;
  clientPhone?: string;
  storeId: string;
  storeName: string;
  items: QuotationItem[];
  totalAll: number;
  totalAvailable: number;
  note?: string | null;
  createdBy: string;
  createdByName: string;
  status: 'pendiente' | 'facturada' | 'descartada';
  createdAt: number;
}
