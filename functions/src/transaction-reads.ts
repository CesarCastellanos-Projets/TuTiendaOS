import type { DocumentReference, DocumentSnapshot, Transaction } from 'firebase-admin/firestore';

export async function readUnique(tx: Transaction, references: DocumentReference[]): Promise<DocumentSnapshot[]> {
  const unique = [...new Map(references.map((reference) => [reference.path, reference])).values()];
  if (!unique.length) return [];
  const snapshots = await tx.getAll(...unique);
  const byPath = new Map(snapshots.map((snapshot) => [snapshot.ref.path, snapshot]));
  return references.map((reference) => byPath.get(reference.path)!);
}
