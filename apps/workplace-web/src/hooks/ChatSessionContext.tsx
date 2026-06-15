// 챗 세션 상태(transcript + sessionId)를 AppLayout 레벨에서 제공.
// 챗 도크는 전역 상주(모든 모듈) — side/fullscreen 패널이 같은 세션을 공유한다.
import type { ReactNode } from 'react';

import { ChatSessionContext } from './chat-session-context';
import { useChatSession } from './useChatSession';

export function ChatSessionProvider({ children }: { children: ReactNode }) {
  const session = useChatSession();
  return <ChatSessionContext value={session}>{children}</ChatSessionContext>;
}
