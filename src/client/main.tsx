import '@fontsource-variable/inter';
import '@/styles/globals.css';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {readBoot} from '@/shared/boot';
import {ClientApp} from './ClientApp';

const boot = readBoot();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClientApp boot={boot} />
  </StrictMode>,
);
