import '@fontsource-variable/inter';
import '@/styles/globals.css';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {readBoot} from '@/shared/boot';
import {registerStudioWorker} from '@/shared/pwa';
import {announceUpdate} from '@/shared/update';
import {OwnerApp} from './OwnerApp';

const boot = readBoot();
registerStudioWorker(boot.slug, announceUpdate);
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <OwnerApp boot={boot} />
  </StrictMode>,
);
