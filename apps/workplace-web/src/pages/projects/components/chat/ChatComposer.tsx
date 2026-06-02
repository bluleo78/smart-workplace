// chat 메시지 작성 폼 — TipTap 기반 RichInput 래퍼.
// Enter=전송, Shift+Enter=줄바꿈, @=멘션. 전송 후 비우고 포커스 유지.

import type { ChatMemberResponse } from '../../../../types/chat';
import { RichInput } from '@/components/mentions/RichInput';

interface ChatComposerProps {
  members: ChatMemberResponse[];
  onSubmit: (body: string) => void;
  // 입력 중일 때마다 호출 (타이핑 송신). 호출처에서 throttle.
  onTyping?: () => void;
}

export function ChatComposer({ members, onSubmit, onTyping }: ChatComposerProps) {
  return (
    <div className="border-t p-3" data-testid="chat-composer">
      <RichInput
        members={members}
        onSubmit={onSubmit}
        onChange={onTyping}
        clearOnSubmit
        submitLabel="보내기"
        inputTestId="chat-composer-input"
        submitTestId="chat-composer-submit"
      />
    </div>
  );
}
