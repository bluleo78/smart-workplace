// 챗 세션 컨텍스트의 비(非)컴포넌트 조각 — 값 타입 / 컨텍스트 / 소비 훅.
// Provider 컴포넌트(ChatSessionProvider)는 ChatSessionContext.tsx 에 분리(react-refresh 규칙).
// 챗 도크(side/fullscreen 패널)는 모드 전환마다 마운트/언마운트되므로, 세션 상태를
// AppLayout 레벨 컨텍스트로 끌어올려 두 패널이 같은 transcript/세션을 공유하게 한다.
import { createContext, useContext } from 'react';

import type { useChatSession } from './useChatSession';

export type ChatSessionValue = ReturnType<typeof useChatSession>;

export const ChatSessionContext = createContext<ChatSessionValue | null>(null);

// 세션 컨텍스트 소비 훅. Provider 밖에서 호출 시 에러.
export function useChatSessionContext(): ChatSessionValue {
  const ctx = useContext(ChatSessionContext);
  if (!ctx) throw new Error('useChatSessionContext must be used within ChatSessionProvider');
  return ctx;
}
