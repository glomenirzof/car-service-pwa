import {useDeferredValue, useState} from 'react';
import {List, ListItem} from '@astryxdesign/core/List';
import {VStack} from '@astryxdesign/core/Stack';
import {TextInput} from '@astryxdesign/core/TextInput';
import {ScreenHeader} from '@/components/app/ScreenHeader';
import {EmptyBlock, ErrorBlock, LoadingRows} from '@/components/app/StateViews';
import {dateShort, STATUS_LABEL, time} from '@/shared/format';
import {formatPhone} from '@shared/phone';
import {useOwnerStudio} from '../owner-context';
import {useSearch} from '../api';

export function SearchPage() {
  const studio = useOwnerStudio();
  const [q, setQ] = useState('');
  const deferred = useDeferredValue(q);
  const r = useSearch(studio.tenantId, deferred);
  return (
    <main className="app-content" id="main">
      <ScreenHeader title="Поиск" back="/" />
      <VStack gap={4} paddingInline={4}>
        <TextInput label="Имя, телефон или госномер" value={q} onChange={setQ} hasAutoFocus hasClear width="100%" />
        {deferred.trim().length < 2 ? (
          <EmptyBlock title="Начните вводить" description="Минимум 2 символа. По телефону — 4 цифры." />
        ) : r.isPending ? (
          <LoadingRows rows={3} />
        ) : r.isError ? (
          <ErrorBlock error={r.error} onRetry={() => void r.refetch()} />
        ) : r.data?.length ? (
          <List hasDividers>
            {r.data.map((b) => (
              <ListItem key={b.id} label={`${b.customerName} · ${b.serviceName}`} description={`${dateShort(b.startAt, studio.timezone)} ${time(b.startAt, studio.timezone)} · ${STATUS_LABEL[b.status]} · ${formatPhone(b.phone)}${b.carPlate ? ` · ${b.carPlate}` : ''}`} href={`/bookings/${b.id}`} />
            ))}
          </List>
        ) : (
          <EmptyBlock title="Ничего не найдено" />
        )}
      </VStack>
    </main>
  );
}
