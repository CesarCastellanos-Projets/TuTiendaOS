import {
  onSnapshot as firebaseOnSnapshot,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type FirestoreError,
  type Query,
  type QuerySnapshot,
  type Unsubscribe
} from 'firebase/firestore';

type SnapshotErrorHandler = (error: FirestoreError) => void;

function deferSubscription(subscribe: () => Unsubscribe): Unsubscribe {
  let active = true;
  let unsubscribe: Unsubscribe | null = null;
  const timer = globalThis.setTimeout(() => {
    if (active) unsubscribe = subscribe();
  }, 0);

  return () => {
    active = false;
    globalThis.clearTimeout(timer);
    unsubscribe?.();
    unsubscribe = null;
  };
}

export function onSnapshot<AppModelType, DbModelType extends DocumentData = DocumentData>(
  reference: Query<AppModelType, DbModelType>,
  onNext: (snapshot: QuerySnapshot<AppModelType, DbModelType>) => void,
  onError?: SnapshotErrorHandler
): Unsubscribe;
export function onSnapshot<AppModelType, DbModelType extends DocumentData = DocumentData>(
  reference: DocumentReference<AppModelType, DbModelType>,
  onNext: (snapshot: DocumentSnapshot<AppModelType, DbModelType>) => void,
  onError?: SnapshotErrorHandler
): Unsubscribe;
export function onSnapshot(
  reference: Query<DocumentData> | DocumentReference<DocumentData>,
  onNext: ((snapshot: QuerySnapshot<DocumentData>) => void) | ((snapshot: DocumentSnapshot<DocumentData>) => void),
  onError?: SnapshotErrorHandler
): Unsubscribe {
  return deferSubscription(() => {
    if (reference.type === 'document') {
      return firebaseOnSnapshot(reference, onNext as (snapshot: DocumentSnapshot<DocumentData>) => void, onError);
    }
    return firebaseOnSnapshot(reference, onNext as (snapshot: QuerySnapshot<DocumentData>) => void, onError);
  });
}
