import {createContext, useContext, type ReactNode} from 'react';
import type {Boot} from '@/shared/boot';

const BootContext = createContext<Boot | null>(null);

export function BootProvider({boot, children}: {boot: Boot; children: ReactNode}) {
  return <BootContext.Provider value={boot}>{children}</BootContext.Provider>;
}

export function useBoot(): Boot {
  const boot = useContext(BootContext);
  if (!boot) throw new Error('useBoot outside BootProvider');
  return boot;
}
