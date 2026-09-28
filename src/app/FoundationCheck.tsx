import {useState} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {TextInput} from '@astryxdesign/core/TextInput';
import {VStack} from '@astryxdesign/core/Stack';
import {Heading} from '@astryxdesign/core/Heading';
import {Text} from '@astryxdesign/core/Text';
import {Drawer, DrawerContent, DrawerTitle, DrawerDescription} from '@/components/ui/drawer';

// Foundation smoke test from `astryx docs migration`: if primitives keep their
// padding and the sheet renders with tokens, the CSS layer order is sound.
export function FoundationCheck({title}: {title: string}) {
  const [email, setEmail] = useState('');
  const [open, setOpen] = useState(false);
  return (
    <VStack gap={4} padding={4} data-foundation-check>
      <Heading level={1}>{title}</Heading>
      <Text color="secondary">Проверка токенов и слоёв CSS</Text>
      <Button label="Основное действие" variant="primary" onClick={() => setOpen(true)} />
      <TextInput label="Email" placeholder="you@example.com" value={email} onChange={setEmail} />
      <Card>Карточка с отступами по умолчанию</Card>
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent header={<DrawerTitle>Шторка</DrawerTitle>}>
          <DrawerDescription>Шторка shadcn (Base UI) на токенах Astryx.</DrawerDescription>
        </DrawerContent>
      </Drawer>
    </VStack>
  );
}
