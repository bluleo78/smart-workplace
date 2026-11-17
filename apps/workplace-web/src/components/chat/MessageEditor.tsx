// 팀 채팅 메시지 인라인 수정 에디터 — 본문(RichInput)과 붙인 파일 칩(×, WP-1679).
// 수정 중일 때만 마운트된다(MessageRow 가 isEditing 으로 그린다) — 그래서 × 로 뺀 상태는 이 컴포넌트 안에만 있고,
// 취소하거나 다시 열면 상태가 저절로 처음(빼지 않음)으로 돌아간다. 저장은 본문과 남길 파일을 한 번에 보낸다.
import { ComposerAttachmentChips } from '@/components/chat/ComposerAttachmentChips'
import { RichInput } from '@/components/mentions/RichInput'
import type { MentionCandidate } from '@/components/mentions/types'
import type { MessageResponse } from '@/types/messaging'

import { useEditableAttachments } from './useEditableAttachments'

interface MessageEditorProps {
  message: MessageResponse
  // @멘션 후보(RichInput 용).
  members: MentionCandidate[]
  /** 저장 — keepFileIds 는 파일을 뺐거나 본문에 보이는 글자가 없을 때만 넘긴다(그 밖은 undefined = 본문만 수정, 예전 요청과 같은 모양). */
  onSubmit: (body: string, keepFileIds?: number[]) => void
  onCancel: () => void
}

export function MessageEditor({ message: m, members, onSubmit, onCancel }: MessageEditorProps) {
  // 뺀 칩 상태·keepFileIds 판정은 이슈 챗 수정 화면과 공용 훅(WP-1680 에서 이 파일에서 옮김).
  const { chips, remove, removedAny, canSubmitEmpty, keepFileIdsFor } = useEditableAttachments(m.attachments, m.driveLinks)

  const submit = (body: string) => onSubmit(body, keepFileIdsFor(body))

  return (
    <div data-testid={`message-editor-${m.id}`}>
      {/* 붙인 파일 칩 — 입력창 위. × 는 저장 전까지 화면에서만 뺀다. 수정 중 파일 추가는 범위 밖이다. */}
      <ComposerAttachmentChips
        testIdPrefix="message-editor"
        pending={chips}
        onRemoveFile={remove}
      />
      <RichInput
        ariaLabel="메시지 수정"
        members={members}
        initialBody={m.body}
        initialMentions={m.mentions}
        onSubmit={submit}
        onCancel={onCancel}
        submitLabel="저장"
        autoFocus
        // 본문이 비어도 남은 파일이나 드라이브 링크가 있으면 저장할 수 있다. 모두 비면 저장 비활성(서버도 400).
        disableWhenEmpty
        allowEmptySubmit={canSubmitEmpty}
        changedOutsideBody={removedAny}
        // 서식 입력(WP-101) — 작성창과 같은 서식 도구·단축키. 본문 마크다운을 서식으로 복원해 편집한다.
        formatting
        // 작성 입력창과 같은 서버 상한(4000자) — 넘으면 카운터를 보이고 저장을 막는다(WP-513).
        maxLength={4000}
        inputTestId={`message-editor-input-${m.id}`}
        submitTestId={`message-editor-save-${m.id}`}
        cancelTestId={`message-editor-cancel-${m.id}`}
      />
    </div>
  )
}
