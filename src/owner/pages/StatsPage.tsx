// Statistics are computed in SQL (app.owner_stats) for a period resolved in the
// studio timezone by resolvePeriod() — the same function the owner AI uses.
// Visits, completed orders, received payments and expected future value are
// shown separately; future bookings are never called revenue.
import {useState} from 'react';
import {Card} from '@astryxdesign/core/Card';
import {Grid} from '@astryxdesign/core/Grid';
import {Heading} from '@astryxdesign/core/Heading';
import {List, ListItem} from '@astryxdesign/core/List';
import {SegmentedControl, SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
import {VStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {ScreenHeader} from '@/components/app/ScreenHeader';
import {EmptyBlock, ErrorBlock, LoadingRows} from '@/components/app/StateViews';
import {money, plural} from '@/shared/format';
import {PERIOD_LABELS, resolvePeriod, type PeriodPreset} from '@shared/periods';
import {useNow} from '@/shared/use-now';
import {useOwnerStudio} from '../owner-context';
import {useStats} from '../api';
import {METHOD_LABEL} from '../sheets/PaymentSheet';

const PRESETS: PeriodPreset[] = ['today', 'this_week', 'this_month', 'last_month'];
const SHORT: Partial<Record<PeriodPreset, string>> = {today: 'День', this_week: 'Неделя', this_month: 'Месяц', last_month: 'Пр. месяц'};

function Kpi({title, value, hint, testId}: {title: string; value: string; hint?: string; testId?: string}) {
  return (
    <Card padding={3} data-testid={testId}>
      <VStack gap={1}>
        <Text type="supporting">{title}</Text>
        <Text weight="semibold" type="large" hasTabularNumbers>
          {value}
        </Text>
        {hint ? <Text type="supporting">{hint}</Text> : null}
      </VStack>
    </Card>
  );
}

function fmtDate(d: string) {
  const [, m, day] = d.split('-');
  return `${Number(day)}.${m}`;
}

export function StatsPage() {
  const studio = useOwnerStudio();
  const now = useNow(5 * 60_000);
  const [preset, setPreset] = useState<PeriodPreset>('today');
  const period = resolvePeriod(preset, studio.timezone, new Date(now));
  const q = useStats(studio.tenantId, period.from, period.to);
  const s = q.data;
  return (
    <main className="app-content" id="main">
      <ScreenHeader title="Статистика" />
      <VStack gap={4} paddingInline={4}>
        <SegmentedControl label="Период" value={preset} onChange={(v) => setPreset(v as PeriodPreset)} layout="fill" size="sm">
          {PRESETS.map((p) => (
            <SegmentedControlItem key={p} value={p} label={SHORT[p] ?? PERIOD_LABELS[p]} />
          ))}
        </SegmentedControl>
        <Text type="supporting" data-testid="stats-period">
          {period.from === period.to ? fmtDate(period.from) : `${fmtDate(period.from)} – ${fmtDate(period.to)}`} · часовой пояс {studio.timezone}
        </Text>
        {q.isPending ? <LoadingRows rows={4} height={88} /> : null}
        {q.isError ? <ErrorBlock error={q.error} onRetry={() => void q.refetch()} /> : null}
        {s ? (
          <>
            <Grid columns={2} gap={2}>
              <Kpi testId="kpi-visits" title="Заезды" value={String(s.visits)} hint="автомобиль приехал" />
              <Kpi testId="kpi-completed" title="Выполнено заказов" value={money(s.completedOrders.amount)} hint={`${s.completedOrders.count} ${plural(s.completedOrders.count, 'заказ', 'заказа', 'заказов')}`} />
              <Kpi testId="kpi-payments" title="Получено оплат" value={money(s.paymentsReceived.amount)} hint={`${s.paymentsReceived.count} ${plural(s.paymentsReceived.count, 'платёж', 'платежа', 'платежей')}`} />
              <Kpi testId="kpi-upcoming" title="Ожидается (не выручка)" value={money(s.upcoming.expectedAmount)} hint={`${s.upcoming.count} предстоящих записей, по ценам записи`} />
              <Kpi title="Не оплачено" value={money(s.outstanding.amount)} hint={`${s.outstanding.count} выполненных заказов`} />
              <Kpi title="Отмены / неявки" value={`${s.cancelled} / ${s.noShows}`} />
            </Grid>
            {Object.keys(s.paymentsReceived.byMethod).length ? (
              <List header={<Heading level={2} className="text-base">Оплаты по способам</Heading>} density="compact" hasDividers>
                {Object.entries(s.paymentsReceived.byMethod).map(([m, v]) => (
                  <ListItem key={m} label={METHOD_LABEL[m as keyof typeof METHOD_LABEL] ?? m} endContent={<Text hasTabularNumbers>{money(v ?? 0)}</Text>} />
                ))}
              </List>
            ) : null}
            <List header={<Heading level={2} className="text-base">Выполнено по услугам</Heading>} density="compact" hasDividers>
              {s.byService.length ? (
                s.byService.map((r) => <ListItem key={r.serviceName} label={r.serviceName} description={`${r.count} ${plural(r.count, 'заказ', 'заказа', 'заказов')}`} endContent={<Text hasTabularNumbers>{money(r.amount)}</Text>} />)
              ) : (
                <ListItem label="Нет выполненных заказов за период" />
              )}
            </List>
            {s.byDay.length > 1 ? (
              <List header={<Heading level={2} className="text-base">По дням</Heading>} density="compact" hasDividers>
                {s.byDay
                  .filter((d) => d.visits || d.completedAmount || d.paymentsAmount)
                  .map((d) => (
                    <ListItem key={d.date} label={fmtDate(d.date)} description={`заездов: ${d.visits} · выполнено: ${money(d.completedAmount)}`} endContent={<Text hasTabularNumbers>{money(d.paymentsAmount)}</Text>} />
                  ))}
              </List>
            ) : null}
            {s.visits === 0 && s.completedOrders.count === 0 && s.paymentsReceived.count === 0 && s.upcoming.count === 0 ? <EmptyBlock title="За этот период данных нет" /> : null}
          </>
        ) : null}
      </VStack>
    </main>
  );
}
