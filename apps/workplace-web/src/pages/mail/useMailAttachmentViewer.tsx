// 메일 첨부 통합 뷰어 상태(WP-280) — 열린 메일 한 통의 목록 첨부를 한 묶음으로 여는 단일 소유자.
// 무엇을: ?preview 히스토리 키·묶음(useViewerBundle)·뷰어/찾을 수 없음 노드를 한 곳에서 만든다(useIssueAttachmentViewer 와 같은 모양).
// 왜: 열림을 URL ?preview=mail:{id} 로 두어 시스템 뒤로가기가 뷰어만 닫고 메일 상세(?messageId)는 그대로 남게 한다.

import type { ReactNode } from 'react'

import { AttachmentViewer } from '../../components/viewer/AttachmentViewer'
import { useViewerBundle } from '../../components/viewer/useViewerBundle'
import { isMailViewerKey, mailAttachmentItem } from '../../components/viewer/viewerItems'
import { ViewerNotFound } from '../../components/viewer/ViewerNotFound'
import { useHistoryParam } from '../../hooks/useHistoryParam'
import type { EmailAttachmentMeta } from '../../types/mailMessage'

/**
 * @param attachments 묶음 원본 — 본문 인라인 이미지로 표시된 첨부를 뺀 목록(listedAttachments).
 * @param ready 메일 상세 조회가 끝났는지(실패 포함) — 끝났는데 키가 목록에도 스냅숏에도 없으면 "찾을 수 없음".
 */
export function useMailAttachmentViewer(
  attachments: EmailAttachmentMeta[],
  ready: boolean,
): {
  /** 첨부 칩 클릭 — 그 첨부로 뷰어를 연다. */
  onPreview: (a: EmailAttachmentMeta) => void
  /** 뷰어·찾을 수 없음 안내 — 호출부가 상세 트리의 고정 위치에 한 번만 그린다. */
  viewerNode: ReactNode
} {
  // 열림 = URL ?preview(뒤로가기 = 닫기).
  const previewParam = useHistoryParam('preview')
  // 메일 키(mail:{id})만 다룬다 — 다른 용도의 ?preview 값을 이 화면이 "찾을 수 없음"으로 안내하지 않게.
  const ownKey = isMailViewerKey(previewParam.value) ? previewParam.value : null
  const viewer = useViewerBundle({
    list: attachments,
    toItem: mailAttachmentItem,
    currentKey: ownKey,
    ready,
    openKey: previewParam.open,
  })

  const viewerNode = (
    <>
      {viewer.bundle && (
        <AttachmentViewer
          items={viewer.bundle.items}
          index={viewer.bundle.index}
          onIndexChange={viewer.onIndexChange}
          onClose={previewParam.close}
          // 메일은 개인 사서함 — 첨부 콘텐츠가 소유자 전용(타인은 404)이라 링크를 복사해도 다른 사람은 열 수 없다.
          shareable={false}
        />
      )}
      {viewer.missing && (
        <ViewerNotFound onClose={previewParam.close} description="이 메일에 없는 첨부입니다." />
      )}
    </>
  )
  return { onPreview: viewer.open, viewerNode }
}
