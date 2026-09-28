import {useEffect, useState} from 'react';
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';

export const UPDATE_EVENT = 'app:update-ready';

/**
 * A new service worker version is waiting. The user decides when to reload:
 * nothing is swapped under an open booking form.
 */
export function UpdatePrompt() {
  const [apply, setApply] = useState<(() => void) | null>(null);
  useEffect(() => {
    const onReady = (e: Event) => {
      const fn = (e as CustomEvent<() => void>).detail;
      setApply(() => fn);
    };
    window.addEventListener(UPDATE_EVENT, onReady);
    return () => window.removeEventListener(UPDATE_EVENT, onReady);
  }, []);
  if (!apply) return null;
  return (
    <div className="app-update-prompt" data-testid="update-prompt">
      <Banner
        status="info"
        elevation="med"
        title="Доступна новая версия"
        isDismissable
        dismissLabel="Позже"
        onDismiss={() => setApply(null)}
        endContent={<Button label="Обновить" size="sm" variant="primary" onClick={apply} />}
      />
    </div>
  );
}
