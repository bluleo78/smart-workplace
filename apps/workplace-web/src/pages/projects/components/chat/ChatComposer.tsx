// chat 메시지 작성 폼 — TipTap 기반 RichInput 래퍼.
// Enter=전송, Shift+Enter=줄바꿈, @=멘션. 전송 후 비우고 포커스 유지.

import { convertPlaintextMentions } from '@/components/mentions/mentionSerialize';
import { RichInput } from '@/components/mentions/RichInput';

import type { ChatMemberResponse } from '../../../../types/chat';

interface ChatComposerProps {
  members: ChatMemberResponse[];
  // Promise 를 반환하면 RichInput 이 성공(resolve) 시에만 입력창을 비운다 — 전송 실패 시 입력 보존(#123).
  onSubmit: (body: string) => void | Promise<unknown>;
  // 입력 중일 때마다 호출 (타이핑 송신). 호출처에서 throttle.
  onTyping?: () => void;
}

export function ChatComposer({ members, onSubmit, onTyping }: ChatComposerProps) {
  // #366: 자동완성 없이 평문으로 @에이전트 를 타이핑한 경우에도 <@id> 로 변환해 AI 트리거가 누락되지 않게 한다.
  const handleSubmit = (body: string) => onSubmit(convertPlaintextMentions(body, members));
  return (
    <div className="border-t p-3" data-testid="chat-composer">
      <RichInput
        members={members}
        onSubmit={handleSubmit}
        onChange={onTyping}
        clearOnSubmit
        disableWhenEmpty
        submitLabel="보내기"
        inputTestId="chat-composer-input"
        submitTestId="chat-composer-submit"
      />
    </div>
  );
}
