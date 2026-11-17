// 메시지 수정 중 붙인 파일 칩(×) 편집 로직 — 팀 채팅 MessageEditor(WP-1679)와 이슈 챗 ChatMessageEditor(WP-1680)가 같이 쓴다.
// 수정 중일 때만 마운트되는 에디터 안에서 쓰므로, 뺀 상태는 에디터 수명과 같다(취소·다시 열기 = 처음으로).
import { useState } from 'react'

import type { PendingFile } from '@/hooks/useAttachmentDraft'
import { hasVisibleText } from '@/lib/visibleText'
import type { DriveLink } from '@/types/drive'
import type { MessageAttachment } from '@/types/messaging'

/** 메시지 첨부를 칩 목록이 받는 모양으로 — 칩은 이름만 그린다. */
const toPendingFile =(a: MessageAttachment): PendingFile => ({
  fileId: a.fileId,
  originalName: a.originalName,
  mimeType: a.mimeType,
  sizeBytes: a.sizeBytes,
})

/**
 * 저장 요청에 싣을 keepFileIds 를 정한다(순수 함수).
 * 싣는 때는 둘뿐이다 — (a) 파일을 하나라도 뺐을 때, (b) 본문에 보이는 글자가 없어 첨부·드라이브 링크로만 남는 메시지일 때.
 * (b) 를 빼면 드라이브 링크만 남는 메시지의 {body:''} 를 서버가 빈 메시지로 400 낸다.
 * 그 밖(본문만 고침)은 undefined — 다른 기기가 막 뺀 파일이 캐시에 남아 있어도 순수 글 수정이 「붙지 않은 첨부」 400 으로 막히지 않게.
 */
export function keepFileIdsForEdit(args: {
  kept: MessageAttachment[]
  removedAny: boolean
  body: string
}): number[] | undefined {
  const { kept, removedAny, body } = args
  return removedAny || !hasVisibleText(body) ? kept.map((a) => a.fileId) : undefined
}

/**
 * 수정 중 첨부 칩 상태. 「뺀 id 집합」만 들고, 남길 목록은 늘 지금 캐시의 첨부에서 계산한다 —
 * 다른 기기의 수정(SSE)으로 이미 빠진 파일이 칩에도 저장 요청에도 되살아나지 않게 한다(서버는 빠진 id 를 남기라 하면 400).
 */
export function useEditableAttachments(attachments: MessageAttachment[] | undefined, driveLinks: DriveLink[] | undefined) {
  const [removed, setRemoved] = useState<ReadonlySet<number>>(() => new Set())

  const current = attachments ?? []
  const kept = current.filter((a) => !removed.has(a.fileId))
  // 지금 붙은 파일 중 실제로 뺀 것이 있는가 — 본문이 처음과 같아도 저장해야 한다.
  const removedAny = current.some((a) => removed.has(a.fileId))
  // 드라이브 링크는 칩으로 고치지 않고 그대로 남는다 — 링크가 있으면 본문·파일이 비어도 빈 메시지가 아니다(서버 판정과 같다).
  const canSubmitEmpty = kept.length > 0 || (driveLinks?.length ?? 0) > 0

  return {
    chips: kept.map(toPendingFile),
    remove: (fileId: number) => setRemoved((prev) => new Set(prev).add(fileId)),
    removedAny,
    canSubmitEmpty,
    keepFileIdsFor: (body: string) => keepFileIdsForEdit({ kept, removedAny, body }),
  }
}
