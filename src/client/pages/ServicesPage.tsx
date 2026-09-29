import {List, ListItem} from '@astryxdesign/core/List';
import {VStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {ChevronRight} from 'lucide-react';
import {ScreenHeader} from '@/components/app/ScreenHeader';
import {EmptyBlock} from '@/components/app/StateViews';
import {duration, money} from '@/shared/format';
import {useStudio} from '../studio-context';
import {useBookingSheet} from '../booking/useBookingSheet';

export function ServicesPage() {
  const studio = useStudio();
  const sheet = useBookingSheet();
  const categories = [...new Set(studio.services.map((s) => s.category))];
  return (
    <main className="app-content" id="main">
      <ScreenHeader title="Услуги" />
      <VStack gap={5} paddingInline={4}>
        {studio.services.length === 0 ? (
          <EmptyBlock title="Нет услуг для онлайн-записи" description="Позвоните в студию — подберём время." />
        ) : (
          categories.map((c) => (
            <List key={c} header={<Text weight="semibold">{c}</Text>} hasDividers density="spacious">
              {studio.services
                .filter((s) => s.category === c)
                .map((s) => (
                  <ListItem
                    key={s.id}
                    label={s.name}
                    description={
                      <VStack gap={0.5}>
                        <Text type="supporting">
                          {duration(s.durationMinutes)} · {money(s.price.amount, s.price.isFrom)}
                          {s.completion === 'multi_day' ? ' · автомобиль остаётся у нас' : ''}
                        </Text>
                        {s.description ? (
                          <Text type="supporting" maxLines={2}>
                            {s.description}
                          </Text>
                        ) : null}
                      </VStack>
                    }
                    endContent={<ChevronRight size={18} aria-hidden />}
                    onClick={() => sheet.start({serviceId: s.id})}
                    data-testid={`service-row-${s.key}`}
                  />
                ))}
            </List>
          ))
        )}
      </VStack>
    </main>
  );
}
