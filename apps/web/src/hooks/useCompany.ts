import { httpsCallable } from 'firebase/functions';
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { onSnapshot } from '../lib/firestore-listener';
import { tenantDocFor } from '../lib/tenant-firestore';
import { functions } from '../lib/firebase';
import { DEFAULT_COMPANY, type CompanyConfig } from '../types';

export function useCompany(): CompanyConfig | null {
  const tenantId = useAuth((state) => state.profile?.tenantId);
  const [config, setConfig] = useState<CompanyConfig | null>(null);

  useEffect(() => {
    let active = true;
    let receivedLive = false;
    setConfig(null);
    if (!tenantId) return;
    const callable = httpsCallable<Record<string, never>, CompanyConfig | null>(
      functions,
      'getCompanyConfig'
    );
    void callable({})
      .then((response) => {
        if (active && !receivedLive) setConfig(response.data ?? DEFAULT_COMPANY);
      })
      .catch(() => {
        if (active && !receivedLive) setConfig(DEFAULT_COMPANY);
      });
    const unsubscribe = onSnapshot(tenantDocFor(tenantId, 'config', 'company'), (snapshot) => {
      if (active && snapshot.exists()) { receivedLive = true; setConfig({ ...DEFAULT_COMPANY, ...snapshot.data() } as CompanyConfig); }
    }, () => undefined);
    return () => { active = false; unsubscribe(); };
  }, [tenantId]);

  return config;
}
