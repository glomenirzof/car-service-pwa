import {Outlet} from 'react-router';
import {Button} from '@astryxdesign/core/Button';
import {VStack} from '@astryxdesign/core/Stack';
import {EmptyBlock, ErrorBlock, LoadingRows} from '@/components/app/StateViews';
import {useBoot} from '@/app/boot-context';
import {useAuth} from './auth';
import {useOwnerContext, useOwnerTenant} from './api';
import {OwnerTenantProvider} from './owner-context';
import {LoginPage} from './pages/LoginPage';

function Loading({label}: {label: string}) {
  return (
    <VStack padding={4} gap={3} className="min-h-[100dvh]">
      <LoadingRows rows={5} label={label} />
    </VStack>
  );
}

/** session -> membership in THIS studio (checked by the server) -> studio data */
export function OwnerGate() {
  const {slug} = useBoot();
  const auth = useAuth();
  const context = useOwnerContext(Boolean(auth.session));
  const membership = context.data?.tenants.find((t) => t.slug === slug);

  if (!auth.ready) return <Loading label="Проверяем вход" />;
  if (!auth.session) return <LoginPage />;
  if (context.isPending) return <Loading label="Проверяем доступ" />;
  if (context.isError) {
    return (
      <VStack padding={4} gap={3}>
        <ErrorBlock error={context.error} onRetry={() => void context.refetch()} />
        <Button label="Выйти" onClick={() => void auth.signOut()} />
      </VStack>
    );
  }
  if (!membership) {
    return (
      <VStack padding={4}>
        <EmptyBlock
          title="Нет доступа к этой студии"
          description={`Аккаунт ${context.data.user.email ?? ''} не является владельцем этой студии.`}
          actions={<Button label="Выйти" variant="primary" onClick={() => void auth.signOut()} />}
        />
      </VStack>
    );
  }
  return <TenantLoader tenantId={membership.tenantId} />;
}

function TenantLoader({tenantId}: {tenantId: string}) {
  const tenant = useOwnerTenant(tenantId);
  if (tenant.isPending) return <Loading label="Загружаем студию" />;
  if (tenant.isError) {
    return (
      <VStack padding={4}>
        <ErrorBlock error={tenant.error} onRetry={() => void tenant.refetch()} />
      </VStack>
    );
  }
  return (
    <OwnerTenantProvider tenant={tenant.data}>
      <Outlet />
    </OwnerTenantProvider>
  );
}
