import {createContext, useContext, type ReactNode} from 'react';
import type {PublicTenant} from '@/shared/types';

const StudioContext = createContext<PublicTenant | null>(null);

export function StudioProvider({tenant, children}: {tenant: PublicTenant; children: ReactNode}) {
  return <StudioContext.Provider value={tenant}>{children}</StudioContext.Provider>;
}

export function useStudio(): PublicTenant {
  const t = useContext(StudioContext);
  if (!t) throw new Error('useStudio outside StudioProvider');
  return t;
}
