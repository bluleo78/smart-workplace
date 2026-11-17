// 팀 채팅 메시지 인라인 수정 에디터 — 본문(RichInput)과 붙인 파일 칩(×, WP-1679).
// 수정 중일 때만 마운트된다(MessageRow 가 isEditing 으로 그린다) — 그래서 × 로 뺀 상태는 이 컴포넌트 안에만 있고,
// 취소하거나 다시 열면 상태가 저절로 처음(빼지 않음)으로 돌아간다. 저장은 본문과 남길 파일을 한 번에 보낸다.
import { useState } from 'react'

import { ComposerAttachmentChips } from '@/components/chat/ComposerAttachmentChips'
import { RichInput } from '@/components/mentions/RichInput'
import type { MentionCandidate } from '@/components/mentions/types'
import type { PendingFile } from '@/hooks/useAttachmentDraft'
import { hasVisibleText } from '@/lib/visibleText'
import type { MessageAttachment, MessageResponse } from '@/types/messaging'

interface MessageEditorProps {
  message: MessageResponse
  // @멘션 후보(RichInput 용).
  members: MentionCandidate[]
  /** 저장 — keepFileIds 는 파일을 뺐거나 본문에 보이는 글자가 없을 때만 넘긴다(그 밖은 undefined = 본문만 수정, 예전 요청과 같은 모양). */
  onSubmit: (body: string, keepFileIds?: number[]) => void
  onCancel: () => void
}

/** 메시지 첨부를 칩 목록이 받는 모양으로 — 칩은 이름만 그린다. */
const toPendingFile = (a: MessageAttachment): PendingFile => ({
  fileId: a.fileId,
  originalName: a.originalName,
  mimeType: a.mimeType,
  sizeBytes: a.sizeBytes,
})

export function MessageEditor({ message: m, members, onSubmit, onCancel }: MessageEditorProps) {
  // × 로 뺀 file id. 「남길 것」이 아니라 「뺀 것」을 들고 있는 이유: 남길 목록은 늘 지금 캐시의 첨부(m.attachments)에서 계산해
  // 다른 기기의 수정(SSE)으로 이미 빠진 파일이 칩에도 저장 요청에도 되살아나지 않게 한다(교집합 — 서버는 빠진 id 를 남기라 하면 400).
  const [removed, setRemoved] = useState<ReadonlySet<number>>(() => new Set())

  const kept = (m.attachments ?? []).filter((a) => !removed.has(a.fileId))
  // 지금 붙은 파일 중 실제로 뺀 것이 있는가 — 본문이 처음과 같아도 저장해야 한다(RichInput 의 「변경 없음 → 닫기」를 끈다).
  const removedAny = (m.attachments ?? []).some((a) => removed.has(a.fileId))
  // 드라이브 링크는 칩으로 고치지 않고 그대로 남는다 — 링크가 있으면 본문·파일이 비어도 빈 메시지가 아니다(서버 판정과 같다).
  const hasDriveLinks = (m.driveLinks?.length ?? 0) > 0

  // keepFileIds 를 싣는 때는 둘뿐이다 — (a) 파일을 하나라도 뺐을 때, (b) 본문에 보이는 글자가 없어 첨부·드라이브 링크로만 남는 메시지일 때.
  // (b) 를 빼면 드라이브 링크만 남는 메시지의 {body:''} 를 서버가 빈 메시지로 400 낸다 — keep(빈 배열 가능)이 있어야 링크까지 보고 판정한다.
  // 그 밖(본문만 고침)은 {body} 만 보낸다: 다른 기기가 막 뺀 파일이 캐시에 남아 있어도 순수 글 수정이 「붙지 않은 첨부」 400 으로 막히지 않게.
  const submit = (body: string) =>
    onSubmit(body, removedAny || !hasVisibleText(body) ? kept.map((a) => a.fileId) : undefined)

  return (
    <div data-testid={`message-editor-${m.id}`}>
      {/* 붙인 파일 칩 — 입력창 위. × 는 저장 전까지 화면에서만 뺀다. 수정 중 파일 추가는 범위 밖이다. */}
      <ComposerAttachmentChips
        testIdPrefix="message-editor"
        pending={kept.map(toPendingFile)}
        onRemoveFile={(fileId) => setRemoved((prev) => new Set(prev).add(fileId))}
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
        allowEmptySubmit={kept.length > 0 || hasDriveLinks}
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
