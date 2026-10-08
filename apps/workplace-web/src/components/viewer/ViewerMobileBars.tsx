import { Cloud, Download, Loader2, type LucideIcon, Share2, Sparkles, X } from 'lucide-react'

import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { DialogClose, DialogDescription, DialogTitle } from '../ui/dialog'
import type { ViewerItem } from './types'
import type { ActionSlot, ShareState, SlotId } from './viewerActions'
import { splitName } from './viewerNav'

/** 바 겹침 레이어 공통 — 본문 위에 반투명으로 뜨고, 숨김 시 inert·투명(탭으로 다시 표시, Task 6). */
// 좌우 안전영역도 직접 — absolute inset-x-0 은 루트의 padding(safe-area)을 무시하므로 가로 모드에서 ✕·⋯ 가 노치 아래로 들어간다(시안 M5).
const barClass =
  'absolute inset-x-0 z-20 bg-background/80 pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] backdrop-blur transition-opacity duration-200'

/**
 * 뷰어 제목·설명(데스크톱 헤더·모바일 상단 바 공용) — 다이얼로그 접근 이름은 전체 파일명 + "미리보기"(스펙 §5.2).
 * 화면 이름은 [앞부분][꼬리] 두 span — 앞부분만 폭에 맞춰 CSS 말줄임하고 꼬리(확장자 포함)는 줄지 않아
 * 360px 같은 좁은 폭에서도 확장자가 늘 보인다(가운데 말줄임, 시안 M1). 설명(크기·순번·쪽 메타)은 preview-meta 로 다이얼로그 설명에 쓴다.
 * 감싸는 배치(정렬·폭)는 호출부가 정한다 — inline-flex 라 모바일 상단 바의 text-center 를 그대로 따른다.
 */
export function ViewerTitle({ item, meta }: { item: ViewerItem; meta: string }) {
  const [head, tail] = splitName(item.name)
  return (
    <>
      <DialogTitle className="overflow-hidden text-sm font-medium" title={item.name} data-testid="viewer-title">
        <span aria-hidden className="inline-flex max-w-full align-bottom">
          {/* whitespace-pre — 잘리는 자리 끝의 공백("보고서 v3.pdf")이 flex 항목 끝에서 사라지지 않게. */}
          <span className="min-w-0 overflow-hidden text-ellipsis whitespace-pre" data-testid="viewer-title-head">
            {head}
          </span>
          <span className="shrink-0 whitespace-pre" data-testid="viewer-title-tail">
            {tail}
          </span>
        </span>
        <span className="sr-only">{item.name} 미리보기</span>
      </DialogTitle>
      <DialogDescription className="truncate text-xs text-muted-foreground" data-testid="preview-meta">
        {meta}
      </DialogDescription>
    </>
  )
}

/**
 * 모바일 상단 바(WP-278, 스펙 §4.2·시안 M1) — ✕ · 파일명(가운데 말줄임)/순번·쪽 · ⋯.
 * 노치 아래로 내려오도록 safe-area-inset-top 만큼 위 여백을 둔다(뷰어는 포털이라 MobileShell 의 안전영역 처리 밖).
 */
export function ViewerMobileTopBar({
  item,
  meta,
  hidden,
  barRef,
  more,
}: {
  item: ViewerItem
  meta: string
  hidden: boolean
  barRef?: React.Ref<HTMLElement>
  /** ⋯ 메뉴(ViewerMoreMenu) — 항목이 없으면 null 이어도 제목이 가운데에 남도록 자리는 유지한다. */
  more: React.ReactNode
}) {
  return (
    <header
      ref={barRef}
      inert={hidden}
      data-testid="viewer-top-bar"
      className={cn(barClass, 'top-0 flex min-h-14 items-center gap-1 px-1 pt-[env(safe-area-inset-top)]', hidden && 'pointer-events-none opacity-0')}
    >
      <DialogClose asChild>
        <Button variant="ghost" size="icon" className="size-11" aria-label="닫기">
          <X />
        </Button>
      </DialogClose>
      <div className="min-w-0 flex-1 text-center">
        <ViewerTitle item={item} meta={meta} />
      </div>
      <div className="flex size-11 shrink-0 items-center justify-center">{more}</div>
    </header>
  )
}

