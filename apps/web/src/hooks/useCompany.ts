import { httpsCallable } from 'firebase/functions';
import { useEffect, useState } from 'react';
import { functions } from '../lib/firebase';
import { DEFAULT_COMPANY, type CompanyConfig } from '../types';

export function useCompany(): CompanyConfig | null {
  const [config, setConfig] = useState<CompanyConfig | null>(null);

  useEffect(() => {
    let active = true;
    const callable = httpsCallable<Record<string, never>, CompanyConfig | null>(
      functions,
      'getCompanyConfig'
    );
    void callable({})
      .then((response) => {
        if (active) setConfig(response.data ?? DEFAULT_COMPANY);
      })
      .catch(() => {
        if (active) setConfig(DEFAULT_COMPANY);
      });
    return () => {
      active = false;
    };
  }, []);

  return config;
}
