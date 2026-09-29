import {useState} from 'react';
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {Heading} from '@astryxdesign/core/Heading';
import {SegmentedControl, SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
import {VStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import {useBoot} from '@/app/boot-context';
import {useAuth} from '../auth';

// There is deliberately no sign-up: owner accounts are created by the platform
// operator (npm run owner:invite). A magic link can only log in existing users.
export function LoginPage() {
  const {name, assetBase} = useBoot();
  const auth = useAuth();
  const [mode, setMode] = useState<'password' | 'link'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [state, setState] = useState<'idle' | 'working' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState('working');
    try {
      if (mode === 'password') await auth.signInWithPassword(email.trim(), password);
      else {
        await auth.sendMagicLink(email.trim());
        setState('sent');
        return;
      }
      setState('idle');
    } catch (err) {
      const msg = (err as Error).message ?? '';
      setError(/invalid login|invalid credentials/i.test(msg) ? 'Неверная почта или пароль.' : /signups? not allowed|user not found/i.test(msg) ? 'Для этой почты нет доступа к кабинету.' : 'Не удалось войти. Проверьте соединение и попробуйте ещё раз.');
      setState('error');
    }
  };

  return (
    <main className="app-safe-top flex min-h-[100dvh] items-center" id="main">
      <VStack gap={5} padding={5} width="100%" maxWidth={420} className="mx-auto">
        <img src={`${assetBase}/logo.svg`} alt="" className="h-10 w-auto self-start" />
        <VStack gap={1}>
          <Heading level={1}>Кабинет</Heading>
          <Text color="secondary">{name}</Text>
        </VStack>
        <SegmentedControl label="Способ входа" value={mode} onChange={(v) => setMode(v as 'password' | 'link')} layout="fill">
          <SegmentedControlItem value="password" label="Пароль" />
          <SegmentedControlItem value="link" label="Ссылка на почту" />
        </SegmentedControl>
        <form onSubmit={(e) => void submit(e)} noValidate>
          <VStack gap={4}>
            <TextInput label="Почта" type="email" value={email} onChange={setEmail} autoComplete="username" isRequired width="100%" />
            {mode === 'password' ? (
              <TextInput label="Пароль" type="password" value={password} onChange={setPassword} autoComplete="current-password" isRequired width="100%" />
            ) : null}
            {state === 'error' ? <Banner status="error" title={error} /> : null}
            {state === 'sent' ? <Banner status="success" title="Ссылка отправлена" description="Откройте письмо на этом устройстве. Ссылка действует ограниченное время." /> : null}
            <Button label={mode === 'password' ? 'Войти' : 'Получить ссылку'} type="submit" variant="primary" size="lg" width="100%" isLoading={state === 'working'} isDisabled={!email || (mode === 'password' && !password)} />
          </VStack>
        </form>
        <Text type="supporting">Регистрации нет: доступ выдаёт администратор платформы. Если вы владелец и не можете войти — свяжитесь с ним.</Text>
      </VStack>
    </main>
  );
}