/** 칸별 표시 — 보이는 글자가 접근 이름에 포함되게(WCAG 2.5.3) 라벨을 고른다. testId 는 데스크톱 ⬇ 와 같은 preview-download 를 잇는다. */
const SLOT_META: Record<SlotId, { label: string; icon: LucideIcon; testId: string }> = {
  save: { label: '저장', icon: Download, testId: 'preview-download' },
  share: { label: '공유', icon: Share2, testId: 'viewer-slot-share' },
  drive: { label: '드라이브', icon: Cloud, testId: 'viewer-slot-drive' },
  summary: { label: '요약', icon: Sparkles, testId: 'viewer-slot-summary' },
}

/** 칸 접근 이름 — 공유는 비활성 사유(받는 중/불가)를 이름에 담아 화면낭독기가 왜 못 누르는지 알게 한다. 플랫폼 미지원('none')은 칸 자체가 비어 이름이 쓰이지 않는다. */
function slotAriaLabel(id: SlotId, share: ShareState): string {
  if (id === 'share') return share === 'ready' ? '공유' : share === 'loading' ? '공유 (받는 중)' : '공유할 수 없음'
  if (id === 'drive') return '드라이브로 가져오기'
  if (id === 'summary') return 'AI 요약'
  return '저장'
}

/**
 * 모바일 하단 액션 바(WP-278, 스펙 §4.2) — 4칸 위치 고정. 빈칸은 같은 폭의 자리만 차지한다(넘겨도 버튼이 움직이지 않게).
 * children: 바 위에 얹는 얇은 띠(참조된 곳, 판정 R11).
 */
export function ViewerActionBar({
  slots,
  share,
  summaryOpen,
  hidden,
  covered = false,
  barRef,
  onAction,
  children,
}: {
  slots: ActionSlot[]
  share: ShareState
  summaryOpen: boolean
  hidden: boolean
  /** 요약 시트가 위를 덮음 — 보이는 그대로 두되 inert 로 빼 Tab·화면낭독기가 시트 뒤 칸으로 새지 않게. */
  covered?: boolean
  barRef?: React.Ref<HTMLDivElement>
  onAction: (id: SlotId) => void
  children?: React.ReactNode
}) {
  return (
    <div
      ref={barRef}
      inert={hidden || covered}
      data-testid="viewer-action-bar"
      className={cn(barClass, 'bottom-0 pb-[env(safe-area-inset-bottom)]', hidden && 'pointer-events-none opacity-0')}
    >
      {children}
      <div className="grid grid-cols-4">
        {slots.map((s) => {
          const m = SLOT_META[s.id]
          // 공유 "받는 중"은 돌아가는 아이콘 + "받는 중" 글자로 "공유할 수 없음"(흐린 공유 아이콘)과 눈으로 구분한다.
          // 보이는 "받는 중"은 접근 이름 "공유 (받는 중)"에 포함된다(WCAG 2.5.3).
          const loading = s.id === 'share' && share === 'loading'
          const Icon = loading ? Loader2 : m.icon
          return (
            <div key={s.id} data-slot-id={s.id} data-state={s.state} className="flex min-h-14 items-stretch justify-center">
              {s.state !== 'empty' && (
                <button
                  type="button"
                  disabled={s.state === 'disabled'}
                  aria-label={slotAriaLabel(s.id, share)}
                  aria-pressed={s.id === 'summary' ? summaryOpen : undefined}
                  onClick={() => onAction(s.id)}
                  data-testid={m.testId}
                  className="flex w-full flex-col items-center justify-center gap-0.5 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                >
                  <Icon
                    className={cn('size-5', loading && 'animate-spin')}
                    aria-hidden
                    data-testid={loading ? 'viewer-slot-share-spinner' : undefined}
                  />
                  <span aria-hidden>{loading ? '받는 중' : m.label}</span>
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
