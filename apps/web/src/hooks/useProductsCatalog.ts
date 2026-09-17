import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { subscribeProductsCatalog, type ProductWithId } from '../lib/catalog-repository';

export function useProductsCatalog(): ProductWithId[] {
  const tenantId = useAuth((state) => state.profile?.tenantId);
  const [products, setProducts] = useState<ProductWithId[]>([]);

  useEffect(() => {
    if (!tenantId) {
      setProducts([]);
      return;
    }
    return subscribeProductsCatalog(tenantId, setProducts);
  }, [tenantId]);

  return products;
}
