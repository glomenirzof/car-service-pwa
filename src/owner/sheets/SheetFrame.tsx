import type {ReactNode} from 'react';
import {IconButton} from '@astryxdesign/core/IconButton';
import {HStack, StackItem} from '@astryxdesign/core/Stack';
import {X} from 'lucide-react';
import {Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerTitle} from '@/components/ui/drawer';

export function SheetFrame({open, onClose, title, description, footer, children}: {open: boolean; onClose: () => void; title: string; description?: string; footer?: ReactNode; children: ReactNode}) {
  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent
        header={
          <HStack gap={2} align="center">
            <StackItem size="fill">
              <DrawerTitle>{title}</DrawerTitle>
              {description ? <DrawerDescription>{description}</DrawerDescription> : null}
            </StackItem>
            <DrawerClose render={<IconButton icon={<X size={20} />} label="Закрыть" variant="ghost" />} />
          </HStack>
        }
        footer={footer}
      >
        {children}
      </DrawerContent>
    </Drawer>
  );
}

/** "YYYY-MM-DDTHH:MM" wall time in a timezone <-> ISO instant. */
export function toLocalInput(iso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).formatToParts(new Date(iso));
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
}

export function fromLocalInput(local: string, tz: string): string {
  // Find the instant whose wall time in `tz` equals `local` (two passes handle DST offsets).
  const guess = Date.parse(`${local}:00Z`);
  let instant = guess;
  for (let i = 0; i < 2; i++) {
    const shown = Date.parse(`${toLocalInput(new Date(instant).toISOString(), tz)}:00Z`);
    instant += guess - shown;
  }
  return new Date(instant).toISOString();
}
