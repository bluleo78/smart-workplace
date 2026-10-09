import { MobileDetailBar } from '@/components/mobile/MobileDetailBar'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

import type { WikiRevisionHistory } from './useWikiRevisionHistory'
import { revisionVersionLabel } from './wikiRevisionFormat'
import { WikiRevisionList } from './WikiRevisionPanel'
import { WikiRevisionPreviewBody } from './WikiRevisionPreviewBody'

/**
 * 모바일 전체화면 층 — 셸 <main> 의 콘텐츠 영역(노트 헤더 포함)을 덮는다(AIFullscreen 과 같은 z-[46]: 헤더 z-45 위, 오버레이 z-50 아래).
 * Radix Sheet/Dialog 가 아닌 평범한 div 라 비모달이다 — body pointer-events 잠금·포커스 가둠이 없어 토스트를 그대로 누를 수 있다.
 * absolute 칸은 <main> 의 padding box 를 기준으로 해 main 의 안전영역 여백을 받지 못하므로 위·아래 안전영역은 이 층이 직접 비운다.
 */
const layerClass = 'absolute inset-0 z-[46] flex flex-col bg-background'

/**
 * 모바일 노트 버전 기록(WP-282) — 전체화면 "‹ 버전 기록" 목록 → 판을 누르면 전체화면 "‹ {판 이름}" 미리보기(오늘 "14:05 버전", 어제 "어제 17:48 버전").
 *
 * - ‹ = 시스템 뒤로가기: 미리보기 ‹ 는 rev 를, 목록 ‹ 는 history 를 닫는다(useHistoryParam close — 연 표식이 있으면 뒤로가기,
 *   콜드 딥링크면 쿼리만 지운다). 기본 useMobileBack(navigate(-1)·모듈 루트)은 콜드 `?history=1&rev=5` 에서 노트 밖으로 나간다.
 * - 목록은 미리보기 중에도 마운트해 둔다(미리보기는 그 위의 층) — 뒤로 돌아오면 보던 스크롤 위치 그대로다.
 * - 변경 표시 토글은 미리보기 헤더 오른쪽 — 스위치만 두면 무엇을 켜는지 모르므로 "변경 표시" 글자를 붙이고,
 *   글자까지 감싼 label 전체를 44px 터치 타깃으로 둔다(390px 에서 ‹ 44 + 제목 + 토글 약 100px 로 한 줄에 들어간다).
 * - 하단 고정 "이 버전으로 복원" — 편집 권한(canRestore)이 있고 고른 판이 목록에 있을 때만. 성공하면 목록까지 닫고 노트로 돌아간다.
 */
export function WikiRevisionMobile({
  revisions,
  pageId,
  canRestore,
}: {
  revisions: WikiRevisionHistory
  pageId: number
  /** 편집 권한(동기화 세션 판정) — 없으면 하단 복원 버튼을 두지 않는다. */
  canRestore: boolean
}) {
  const { selectedItem } = revisions
  // 판을 골랐으면 미리보기 층이 목록 위를 덮는다 — 그동안 아래 목록은 보조기술·포커스 이동에서 뺀다(스크롤 위치 보존용으로 마운트만 둔다).
  const previewing = revisions.selectedVersion != null
  return (
    <div data-testid="wiki-revision-mobile" aria-label="버전 기록" role="region" className={cn(layerClass, 'pt-[env(safe-area-inset-top)]')}>
      <div inert={previewing} aria-hidden={previewing || undefined} className="flex min-h-0 flex-1 flex-col">
        <MobileDetailBar title="버전 기록" showAi={false} onBack={revisions.close} />
        <WikiRevisionList
          revisions={revisions}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[calc(0.5rem+env(safe-area-inset-bottom))]"
        />
      </div>
      {previewing && (
        <div
          data-testid="wiki-revision-mobile-preview"
          aria-label="버전 미리보기"
          role="region"
          className={cn(layerClass, 'pt-[env(safe-area-inset-top)]')}
        >
          <MobileDetailBar
            title={selectedItem ? revisionVersionLabel(selectedItem.editedAt) : '버전 미리보기'}
            showAi={false}
            onBack={revisions.clearSelection}
            trailing={
              <label className="flex h-11 shrink-0 cursor-pointer items-center gap-2 px-3 text-sm text-foreground">
                <Switch
                  size="sm"
                  checked={revisions.showDiff}
                  onCheckedChange={revisions.setShowDiff}
                  data-testid="wiki-revision-diff-toggle"
                />
                변경 표시
              </label>
            }
          />
          <div data-testid="wiki-revision-preview-scroll" className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <WikiRevisionPreviewBody revisions={revisions} pageId={pageId} />
          </div>
          {/* 하단 고정 복원 — 홈 인디케이터만큼 아래를 비운다(이 층은 main 의 안전영역 여백 밖이다). 미리보기가 없으면 안전영역만 남긴다. */}
          {canRestore && selectedItem ? (
            <div className="shrink-0 border-t bg-background px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
              <Button
                type="button"
                className="h-11 w-full"
                onClick={() => revisions.restore({ closeHistory: true })}
                disabled={revisions.restoring}
                data-testid="wiki-revision-restore"
              >
                이 버전으로 복원
              </Button>
            </div>
          ) : (
            <div className="shrink-0 pb-[env(safe-area-inset-bottom)]" />
          )}
        </div>
      )}
    </div>
  )
}
