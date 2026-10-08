import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { FieldValue, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { db } from './firebase';
import { tenantCollection, tenantDoc } from './tenant';

export const syncProductStockMetadata = onDocumentWritten({ document: 'tenants/{tenantId}/products/{productId}', retry: true }, async (event) => {
  const before = event.data?.before.data(); const after = event.data?.after.data();
  if (!after || (before && before.name === after.name && before.minStock === after.minStock && before.active === after.active)) return;
  let cursor: QueryDocumentSnapshot | undefined;
  do {
    const base = tenantCollection(event.params.tenantId, 'product_stocks').where('productId', '==', event.params.productId).orderBy('__name__');
    const page = await (cursor ? base.startAfter(cursor) : base).limit(100).get();
    for (const stock of page.docs) await db.runTransaction(async (tx) => {
      const [fresh, product] = await tx.getAll(stock.ref, tenantDoc(event.params.tenantId, 'products', event.params.productId));
      const value = product.data(); const current = fresh.data();
      if (!value || !current) return;
      const minimum = Number(value.minStock ?? 0);
      const low = value.active === true && Number(current.quantity) <= minimum;
      if (current.productName === value.name && current.minStock === minimum && current.isLowStock === low) return;
      tx.update(stock.ref, { productName: value.name, minStock: minimum, isLowStock: low, committedAt: FieldValue.serverTimestamp(), updatedAt: Date.now() });
    });
    cursor = page.size === 100 ? page.docs.at(-1) : undefined;
  } while (cursor);
});
