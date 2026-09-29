// AI assistant chat. It answers from server tools only; its buttons open the
// normal booking sheet. If AI is unavailable, booking keeps working.
import {useEffect, useRef, useState} from 'react';
import {useNavigate} from 'react-router';
import {Button} from '@astryxdesign/core/Button';
import {ChatComposer, ChatLayout, ChatMessage, ChatMessageBubble, ChatMessageList, ChatSystemMessage} from '@astryxdesign/core/Chat';
import {HStack, VStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {ScreenHeader} from '@/components/app/ScreenHeader';
import {ApiError, errorMessage} from '@/shared/api';
import {safeStorage} from '@/shared/storage';
import type {AssistantAction} from '@shared/contract';
import {useBoot} from '@/app/boot-context';
import {useStudio} from '../studio-context';
import {askAssistant} from '../api';
import {useSavedBookings} from '../store';
import {useBookingSheet} from '../booking/useBookingSheet';

type Msg = {role: 'user' | 'assistant'; content: string; actions?: AssistantAction[]; error?: boolean};

const SUGGESTIONS = ['Когда ближайшее свободное время?', 'Сколько стоит и сколько длится?', 'Где вы находитесь?'];

export function AssistantPage() {
  const {slug, assistantName} = useBoot();
  const studio = useStudio();
  const sheet = useBookingSheet();
  const navigate = useNavigate();
  const saved = useSavedBookings(slug);
  const storeKey = `chat:${slug}`;
  const [messages, setMessages] = useState<Msg[]>(() => safeStorage.get<Msg[]>(storeKey, [], 'session'));
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => safeStorage.set(storeKey, messages.slice(-30), 'session'), [messages, storeKey]);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || pending) return;
    const next: Msg[] = [...messages, {role: 'user', content}];
    setMessages(next);
    setDraft('');
    setPending(true);
    abort.current = new AbortController();
    try {
      const history = next.filter((m) => !m.error).map(({role, content: c}) => ({role, content: c})).slice(-12);
      const reply = await askAssistant(slug, history, saved.map((s) => s.token).slice(0, 10));
      setMessages((m) => [...m, {role: 'assistant', content: reply.reply, actions: reply.actions}]);
    } catch (e) {
      const unavailable = e instanceof ApiError && (e.code === 'ai_unavailable' || e.code === 'ai_budget_exhausted' || e.code === 'ai_disabled');
      setMessages((m) => [
        ...m,
        {role: 'assistant', error: true, content: unavailable ? `${errorMessage(e)} Выберите услугу и время в каталоге — это работает всегда.` : errorMessage(e)},
      ]);
    } finally {
      setPending(false);
    }
  };

  const act = (a: AssistantAction) => {
    if (a.type === 'book') sheet.start({serviceId: a.serviceId, startAt: a.startAt});
    else navigate(`/bookings/${a.bookingId}`);
  };

  return (
    <main className="app-content flex min-h-[100dvh] flex-col" id="main">
      <ScreenHeader title={assistantName} />
      <VStack paddingInline={4} className="flex-1">
        <ChatLayout
          composer={
            <ChatComposer
              value={draft}
              onChange={setDraft}
              onSubmit={(v) => void send(v)}
              placeholder="Спросите про услуги и время"
              isDisabled={pending}
              density="compact"
            />
          }
          emptyState={
            <VStack gap={3} paddingBlock={4}>
              <Text>{studio.profile.ai.greeting}</Text>
              <HStack gap={2} wrap="wrap">
                {SUGGESTIONS.map((s) => (
                  <Button key={s} label={s} size="sm" onClick={() => void send(s)} />
                ))}
              </HStack>
              <Text type="supporting">Ассистент отвечает по данным студии и не записывает сам: записаться можно кнопкой под ответом.</Text>
            </VStack>
          }
        >
          {messages.length ? (
            <ChatMessageList isStreaming={pending}>
              {messages.map((m, i) => (
                <ChatMessage key={i} sender={m.role}>
                  <ChatMessageBubble>{m.content}</ChatMessageBubble>
                  {m.actions?.length ? (
                    <ChatMessageBubble variant="ghost">
                      <HStack gap={2} wrap="wrap">
                        {m.actions.map((a, j) => (
                          <Button key={j} label={a.label} size="sm" variant={a.type === 'book' ? 'primary' : 'secondary'} onClick={() => act(a)} />
                        ))}
                      </HStack>
                    </ChatMessageBubble>
                  ) : null}
                  {m.error ? (
                    <ChatMessageBubble variant="ghost">
                      <Button label="Открыть каталог" size="sm" onClick={() => sheet.start()} />
                    </ChatMessageBubble>
                  ) : null}
                </ChatMessage>
              ))}
              {pending ? <ChatSystemMessage>Ассистент проверяет расписание…</ChatSystemMessage> : null}
            </ChatMessageList>
          ) : null}
        </ChatLayout>
      </VStack>
    </main>
  );
}
