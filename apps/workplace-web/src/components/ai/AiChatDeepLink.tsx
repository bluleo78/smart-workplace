// WP-384 대화 딥링크 `/?chat=<sessionId>` — 앱 어디서든 이 파라미터를 보면 AI 패널(데스크톱 사이드·모바일 시트)을 열고 그 대화를 복원한 뒤
// 파라미터를 지운다(replace — 뒤로 가기로 다시 열리지 않게, 다른 쿼리는 그대로). 없는(지움·남의) 대화는 토스트. AI 답 안 대화 링크도 같은
// 파라미터로 이 컴포넌트를 거친다(MarkdownMessage AiLink). AppLayout 이 비서가 있을 때만 그린다.
import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { useAssistant } from '@/components/ai/AIAssistantContext';
import { useChatSessionContext } from '@/hooks/chat-session-context';
import { CHAT_NOT_FOUND_MESSAGE, CHAT_PARAM, isSessionId } from '@/lib/aiChatLink';

export function AiChatDeepLink() {
  const [params, setParams] = useSearchParams();
  const { mode, open } = useAssistant();
  const { openSession } = useChatSessionContext();
  const chatId = params.get(CHAT_PARAM);
  // 같은 값으로 두 번 처리하지 않는다(파라미터를 지우는 렌더 사이 StrictMode 재실행 등). 파라미터가 사라지면 풀어 같은 링크를 다시 누를 수 있게.
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!chatId) {
      handled.current = null;
      return;
    }
    if (handled.current === chatId) return;
    handled.current = chatId;
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(CHAT_PARAM);
        return next;
      },
      { replace: true },
    );
    if (!isSessionId(chatId)) {
      toast.error(CHAT_NOT_FOUND_MESSAGE);
      return;
    }
    // 이미 열려 있으면(전체 화면 포함) 모드를 바꾸지 않는다.
    if (mode === 'closed') open('side');
    void openSession(chatId).then((r) => {
      if (r === 'not-found') toast.error(CHAT_NOT_FOUND_MESSAGE);
    });
  }, [chatId, mode, open, openSession, setParams]);

  return null;
}
