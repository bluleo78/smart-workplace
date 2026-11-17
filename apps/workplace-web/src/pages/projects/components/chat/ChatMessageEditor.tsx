// 본인 메시지 인라인 수정 — RichInput 재사용. Enter=저장, Esc=취소.
// 입력창 위에 붙인 파일 칩(×)을 보여 잘못 붙인 파일을 뺄 수 있다(WP-1680, 팀 채팅 MessageEditor 와 같은 공용 훅).
// 수정 중일 때만 마운트되므로 × 로 뺀 상태는 이 컴포넌트 안에만 있고, 취소·다시 열기 = 처음(빼지 않음)으로 돌아간다.

import { ComposerAttachmentChips } from '@/components/chat/ComposerAttachmentChips';
import { useEditableAttachments } from '@/components/chat/useEditableAttachments';
import { RichInput } from '@/components/mentions/RichInput';

import type { ChatMemberResponse, ChatMessageResponse } from '../../../../types/chat';

interface ChatMessageEditorProps {
  message: ChatMessageResponse;
  members: ChatMemberResponse[];
  /** 저장 — keepFileIds 는 파일을 뺐거나 본문에 보이는 글자가 없을 때만 넘긴다(그 밖은 undefined = 본문만 수정). */
  onSave: (body: string, keepFileIds?: number[]) => void;
  onCancel: () => void;
}

export function ChatMessageEditor({
  message: m,
  members,
  onSave,
  onCancel,
}: ChatMessageEditorProps) {
  const { chips, remove, removedAny, canSubmitEmpty, keepFileIdsFor } = useEditableAttachments(m.attachments, m.driveLinks);

  return (
    <div className="px-3 py-2" data-testid="chat-message-editor">
      {/* 붙인 파일 칩 — 입력창 위. × 는 저장 전까지 화면에서만 뺀다. 수정 중 파일 추가는 범위 밖이다. */}
      <ComposerAttachmentChips testIdPrefix="chat-message-editor" pending={chips} onRemoveFile={remove} />
      <RichInput
        ariaLabel="메시지 수정"
        members={members}
        initialBody={m.body}
        initialMentions={m.mentions}
        onSubmit={(body) => onSave(body, keepFileIdsFor(body))}
        onCancel={onCancel}
        submitLabel="저장"
        autoFocus
        // 본문이 비어도 남은 파일이나 드라이브 링크가 있으면 저장할 수 있다. 모두 비면 저장 비활성(서버도 400).
        disableWhenEmpty
        allowEmptySubmit={canSubmitEmpty}
        // 파일만 뺀 저장도 「변경 있음」이다(본문이 같아도 PATCH 를 보낸다).
        changedOutsideBody={removedAny}
        // 서식 입력(WP-101) — 작성창과 같은 서식 도구·단축키. 본문 마크다운을 서식으로 복원해 편집한다.
        formatting
        // 작성 입력창과 같은 서버 상한(4000자) — 넘으면 카운터를 보이고 저장을 막는다(WP-683, 팀 채팅 WP-513 과 같은 규칙).
        maxLength={4000}
        inputTestId="chat-message-editor-input"
        submitTestId="chat-message-editor-save"
        cancelTestId="chat-message-editor-cancel"
      />
    </div>
  );
}
