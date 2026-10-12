import { documentId, orderBy, query, where } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { usePagedQuery } from '../../hooks/usePagedQuery';
import { tenantCollection } from '../../lib/tenant-firestore';
import { salePresentations } from '../../lib/sale-presentations';
import { needsStockReconciliation } from '../../lib/stock-availability';
import type { Product, ProductStock } from '../../types';
import { PurchaseDetails } from './PurchaseDetails';

export function StockLocations({ product }: { product: Product & { id: string } }) {
  const source = useMemo(() => query(tenantCollection('product_stocks'), where('productId', '==', product.id), orderBy(documentId())), [product.id]);
  const page = usePagedQuery<ProductStock & { id: string }>(source, 50);
  const [visited, setVisited] = useState<Record<number, ProductStock[]>>({});
  useEffect(() => { if (!page.loading && !page.error) setVisited((current) => ({ ...current, [page.page]: page.rows })); }, [page.loading, page.error, page.page, page.rows]);
  const complete = !page.loading && !page.error && !page.hasNext && Array.from({ length: page.page }, (_, i) => i + 1).every((index) => index in visited);
  const anyAvailable = Object.values({ ...visited, [page.page]: page.rows }).flat().some((stock) => needsStockReconciliation(stock, product.presentations) || salePresentations(stock, product).some((item) => item.quantity > 0));
  return <div className="space-y-4"><p>Disponibilidad en tiendas y almacenes. La venta usa únicamente el stock de tu tienda actual.</p>{page.error && <p role="alert" className="text-critical">No se pudo consultar la disponibilidad: {page.error}</p>}{page.loading ? <p>Consultando stock…</p> : <>{page.rows.map((stock) => <div key={stock.id} className="card p-3"><strong>{stock.locationType === 'warehouse' ? 'Almacén' : 'Tienda'}: {stock.locationName || stock.locationId}</strong>{needsStockReconciliation(stock, product.presentations) ? <p>Stock pendiente de conciliación. Disponibilidad sin confirmar.</p> : salePresentations(stock, product).map((item) => <p key={item.presentationId ?? 'base'}>{item.presentationLabel ?? product.unit}: {item.quantity} disponibles</p>)}</div>)}{complete && !anyAvailable && <p>Sin stock disponible en ninguna ubicación.</p>}<div className="flex flex-wrap items-center gap-3"><button className="btn-ghost" disabled={!page.hasPrevious} onClick={page.previous}>Anterior</button><span>Página {page.page}</span><button className="btn-ghost" disabled={!page.hasNext} onClick={page.next}>Ver más ubicaciones</button></div></>}<PurchaseDetails productId={product.id} /></div>;
}
