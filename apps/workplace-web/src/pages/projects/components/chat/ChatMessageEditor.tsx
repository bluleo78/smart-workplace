// 본인 메시지 인라인 수정 — ChatRichInput 재사용. Enter=저장, Esc=취소.

import type { ChatMemberResponse, ChatMentionResponse } from '../../../../types/chat';
import { ChatRichInput } from './ChatRichInput';

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
      <ChatRichInput
        members={members}
        initialBody={initialBody}
        initialMentions={initialMentions}
        onSubmit={onSave}
        onCancel={onCancel}
        submitLabel="저장"
        autoFocus
        inputTestId="chat-message-editor-input"
        submitTestId="chat-message-editor-save"
        cancelTestId="chat-message-editor-cancel"
      />
    </div>
  );
}
