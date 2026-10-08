import { ChevronDown, ChevronRight, FileCode, Loader2, MoreHorizontal, Trash2 } from 'lucide-react'

import { AiLabel } from '@/components/ai/AiLabel'
import { aiSignalBadgeClass } from '@/components/ai/aiMarker'
import { AiSignalBadge } from '@/components/ai/AiSignalBadge'
import { Page } from '@/components/layout/Page'
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useIsMobile } from '@/hooks/useIsMobile'
import { cn } from '@/lib/utils'

import { isAccessLost, type SyncStatus } from '../../lib/collab/collabStatus'
import { GENERATE_ACTIONS, type GenerateActionKey } from './wikiAiActions'
import { WikiSyncStatusChip } from './WikiSyncStatusChip'

/** 넓은 단계에서 펼쳐 보이는 가까운 조상 최대 개수 — 그 위는 "…" 메뉴로 접는다(깊은 경로 넘침 방지, WP-304). */
const WIDE_MAX_ANCESTORS = 3

/** 브레드크럼 구분 화살표. */
const crumbSep = <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" aria-hidden="true" />

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
 * 노트 페이지 뷰 헤더 — 브레드크럼(조상 경로) + 동기화 상태 칩 + AI 액션 버튼 + 더보기(삭제).
 * 데스크톱은 공용 Page.Header(h-14·border-b) 셸에 브레드크럼 nav(시맨틱 필요)를 leading 으로 넣는다.
 *
 * AI 버튼 상시 노출이 핵심 — 이전엔 ⋯ 드롭다운 안에 "AI 초안 작성" 하나만 묻혀 있어
 * 노트 화면에 보이는 AI 어피던스가 사실상 0개였다(#733).
 */
export function WikiPageHeader({
  crumbs,
  syncStatus,
  aiState,
  aiBusy,
  aiAttributed,
  onNavigate,
  onAiAction,
  onDelete,
  onViewSource,
}: {
  crumbs: { id: number; title: string }[]
  /** 실시간 동기화 상태(WP-287) — 예전 저장 상태(저장 중/저장됨/충돌)를 대체한다. */
  syncStatus: SyncStatus
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
  // 브레드크럼 = 조상들 + 현재 페이지(마지막). 조상은 폭 단계에 따라 "…" 메뉴로 접힌다(WP-304).
  const ancestors = crumbs.slice(0, -1)
  const current = crumbs.at(-1)

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

  // 동기화 상태 칩 — 모바일은 헤더 폭(제목)을 지키려 정상일 땐 점 하나, 문제가 있을 때만 짧은 글자로 커진다.
  const syncChip = <WikiSyncStatusChip status={syncStatus} compact={isMobile} />
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
        {/* 이미 지워졌거나 접근을 잃은 노트(종료 상태)는 지울 수 없다 — 눌러도 404 뿐이라 항목(과 구분선)을 감춘다. */}
        {!isAccessLost(syncStatus) && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              data-testid="wiki-menu-delete"
              onSelect={() => setTimeout(onDelete, 0)}
            >
              <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" /> 페이지 삭제
            </DropdownMenuItem>
          </>
        )}
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
        title={current?.title ?? detail.title}
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
            {syncChip}
            {pageMenu}
          </div>
        }
      />
    )
  }

  // 데스크톱: 공용 Page.Header 의 leading 슬롯에 경로 nav 를 둔다 — 여백(본문 제목과 같은 16px 축)과
  // AI 칩 클램프(#830 — 예전엔 이 nav 에 max-w-[max(120px,calc(50vw-360px))] 를 직접 걸었다)는 Page.Header 가 소유한다.
  return (
    <Page.Header
      data-testid="wiki-page-header"
      leading={
        /*
          WP-304: 클램프 때문에 1024px 부근에선 nav 가 ~150px 뿐인데, 예전엔 모든 경로 항목이 같은 비율로 줄어
          현재 제목까지 0 폭이 됐다. nav 를 컨테이너(@container/crumbs)로 두고 "실제 nav 폭" 기준 3단으로 접는다.
            - 좁음(<17rem, 1024~1100px): 조상 전부 "…" 메뉴로 접고, AI 배지는 "✨ AI" 로 줄인다.
            - 중간(17~26rem, 1280~1440px): 바로 위 부모만 남기고 그 위 조상은 "…" 메뉴로.
            - 넓음(≥26rem): 가까운 조상 최대 3개까지 표시, 그 위는 "…" 메뉴로 — 아주 깊은 경로도 클램프를 넘지 않게.
          현재 제목은 어느 단계든 min-w-14(56px) + 줄임표로 남는다. 숨긴 조상은 "…" 메뉴(전체 경로 순서)로 이동 가능.
          container-type 은 내용 기반 너비를 0 으로 만들어 Page.Header 좌측 그룹(내용 폭)까지 0 이 되므로,
          w-screen 으로 넉넉한 기준 폭을 주고 min-w-0 으로 줄인다 — 실제 폭은 헤더 남는 폭·AI 칩 클램프가 정한다.
        */
        <nav className="@container/crumbs w-screen min-w-0" aria-label="페이지 경로">
          {/* overflow-hidden: 어떤 깊이·글꼴에서도 경로가 nav 밖(런처 쪽)으로 새지 않게 하는 안전망.
              py-1 -my-1 은 포커스 링이 위아래로 잘리지 않을 여유. */}
          <div className="-my-1 flex min-w-0 items-center gap-1 overflow-hidden py-1 text-sm">
            {ancestors.length > 0 && (
              <span
                className={cn(
                  'hidden shrink-0 items-center gap-1 @max-[17rem]/crumbs:flex',
                  ancestors.length > 1 && '@min-[17rem]/crumbs:@max-[26rem]/crumbs:flex',
                  ancestors.length > WIDE_MAX_ANCESTORS && '@min-[26rem]/crumbs:flex',
                )}
              >
                <DropdownMenu>
                  {/* 24px 이상(터치는 44px) 히트 영역 — 좁음 단계 예산(152px) 안에서 제목 min-w-14 와 함께 맞춘다. */}
                  <DropdownMenuTrigger
                    aria-label="상위 경로 보기"
                    data-testid="wiki-breadcrumb-ellipsis"
                    className="flex min-h-6 min-w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground pointer-coarse:min-h-11 pointer-coarse:min-w-11"
                  >
                    <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                  </DropdownMenuTrigger>
                  {/* 접힌 조상은 단계마다 다르므로(메뉴는 portal 이라 컨테이너 쿼리 밖) 전체 조상을 경로 순서로 나열한다. */}
                  <DropdownMenuContent align="start" className="max-w-72">
                    {ancestors.map((c) => (
                      <DropdownMenuItem key={c.id} onSelect={() => onNavigate(c.id)}>
                        <span className="truncate">{c.title}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                {/* 좁음 단계에선 "…" 바로 뒤가 현재 제목이라 화살표를 빼 제목 폭을 번다. */}
                <span className="contents @max-[17rem]/crumbs:hidden">{crumbSep}</span>
              </span>
            )}
            {ancestors.map((c, i) => {
              // 현재 페이지에서의 거리(0 = 바로 위 부모) — 가까운 조상일수록 넓은 단계에서 남는다.
              const dist = ancestors.length - 1 - i
              return (
                // 조상 항목 + 뒤따르는 화살표를 한 묶음으로 숨겨 화살표만 남는 일이 없게 한다.
                <span
                  key={c.id}
                  data-testid="wiki-breadcrumb-ancestor"
                  className={cn(
                    'flex min-w-12 shrink-[10] items-center gap-1',
                    dist === 0
                      ? '@max-[17rem]/crumbs:hidden'
                      : dist < WIDE_MAX_ANCESTORS
                        ? '@max-[26rem]/crumbs:hidden'
                        : 'hidden',
                  )}
                >
                  <button
                    type="button"
                    title={c.title}
                    onClick={() => onNavigate(c.id)}
                    className="min-w-0 truncate text-muted-foreground hover:text-foreground"
                  >
                    {c.title}
                  </button>
                  {crumbSep}
                </span>
              )
            })}
            {current && (
              <span
                title={current.title}
                data-testid="wiki-breadcrumb-current"
                className="min-w-14 truncate font-semibold text-foreground"
              >
                {current.title}
              </span>
            )}
            {/* #736: 콘텐츠 출처 신호 — 우측 AI 액션 버튼(기능 트리거)과는 다른 클러스터에 둔다.
                좁음 단계에선 "✨ AI" 만 보이고 나머지 글자는 스크린리더용으로만 남긴다(WP-304). */}
            {aiAttributed && (
              <AiSignalBadge
                variant="info"
                reason="AI가 생성한 콘텐츠를 포함합니다"
                data-testid="wiki-page-ai-attribution-badge"
                className="ml-1 shrink-0 @max-[17rem]/crumbs:ml-0"
              >
                AI<span className="@max-[17rem]/crumbs:sr-only"> 생성 포함</span>
              </AiSignalBadge>
            )}
          </div>
        </nav>
      }
      actions={
        <>
          {syncChip}
          {aiControl}
          {pageMenu}
        </>
      }
    />
  )
}
