import {ClickableCard} from '@astryxdesign/core/ClickableCard';
import {VStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {AspectRatio} from '@astryxdesign/core/AspectRatio';
import {MediaImage} from '@/components/app/MediaImage';
import {duration, money} from '@/shared/format';
import type {Service} from '@/shared/types';

export function ServiceCard({service, fallbackImage, onPick}: {service: Service; fallbackImage: string; onPick: () => void}) {
  return (
    <ClickableCard label={`${service.name}, записаться`} onClick={onPick} padding={0} width={220} data-testid={`service-card-${service.key}`}>
      <VStack gap={0}>
        <AspectRatio ratio={4 / 3}>
          <MediaImage path={service.imagePath ?? fallbackImage} alt="" sizes="220px" className="rounded-t-lg" />
        </AspectRatio>
        <VStack gap={1} padding={3}>
          <Text weight="semibold" maxLines={2}>
            {service.name}
          </Text>
          <Text type="supporting">
            {duration(service.durationMinutes)} · {money(service.price.amount, service.price.isFrom)}
          </Text>
        </VStack>
      </VStack>
    </ClickableCard>
  );
}
