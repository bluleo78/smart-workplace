import type { ReactNode } from 'react'

import { pageReadingWidthClass } from '@/components/layout/Page'

import type { WikiRevisionHistory } from './useWikiRevisionHistory'
import { WikiRevisionBar } from './WikiRevisionBar'
import { revisionBarLabel } from './wikiRevisionFormat'
import { WikiRevisionMobile } from './WikiRevisionMobile'
import { WikiRevisionPanel } from './WikiRevisionPanel'
import { WikiRevisionPreviewBody } from './WikiRevisionPreviewBody'

/**
 * 노트 본문 줄 + 버전 기록(WP-282) — 데스크톱은 왼쪽 노트 칸(미리보기 바 + 에디터·미리보기 덮개), 오른쪽 버전 기록 패널.
 * 모바일은 노트 칸만 두고 버전 기록을 전체화면 층(WikiRevisionMobile)으로 연다 — 그 층은 노트 줄 밖(형제)에 두어
 * relative 노트 칸이 아닌 셸 <main> 을 기준으로 노트 헤더까지 덮는다.
 *
 * children(에디터 스크롤 영역)은 항상 같은 자리에 렌더한다 — 래퍼 구조가 미리보기 여부로 바뀌면 EditorContent 가 다시 마운트돼
 * (BubbleMenu insertBefore 함정) 연결 상태 화면이 깜빡이고, 미리보기 중에도 동기화 연결·미전송 입력·스크롤 위치가 남아야 한다.
 * 미리보기는 그 위를 덮는 absolute 칸이고, 에디터를 inert 로 가리는 일은 호출자(WikiEditor)가 맡는다.
 */
export function WikiRevisionLayer({
  revisions,
  pageId,
  isMobile,
  canRestore,
  children,
}: {
  revisions: WikiRevisionHistory
  pageId: number
  /** 모바일이면 미리보기 바·덮개·패널 대신 전체화면 층(WikiRevisionMobile)을 연다. */
  isMobile: boolean
  /** 편집 권한(동기화 세션 판정) — 없으면 복원 버튼을 두지 않는다. */
  canRestore: boolean
  children: ReactNode
}) {
  const { selectedItem } = revisions
  // 미리보기 바·덮개 — 데스크톱에서 판을 골랐을 때만.
  const previewing = !isMobile && revisions.selectedVersion != null
  return (
    <>
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 미리보기 바 — 노트 칸 위에만 둔다(패널까지 덮으면 판을 고르는 순간 목록이 바 높이만큼 밀려 내려간다).
            복원은 편집 권한이 있고 고른 판이 목록에 있을 때만(목록에 없는 rev 주소는 복원할 판 메타가 없다). */}
        {previewing && (
          <WikiRevisionBar
            label={selectedItem ? revisionBarLabel(selectedItem.editedAt) : null}
            showDiff={revisions.showDiff}
            onShowDiffChange={revisions.setShowDiff}
            onClose={revisions.clearSelection}
            onRestore={canRestore && selectedItem ? () => revisions.restore() : undefined}
            restoring={revisions.restoring}
          />
        )}
        <div className="relative flex min-h-0 flex-1 flex-col">
          {children}
          {/* 미리보기 덮개 — 에디터 스크롤 영역을 그대로 덮는 자체 스크롤 칸. 노트와 같은 여백·reading 폭. */}
          {previewing && (
            <div data-testid="wiki-revision-preview-scroll" className="absolute inset-0 overflow-y-auto bg-background">
              <WikiRevisionPreviewBody revisions={revisions} pageId={pageId} className={pageReadingWidthClass} />
            </div>
          )}
        </div>
      </div>
      {/* 버전 기록 패널 — 본문 오른쪽 인플로우 보조 칸(PersonalTaskPanel 리스트 모드와 같은 방식). */}
      {!isMobile && revisions.isOpen && <WikiRevisionPanel revisions={revisions} />}
    </div>
    {isMobile && revisions.isOpen && <WikiRevisionMobile revisions={revisions} pageId={pageId} canRestore={canRestore} />}
    </>
  )
}
