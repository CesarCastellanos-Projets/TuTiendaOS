import { doc, getDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { db } from '../lib/firebase';
import { DEFAULT_COMPANY, type CompanyConfig } from '../types';

/** Config tributaria singleton (company/main). 1 lectura por montaje. */
export function useCompany(): CompanyConfig | null {
  const [cfg, setCfg] = useState<CompanyConfig | null>(null);

  useEffect(() => {
    let alive = true;
    getDoc(doc(db, 'company', 'main'))
      .then((snap) => {
        if (alive) setCfg(snap.exists() ? (snap.data() as CompanyConfig) : DEFAULT_COMPANY);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  return cfg;
}
