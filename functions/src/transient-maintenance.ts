import { db } from './firebase';
import { quotationExpires, QUOTATION_LIFETIME } from './quotation-lifecycle';
import type { DocumentReference, Transaction } from 'firebase-admin/firestore';

export async function removeQuotation(tx: Transaction, ref: DocumentReference, data: Record<string, unknown>): Promise<void> {
  const receipts = data.receiptId && typeof data.receiptId === 'string'
    ? [await tx.get(ref.parent.parent!.collection('operation_receipts').doc(data.receiptId))]
    : (await tx.get(ref.parent.parent!.collection('operation_receipts').where('kind', '==', 'quotation').where('result.id', '==', ref.id).limit(10))).docs;
  for (const receipt of receipts) if (receipt.exists) tx.update(receipt.ref, { result: { id: ref.id, removed: true } });
  tx.delete(ref);
}

export async function runTransientCleanup(canStart: () => boolean): Promise<void> {
  const cursorRef = db.doc('system_maintenance/quotation_retention');
  const cursor = (await cursorRef.get()).data();
  let recent = db.collectionGroup('quotations').where('createdAt', '>', Date.now() - QUOTATION_LIFETIME).orderBy('createdAt').orderBy('__name__').limit(100);
  if (cursor?.createdAt && cursor?.path) recent = recent.startAfter(cursor.createdAt, db.doc(cursor.path));
  const migration = canStart() ? await recent.get() : null;
  if (migration && !migration.empty) {
    const batch = db.batch();
    for (const doc of migration.docs) if (!doc.data().expiresAt) batch.update(doc.ref, { expiresAt: quotationExpires(doc.data()) });
    const last = migration.docs.at(-1)!;
    batch.set(cursorRef, { createdAt: last.data().createdAt, path: last.ref.path });
    await batch.commit();
  }
  for (const collection of ['price_notices', 'quotations']) {
    for (let batchNumber = 0; batchNumber < 5 && canStart(); batchNumber++) {
      const page = await db.collectionGroup(collection).where('expiresAt', '<=', Date.now()).orderBy('expiresAt').limit(100).get();
      if (page.empty) break;
      for (const doc of page.docs) {
        if (!canStart()) return;
        if (collection === 'price_notices') await doc.ref.delete();
        else await db.runTransaction(async (tx) => {
          const current = await tx.get(doc.ref);
          if (current.exists && quotationExpires(current.data()!) <= Date.now()) await removeQuotation(tx, doc.ref, current.data()!);
        });
      }
      if (page.size < 100) break;
    }
  }
}
