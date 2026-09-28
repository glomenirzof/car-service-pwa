import {AppRoot} from '@/app/AppRoot';
import {FoundationCheck} from '@/app/FoundationCheck';
import type {Boot} from '@/shared/boot';

export function ClientApp({boot}: {boot: Boot}) {
  return (
    <AppRoot boot={boot}>
      <FoundationCheck title={boot.name} />
    </AppRoot>
  );
}
