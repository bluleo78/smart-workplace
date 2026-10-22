// 본인 메시지 인라인 수정 — RichInput 재사용. Enter=저장, Esc=취소.

import { RichInput } from '@/components/mentions/RichInput';

import type { ChatMemberResponse, ChatMentionResponse } from '../../../../types/chat';

interface ChatMessageEditorProps {
  initialBody: string;
  initialMentions: ChatMentionResponse[];
  members: ChatMemberResponse[];
  onSave: (body: string) => void;
  onCancel: () => void;
}

export function ChatMessageEditor({
  initialBody,
  initialMentions,
  members,
  onSave,
  onCancel,
}: ChatMessageEditorProps) {
  return (
    <div className="px-3 py-2" data-testid="chat-message-editor">
      <RichInput
        ariaLabel="메시지 수정"
        members={members}
        initialBody={initialBody}
        initialMentions={initialMentions}
        onSubmit={onSave}
        onCancel={onCancel}
        submitLabel="저장"
        autoFocus
        // 작성 입력창과 같은 서버 상한(4000자) — 넘으면 카운터를 보이고 저장을 막는다(WP-683, 팀 채팅 WP-513 과 같은 규칙).
        maxLength={4000}
        inputTestId="chat-message-editor-input"
        submitTestId="chat-message-editor-save"
        cancelTestId="chat-message-editor-cancel"
      />
    </div>
  );
}
