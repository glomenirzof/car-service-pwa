import {createContext, useContext, type ReactNode} from 'react';
import type {OwnerTenant} from './types';

const Ctx = createContext<OwnerTenant | null>(null);

export function OwnerTenantProvider({tenant, children}: {tenant: OwnerTenant; children: ReactNode}) {
  return <Ctx.Provider value={tenant}>{children}</Ctx.Provider>;
}

export function useOwnerStudio(): OwnerTenant {
  const t = useContext(Ctx);
  if (!t) throw new Error('useOwnerStudio outside provider');
  return t;
}
