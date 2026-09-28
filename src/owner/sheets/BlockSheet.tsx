import {useState} from 'react';
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {RadioList, RadioListItem} from '@astryxdesign/core/RadioList';
import {VStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import {useToast} from '@astryxdesign/core/Toast';
import {NativeField} from '@/components/app/NativeField';
import {ErrorBlock} from '@/components/app/StateViews';
import {ApiError} from '@/shared/api';
import {dateShort, time} from '@/shared/format';
import {useOwnerStudio} from '../owner-context';
import {useOwnerMutation} from '../api';
import {SheetFrame, fromLocalInput} from './SheetFrame';

type Conflict = {kind: string; from: string; to: string; serviceName: string | null; customerName: string | null};

export function BlockSheet({open, onClose, defaultDate}: {open: boolean; onClose: () => void; defaultDate: string}) {
  const studio = useOwnerStudio();
  const toast = useToast();
  const resources = studio.resources.filter((r) => r.isActive);
  const [resourceId, setResourceId] = useState(resources[0]?.id ?? '');
  const [from, setFrom] = useState(`${defaultDate}T09:00`);
  const [to, setTo] = useState(`${defaultDate}T12:00`);
  const [note, setNote] = useState('');
  const block = useOwnerMutation<void>(studio.tenantId, () => ({
    path: `/t/${studio.tenantId}/blocks`,
    body: {resourceId, from: fromLocalInput(from, studio.timezone), to: fromLocalInput(to, studio.timezone), note},
  }));
  const invalid = !resourceId || !from || !to || to <= from;
  const conflicts = block.error instanceof ApiError && block.error.code === 'conflict' ? ((block.error.detail as Conflict[]) ?? []) : null;
  const tz = studio.timezone;

  return (
    <SheetFrame
      open={open}
      onClose={() => {
        block.reset();
        onClose();
      }}
      title="Заблокировать пост"
      description="Ремонт, уборка, личные работы — клиенты не смогут записаться на это время."
      footer={
        <Button
          label="Заблокировать"
          variant="primary"
          size="lg"
          width="100%"
          isDisabled={invalid}
          isLoading={block.isPending}
          onClick={() =>
            block.mutate(undefined, {
              onSuccess: () => {
                toast({body: 'Пост заблокирован'});
                onClose();
              },
            })
          }
        />
      }
    >
      <VStack gap={4}>
        <RadioList label="Пост" value={resourceId} onChange={setResourceId}>
          {resources.map((r) => (
            <RadioListItem key={r.id} value={r.id} label={r.name} />
          ))}
        </RadioList>
        <NativeField label="С" type="datetime-local" value={from} onChange={setFrom} required />
        <NativeField label="По" type="datetime-local" value={to} onChange={setTo} required error={to && from && to <= from ? 'Конец должен быть позже начала' : undefined} />
        <Text type="supporting">Время — по часовому поясу студии ({tz}). Можно на несколько дней.</Text>
        <TextInput label="Заметка" value={note} onChange={setNote} isOptional width="100%" />
        {conflicts ? (
          <Banner status="warning" title="На это время уже есть записи" description="Перенесите или отмените их, затем повторите блокировку." collapsible={false}>
            <VStack gap={1}>
              {conflicts.map((c, i) => (
                <Text key={i}>
                  {dateShort(c.from, tz)} {time(c.from, tz)}–{time(c.to, tz)}: {c.kind === 'block' ? 'блокировка' : `${c.serviceName}, ${c.customerName}`}
                </Text>
              ))}
            </VStack>
          </Banner>
        ) : block.isError ? (
          <ErrorBlock error={block.error} title="Не удалось заблокировать" />
        ) : null}
      </VStack>
    </SheetFrame>
  );
}
