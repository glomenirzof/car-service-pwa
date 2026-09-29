import {useEffect, useState} from 'react';
import {useNavigate} from 'react-router';
import {Button} from '@astryxdesign/core/Button';
import {ChatComposer, ChatLayout, ChatMessage, ChatMessageBubble, ChatMessageList, ChatSystemMessage} from '@astryxdesign/core/Chat';
import {HStack, VStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {ScreenHeader} from '@/components/app/ScreenHeader';
import {errorMessage} from '@/shared/api';
import {safeStorage} from '@/shared/storage';
import type {AssistantAction} from '@shared/contract';
import {useBoot} from '@/app/boot-context';
import {useOwnerStudio} from '../owner-context';
import {useOwnerAssistant} from '../api';

type Msg = {role: 'user' | 'assistant'; content: string; actions?: AssistantAction[]; error?: boolean};
const SUGGESTIONS = ['Сколько получили оплат сегодня?', 'Кто сегодня записан?', 'Статистика за эту неделю'];

export function OwnerAssistantPage() {
  const {slug} = useBoot();
  const studio = useOwnerStudio();
  const navigate = useNavigate();
  const ask = useOwnerAssistant();
  const key = `owner-chat:${slug}`;
  const [messages, setMessages] = useState<Msg[]>(() => safeStorage.get<Msg[]>(key, [], 'session'));
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  useEffect(() => safeStorage.set(key, messages.slice(-30), 'session'), [messages, key]);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || pending) return;
    const next: Msg[] = [...messages, {role: 'user', content}];
    setMessages(next);
    setDraft('');
    setPending(true);
    try {
      const r = await ask(studio.tenantId, next.filter((m) => !m.error).map(({role, content: c}) => ({role, content: c})).slice(-12));
      setMessages((m) => [...m, {role: 'assistant', content: r.reply, actions: r.actions}]);
    } catch (e) {
      setMessages((m) => [...m, {role: 'assistant', content: errorMessage(e), error: true}]);
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="app-content flex min-h-[100dvh] flex-col" id="main">
      <ScreenHeader title="Помощник" />
      <VStack paddingInline={4} className="flex-1">
        <ChatLayout
          composer={<ChatComposer value={draft} onChange={setDraft} onSubmit={(v) => void send(v)} placeholder="Спросите про записи и деньги" isDisabled={pending} density="compact" />}
          emptyState={
            <VStack gap={3} paddingBlock={4}>
              <Text>Отвечаю по данным студии: расписание, поиск записей, статистика. Период и часовой пояс — как в разделе «Статистика».</Text>
              <HStack gap={2} wrap="wrap">
                {SUGGESTIONS.map((s) => (
                  <Button key={s} label={s} size="sm" onClick={() => void send(s)} />
                ))}
              </HStack>
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
                          <Button key={j} label={a.label} size="sm" onClick={() => a.type === 'open_booking' && navigate(`/bookings/${a.bookingId}`)} />
                        ))}
                      </HStack>
                    </ChatMessageBubble>
                  ) : null}
                </ChatMessage>
              ))}
              {pending ? <ChatSystemMessage>Смотрю данные…</ChatSystemMessage> : null}
            </ChatMessageList>
          ) : null}
        </ChatLayout>
      </VStack>
    </main>
  );
}
