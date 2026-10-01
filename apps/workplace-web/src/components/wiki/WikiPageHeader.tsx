import {
  Check,
  ChevronDown,
  ChevronRight,
  FileCode,
  Loader2,
  MoreHorizontal,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { Fragment } from 'react'

import { AiLabel } from '@/components/ai/AiLabel'
import { aiSignalBadgeClass } from '@/components/ai/aiMarker'
import { AiSignalBadge } from '@/components/ai/AiSignalBadge'
import { MobileDetailBar } from '@/components/mobile/MobileDetailBar'
import { useMobileDetailHeader } from '@/components/mobile/MobileDetailContext'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { StatusBadge } from '@/components/ui/status-badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useIsMobile } from '@/hooks/useIsMobile'
import { cn } from '@/lib/utils'

import { GENERATE_ACTIONS, type GenerateActionKey } from './wikiAiActions'

export type SaveState = 'idle' | 'saving' | 'saved' | 'conflict'

/**
 * AI 사용 가능 상태 3분기 — 예전엔 boolean(canUseAi) 하나였고 false 면 메뉴 자체를 숨겨서
 * "기능 없음"·"권한 없음"·"아직 로딩 중"이 사용자에게 전부 동일하게 보였다(#733).
 * 이제 버튼은 항상 렌더하고 상태에 따라 비활성 + 사유를 텍스트로 노출한다(색·시각 단독 의존 금지).
 */
export type WikiAiState = 'loading' | 'denied' | 'ready'

/** aiState 별 비활성 사유 툴팁 문구. ready 면 툴팁 없이 활성. */
const AI_DISABLED_REASON: Record<Exclude<WikiAiState, 'ready'>, string> = {
  loading: '권한을 확인하는 중입니다',
  denied: '읽기 전용 권한이라 AI 작성을 사용할 수 없습니다',
}

/**
 * 노트 페이지 뷰 헤더 — 브레드크럼(조상 경로) + 저장상태 + AI 액션 버튼 + 더보기(삭제).
 * PageHeader 와 동일한 셸(h-14·border-b)을 쓰되, 브레드크럼은 nav 시맨틱이 필요해 직접 구성한다.
 *
 * AI 버튼 상시 노출이 핵심 — 이전엔 ⋯ 드롭다운 안에 "AI 초안 작성" 하나만 묻혀 있어
 * 노트 화면에 보이는 AI 어피던스가 사실상 0개였다(#733).
 */
export function WikiPageHeader({
  crumbs,
  saveState,
  aiState,
  aiBusy,
  aiAttributed,
  onNavigate,
  onAiAction,
  onDelete,
  onViewSource,
}: {
  crumbs: { id: number; title: string }[]
  saveState: SaveState
  aiState: WikiAiState
  aiBusy: boolean
  // #736: 이 페이지에 AI 생성 이력이 있는지 — 우측 AI 액션 버튼(기능 트리거)과는 별개로 좌측
  // 브레드크럼 옆에 콘텐츠 출처 신호를 노출한다(중첩 판정은 설계 문서 §5 참고).
  aiAttributed: boolean
  onNavigate: (pageId: number) => void
  onAiAction: (action: GenerateActionKey) => void
  onDelete: () => void
  /** 마크다운 소스 모달 열기(#753). 읽기 권한만 있으면 되므로 canEdit 과 무관하게 노출한다. */
  onViewSource: () => void
}) {
  const isMobile = useIsMobile()
  // 모바일 상세 분기 안이면 등록(→ 레이아웃 뒤로가기 바 숨김) 후 병합 헤더로 그린다(U2-8).
  const detail = useMobileDetailHeader(isMobile)
  // 툴팁 사유는 권한/로딩 사유만 노출(생성 중은 버튼 라벨이 "생성 중…"으로 이미 자명).
  const disabledReason = aiState === 'ready' ? null : AI_DISABLED_REASON[aiState]

  /**
   * AI 버튼 본체. 아이콘 간격은 Button cva 가 자동 적용하므로 gap 유틸을 직접 붙이지 않는다
   * (디자인시스템 07 아이콘 규격). AI 마커는 직접 조립하지 않고 AiLabel 프리미티브를 쓴다(07 재사용 의무).
   *
   * disabled 대신 aria-disabled 를 쓰는 이유: 진짜 disabled 는 pointer-events-none + tab 제외라
   * 사유 툴팁이 hover·focus 어느 경로로도 열리지 않는다. 포커스 가능 상태를 유지하고
   * aria-disabled + 색/불투명도로 비활성을 전달한다(components/ui/calendar.tsx 의 in-repo 선례).
   * 불투명도를 버튼 요소가 아니라 자식에만 적용하는 이유: 요소에 걸면 focus-visible 링(box-shadow)까지
   * 함께 흐려져, 포커스 가능하게 남겨둔 이 버튼의 포커스 대비 전제가 깨진다.
   */
  const aiTrigger = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-disabled={disabledReason != null || aiBusy}
      className={
        disabledReason != null || aiBusy
          ? 'text-muted-foreground [&_span]:text-muted-foreground [&_svg]:opacity-50'
          : undefined
      }
      data-testid="wiki-ai-header-button"
    >
      {aiBusy ? (
        <>
          <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
          생성 중…
        </>
      ) : (
        <AiLabel>AI</AiLabel>
      )}
      <ChevronDown className="text-muted-foreground" aria-hidden="true" />
    </Button>
  )

  // 저장 상태 칩 — 모바일은 헤더 폭(제목)을 지키려 아이콘만 보이고 글자는 스크린리더용으로 남긴다.
  const saveText = (label: string) => (isMobile ? <span className="sr-only">{label}</span> : label)
  const saveBadge = (
    <>
      {saveState === 'saving' && (
        <StatusBadge type="info" data-testid="wiki-save-state">
          <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
          {saveText('저장 중…')}
        </StatusBadge>
      )}
      {saveState === 'saved' && (
        <StatusBadge type="success" data-testid="wiki-save-state">
          <Check aria-hidden="true" />
          {saveText('저장됨')}
        </StatusBadge>
      )}
      {saveState === 'conflict' && (
        <StatusBadge type="error" data-testid="wiki-save-state">
          <TriangleAlert aria-hidden="true" />
          {saveText('충돌')}
        </StatusBadge>
      )}
    </>
  )
  // AI 액션 — 비활성이면 사유 툴팁, 활성이면 생성 메뉴.
  const aiControl = (
    <>
      {disabledReason ? (
        /* 비활성 — 드롭다운을 달지 않고 사유 툴팁만 연결한다. */
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>{aiTrigger}</TooltipTrigger>
            <TooltipContent side="bottom" data-testid="wiki-ai-header-reason">
              {disabledReason}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        <DropdownMenu>
          {/* 생성 중에는 메뉴를 열지 않는다 — 동시 스트림 방지(에디터 latest-wins 와 중복 방어). */}
          <DropdownMenuTrigger asChild disabled={aiBusy}>
            {aiTrigger}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {GENERATE_ACTIONS.map((a) => (
              <DropdownMenuItem
                key={a.key}
                data-testid={`wiki-ai-header-${a.key}`}
                onSelect={() => setTimeout(() => onAiAction(a.key), 0)}
                className="flex-col items-start space-y-1"
              >
                <span className="text-sm font-medium leading-5">{a.label}</span>
                <span className="text-xs leading-4 text-muted-foreground">{a.hint}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  )
  // 페이지 메뉴(마크다운 소스·삭제).
  const pageMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="페이지 메뉴"
        // 모바일 병합 헤더에선 44px 터치 타깃(데스크톱은 기존 p-1).
        className={cn(
          'rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground',
          isMobile && 'flex h-11 w-11 shrink-0 items-center justify-center p-0',
        )}
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={isMobile ? 'w-64' : undefined}>
        {/* 모바일: 헤더의 AI ▾ 대신 이 메뉴 맨 위 "AI 작성" 묶음(U3-R1) — 헤더의 AI 아이콘은 ✦(어시스턴트) 하나로 둔다.
            터치엔 툴팁이 없으므로 비활성 사유는 묶음 머리에 글자로 보인다(흐리게 칠하지 않음). */}
        {isMobile && (
          <>
            <DropdownMenuLabel className="text-xs text-muted-foreground">AI 작성</DropdownMenuLabel>
            {(disabledReason ?? (aiBusy ? '생성 중…' : null)) && (
              <p data-testid="wiki-ai-menu-reason" className="px-2 pb-1 text-xs text-foreground">
                {disabledReason ?? '생성 중…'}
              </p>
            )}
            {GENERATE_ACTIONS.map((a) => (
              <DropdownMenuItem
                key={a.key}
                data-testid={`wiki-ai-header-${a.key}`}
                disabled={disabledReason != null || aiBusy}
                onSelect={() => setTimeout(() => onAiAction(a.key), 0)}
                className="flex-col items-start gap-0.5"
              >
                <span className="text-sm font-medium leading-5">{a.label}</span>
                <span className="text-xs leading-4 text-muted-foreground">{a.hint}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </>
        )}
        {/* 소스 보기는 읽기 권한만으로 충분하다 — 이 드롭다운 자체가 권한 분기 밖에 있다. */}
        <DropdownMenuItem
          data-testid="wiki-menu-source"
          onSelect={() => setTimeout(onViewSource, 0)}
        >
          <FileCode className="mr-2 h-4 w-4" aria-hidden="true" /> 마크다운 소스
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => setTimeout(onDelete, 0)}>
          <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" /> 페이지 삭제
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  // 모바일 상세(노트 페이지): 레이아웃 뒤로가기 바와 두 줄로 쌓지 않고 ‹·✦ 를 품은 한 줄 헤더로 병합한다(U1-1 방식).
  // 제목 = 현재 페이지(브레드크럼 마지막) — 조상 경로는 좁은 폭에서 생략한다.
  if (detail) {
    // AI 생성 이력(#736)은 메뉴를 열지 않아도 보이게 제목 바로 뒤 작은 글자 칩으로(U3-C1) — ✦ 아이콘은 붙이지 않는다(R1: 헤더의 AI 아이콘은 ✦ 하나).
    return (
      <MobileDetailBar
        data-testid="wiki-page-header"
        title={crumbs[crumbs.length - 1]?.title ?? detail.title}
        titleAccessory={
          aiAttributed ? (
            <span
              data-testid="wiki-page-ai-attribution-badge"
              title="AI가 생성한 콘텐츠를 포함합니다"
              className={cn(aiSignalBadgeClass('info'), 'shrink-0 whitespace-nowrap text-[11px]')}
            >
              AI 생성<span className="sr-only"> 콘텐츠 포함</span>
            </span>
          ) : undefined
        }
        // 생성 중 표시 — AI ▾ 버튼(스피너)이 메뉴로 들어가 헤더에서 사라졌으므로 작은 스피너로 남긴다(공지는 에디터의 라이브 리전 담당).
        trailing={
          <div className="flex shrink-0 items-center gap-1">
            {aiBusy && (
              <Loader2 data-testid="wiki-ai-header-busy" className="h-4 w-4 animate-spin text-ai-accent motion-reduce:animate-none" aria-hidden="true" />
            )}
            {saveBadge}
            {pageMenu}
          </div>
        }
      />
    )
  }

  return (
    <header
      data-testid="wiki-page-header"
      className="flex h-14 shrink-0 items-center justify-between gap-2 border-b px-4"
    >
      {/*
        #830: 전역 AI 어시스턴트 런처(AIChip.tsx)는 뷰포트 중앙(lg 이상에서 +28px AppRail 보정,
        50vw+28px)에 fixed 로 고정되고 최소 폭 140px(중심 기준 ±70px)를 갖는다. 제목이 길어
        truncate 폭을 다 채우면 이 nav 가 헤더 우측 액션 그룹 직전까지 늘어나며 런처와 겹친다.
        헤더 레이아웃 통합 재설계는 스코프 밖 — 최소 조치로 nav 자체에 버튼 폭+여백을 고려한
        max-width 클램프를 걸어 런처 좌측 경계를 침범하지 않도록 한다(120px 는 클램프가 0 에
        가까워지는 좁은 뷰포트에서도 경로가 완전히 사라지지 않게 하는 하한선).
      */}
      <nav
        className="flex min-w-0 max-w-[max(120px,calc(50vw-360px))] items-center gap-1 text-sm"
        aria-label="페이지 경로"
      >
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1
          return (
            <Fragment key={c.id}>
              {i > 0 && (
                <ChevronRight
                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50"
                  aria-hidden="true"
                />
              )}
              {last ? (
                <span className="truncate font-semibold text-foreground">{c.title}</span>
              ) : (
                <button
                  type="button"
                  onClick={() => onNavigate(c.id)}
                  className="truncate text-muted-foreground hover:text-foreground"
                >
                  {c.title}
                </button>
              )}
            </Fragment>
          )
        })}
        {/* #736: 콘텐츠 출처 신호 — 우측 AI 액션 버튼(기능 트리거)과는 다른 클러스터에 둔다. */}
        {aiAttributed && (
          <AiSignalBadge
            variant="info"
            reason="AI가 생성한 콘텐츠를 포함합니다"
            data-testid="wiki-page-ai-attribution-badge"
            className="ml-1 shrink-0"
          >
            AI 생성 포함
          </AiSignalBadge>
        )}
      </nav>
      <div className="flex shrink-0 items-center gap-2">
        {saveBadge}
        {aiControl}
        {pageMenu}
      </div>
    </header>
  )
}
