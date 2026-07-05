// 홈 대시보드 — 위젯 그리드 + 편집 모드.
// synthesis/quick_actions 같은 합성·액션 위젯도 다른 시스템 위젯과 동일하게 그리드 항목으로 렌더된다(고정
// 풀폭 레이어 아님). wide 로 표시된 위젯만 lg:col-span-3(전체 폭)으로 넓게 렌더한다.
// 편집 모드는 그리드 전체에 적용: 표시/숨김·순서 이동·항목 수·설정(카탈로그)·삭제(카탈로그)·되돌리기 → 저장/취소.
// 위젯은 두 종류다 — 시스템 위젯(싱글턴, count 기반)과 카탈로그 위젯(다중 인스턴스, params 기반,
// chatWidgetRegistry 컴포넌트를 그대로 재사용).
import {
  closestCenter,
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { arrayMove, rectSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  GripVertical,
  Home,
  PanelTop,
  PanelTopClose,
  Pencil,
  Plus,
  Settings,
  Trash2,
  Undo2,
} from 'lucide-react'
import { createElement, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { useInboxPanel } from '@/components/layout/InboxContext'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useDashboardLayout, useSaveDashboardLayout } from '@/hooks/queries/useDashboard'
import { handleApiError } from '@/lib/api-error'
import type { DashboardWidgetConfig } from '@/types/dashboard'

import { AddWidgetModal } from './widgets/AddWidgetModal'
import { allCatalogWidgets, type CatalogWidget, getCatalogWidget } from './widgets/catalogRegistry'
import { getChatWidget } from './widgets/chatWidgetRegistry'
import { allDashboardWidgets, type DashboardWidget, getDashboardWidget } from './widgets/registry'
import { WidgetSettingsPopover } from './widgets/WidgetSettingsPopover'

// 항목 수 선택지 — 백엔드 화이트리스트({3,5,10})와 일치.
const COUNT_OPTIONS = [3, 5, 10] as const
// 총 위젯 인스턴스 상한 — 백엔드 DashboardService.MAX_WIDGETS 와 일치(프론트는 UX 가드, 최종 검증은 서버).
const MAX_WIDGETS = 12
// 위젯 추가 강조 표시 지속 시간(ms) — 카드의 `duration-700` 강조 트랜지션과 짝을 이루며,
// e2e/pages/home.spec.ts 의 fastForward 경계값과도 결합되어 있으니 값을 바꿀 때 두 곳을 함께 확인한다.
const HIGHLIGHT_DURATION_MS = 4000

/** 그리드 한 항목 = 알려진 위젯 정의(시스템|카탈로그) + 그 구성. 알 수 없는 타입은 미리 걸러진다. */
type ResolvedEntry =
  | { kind: 'system'; def: DashboardWidget; cfg: DashboardWidgetConfig }
  | { kind: 'catalog'; def: CatalogWidget; cfg: DashboardWidgetConfig }

/** 위젯 설정(cfg) → 렌더 가능한 엔트리로 해석. 시스템/카탈로그 레지스트리 어느 쪽에도 없으면 null(스킵). */
function resolveEntry(cfg: DashboardWidgetConfig): ResolvedEntry | null {
  const sys = getDashboardWidget(cfg.type)
  if (sys) return { kind: 'system', def: sys, cfg }
  const cat = getCatalogWidget(cfg.type)
  if (cat) return { kind: 'catalog', def: cat, cfg }
  return null
}

/** 엔트리 표시 제목 — 카탈로그는 사용자 라벨 우선, 없으면 레지스트리 기본 제목. */
function entryTitle(entry: ResolvedEntry): string {
  if (entry.kind === 'catalog' && entry.cfg.label) return entry.cfg.label
  return entry.def.title
}

/** 위젯 한 칸(일반 뷰) — 카드 프레임(헤더 클릭 시 딥링크 또는 인박스 패널) + 격리된 본문.
 * 시스템 위젯은 tall 이면 2행 span, 카탈로그 위젯은 size==='1×2' 면 2행 span. */
function WidgetCard({ entry }: { entry: ResolvedEntry }) {
  const Icon = entry.def.icon
  const title = entryTitle(entry)
  const deepLink = entry.kind === 'system' ? entry.def.deepLink : undefined
  const tall =
    entry.kind === 'system' ? Boolean(entry.def.tall) : entry.def.size === '1×2'
  // wide: 카운트 스트립·2x2 분면처럼 1/3 폭에 찌그러지는 시스템 위젯 — lg:col-span-3(전체 폭).
  const wide = entry.kind === 'system' && Boolean(entry.def.wide)
  // 알림처럼 deepLink 가 없는 위젯은 헤더 클릭 시 AppRail 의 인박스 패널을 연다(#274).
  const { openInbox } = useInboxPanel()
  const headerClassName =
    'flex items-center gap-2 text-muted-foreground hover:text-ai-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-sm'
  const headerInner = (
    <>
      <Icon className="h-4 w-4" />
      <CardTitle className="text-sm font-medium">{title}</CardTitle>
    </>
  )
  const body = (
    <Suspense fallback={<Skeleton className="h-20 w-full" />}>
      {entry.kind === 'system' ? (
        <entry.def.Component count={entry.cfg.count} />
      ) : (
        <CatalogWidgetBody type={entry.cfg.type} params={entry.cfg.params} />
      )}
    </Suspense>
  )

  // chromeless: 테두리·제목 헤더 없이 본문만 렌더(빠른 액션처럼 자체 설명적인 위젯용). 그리드 폭/행
  // span(wide/tall)은 레이아웃 유지를 위해 그대로 적용한다.
  if (entry.cfg.chromeless) {
    return (
      <div
        className={`${tall ? 'lg:row-span-2' : ''}${wide ? ' lg:col-span-3' : ''}`}
        data-testid="dashboard-widget"
        data-widget={entry.cfg.type}
        data-widget-id={entry.cfg.id}
        data-chromeless="true"
      >
        {body}
      </div>
    )
  }

  return (
    <Card
      className={`border-l-2 border-l-ai-accent${tall ? ' lg:row-span-2' : ''}${wide ? ' lg:col-span-3' : ''}`}
      data-testid="dashboard-widget"
      data-widget={entry.cfg.type}
      data-widget-id={entry.cfg.id}
    >
      <CardHeader className="pb-2">
        {deepLink ? (
          <Link to={deepLink} className={headerClassName}>
            {headerInner}
          </Link>
        ) : entry.cfg.type === 'notifications' ? (
          <button type="button" onClick={() => openInbox()} className={headerClassName}>
            {headerInner}
          </button>
        ) : (
          <div className="flex items-center gap-2 text-muted-foreground">{headerInner}</div>
        )}
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  )
}

/** 카탈로그 위젯 본문 — chatWidgetRegistry 의 기존 컴포넌트를 재사용. 미등록 타입은 아무것도 렌더하지 않는다(방어적). */
function CatalogWidgetBody({
  type,
  params,
}: {
  type: string
  params?: Record<string, unknown> | null
}) {
  const ChatComponent = getChatWidget(type)
  if (!ChatComponent) return null
  // JSX(`<ChatComponent .../>`)로 렌더하면 react-hooks/static-components 가 "렌더 중 컴포넌트 생성"으로 오탐(false
  // positive)한다 — getChatWidget 은 매 호출 동일 lazy 참조를 반환하는 안정 레지스트리 조회일 뿐 신규 생성이 아니다.
  // createElement 로 우회(AIChatPanel 의 동일 레지스트리 조회 패턴과 동등한 동작).
  return createElement(ChatComponent, { params: params ?? undefined })
}

/** 편집 모드 위젯 카드 — 본문 + 표시/숨김·이동·(시스템)항목수/(카탈로그)설정·삭제 컨트롤. 숨김은 dimmed 로 잔류(재표시 경로). */
function EditableWidgetCard({
  entry,
  index,
  total,
  onMove,
  onToggleHidden,
  onToggleChromeless,
  onCount,
  onApplyCatalogConfig,
  onRemove,
  cardRef,
  upRef,
  downRef,
  highlighted,
}: {
  entry: ResolvedEntry
  index: number
  total: number
  onMove: (dir: -1 | 1) => void
  onToggleHidden: () => void
  onToggleChromeless: () => void
  onCount: (count: number) => void
  onApplyCatalogConfig: (patch: { params: Record<string, unknown>; label: string | null }) => void
  onRemove: () => void
  // 포커스 복원용 ref(I2: 경계 이동 후 포커스 유지) — 카드/위·아래 버튼.
  cardRef: (el: HTMLDivElement | null) => void
  upRef: (el: HTMLButtonElement | null) => void
  downRef: (el: HTMLButtonElement | null) => void
  /** 방금 추가된 위젯이면 true — 테두리 강조 표시(4초 후 자동 해제, 타이밍은 Dashboard 가 관리). */
  highlighted: boolean
}) {
  const Icon = entry.def.icon
  const title = entryTitle(entry)
  const { cfg } = entry
  // 드래그앤드랍 재배치 — 핸들(GripVertical)에서만 드래그 시작(카드 내 다른 버튼과 제스처 분리).
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: cfg.id,
  })
  const dragStyle = { transform: CSS.Translate.toString(transform), transition }
  // wide: 카운트 스트립·2x2 분면처럼 1/3 폭에 찌그러지는 시스템 위젯 — lg:col-span-3(전체 폭).
  const wide = entry.kind === 'system' && Boolean(entry.def.wide)
  return (
    <Card
      ref={(el) => {
        setNodeRef(el)
        cardRef(el)
      }}
      style={dragStyle}
      tabIndex={-1}
      // transition-shadow duration-700 은 강조 표시(ring-ai-accent) 페이드 인/아웃용. 다만 이 상태로는
      // 키보드 포커스 링(focus-visible:ring-2)도 같이 700ms 페이드 되어 포커스 이동이 굼떠 보이는 접근성
      // 회귀가 생긴다 — focus-visible:transition-none 으로 포커스 시에만 트랜지션을 무효화해 포커스 링은
      // 즉시 나타나게 하고, 강조 표시의 페이드 인/아웃(비-포커스 상태)은 그대로 유지한다.
      className={`border-l-2 border-l-ai-accent transition-shadow duration-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:transition-none${cfg.hidden ? ' opacity-50' : ''}${highlighted ? ' ring-2 ring-ai-accent' : ''}${wide ? ' lg:col-span-3' : ''}${isDragging ? ' opacity-50' : ''}`}
      data-testid="dashboard-widget"
      data-widget={cfg.type}
      data-widget-id={cfg.id}
      data-hidden={cfg.hidden}
      data-just-added={highlighted ? 'true' : undefined}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-muted-foreground">
            <button
              type="button"
              className="cursor-grab touch-none rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              data-testid="widget-drag-handle"
              aria-label={`드래그 핸들: ${title}`}
              {...attributes}
              {...listeners}
            >
              <GripVertical className="h-4 w-4" />
            </button>
            <Icon className="h-4 w-4" />
            <CardTitle className="text-sm font-medium">{title}</CardTitle>
          </div>
          <div className="flex items-center gap-1">
            <Button
              ref={upRef}
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              data-testid="widget-move-up"
              aria-label={`위로 이동: ${title}`}
              disabled={index === 0}
              onClick={() => onMove(-1)}
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
            <Button
              ref={downRef}
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              data-testid="widget-move-down"
              aria-label={`아래로 이동: ${title}`}
              disabled={index === total - 1}
              onClick={() => onMove(1)}
            >
              <ArrowDown className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              data-testid="widget-hide-toggle"
              aria-label={cfg.hidden ? `표시: ${title}` : `숨김: ${title}`}
              aria-pressed={cfg.hidden}
              onClick={onToggleHidden}
            >
              {cfg.hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
            <Button
              type="button"
              variant={cfg.chromeless ? 'default' : 'ghost'}
              size="icon"
              className="size-8"
              data-testid="widget-chromeless-toggle"
              aria-label={cfg.chromeless ? `테두리·제목 표시: ${title}` : `테두리·제목 숨김: ${title}`}
              aria-pressed={Boolean(cfg.chromeless)}
              onClick={onToggleChromeless}
            >
              {/* Eye/EyeOff 와 동일 관례 — 아이콘이 "현재 상태"를 나타낸다(테두리 있음/없음). */}
              {cfg.chromeless ? (
                <PanelTopClose className="h-4 w-4" />
              ) : (
                <PanelTop className="h-4 w-4" />
              )}
            </Button>
            {entry.kind === 'catalog' && entry.def.fields.length > 0 && (
              <WidgetSettingsPopover
                catalogDef={entry.def}
                cfg={cfg}
                onApply={onApplyCatalogConfig}
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  data-testid="widget-settings"
                  aria-label={`설정: ${title}`}
                >
                  <Settings className="h-4 w-4" />
                </Button>
              </WidgetSettingsPopover>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              data-testid="widget-remove"
              aria-label={`삭제: ${title}`}
              onClick={onRemove}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* wide 시스템 위젯(요약·빠른 액션·AI 우선순위)은 count 를 무시하므로 선택 UI 자체를 숨긴다 —
            보여줘도 동작하지 않는 컨트롤은 혼란만 준다. */}
        {entry.kind === 'system' && !entry.def.wide && (
          <div
            className="flex items-center gap-2"
            role="group"
            aria-label={`항목 수: ${title}`}
            data-testid="widget-count-select"
          >
            <span className="text-xs text-muted-foreground">항목 수</span>
            {COUNT_OPTIONS.map((n) => (
              <Button
                key={n}
                type="button"
                variant={cfg.count === n ? 'default' : 'outline'}
                size="sm"
                className="h-7 min-w-9 px-2"
                aria-pressed={cfg.count === n}
                aria-label={`${n}개`}
                onClick={() => onCount(n)}
              >
                {n}
              </Button>
            ))}
          </div>
        )}
        <Suspense fallback={<Skeleton className="h-20 w-full" />}>
          {entry.kind === 'system' ? (
            <entry.def.Component count={cfg.count} />
          ) : (
            <CatalogWidgetBody type={cfg.type} params={cfg.params} />
          )}
        </Suspense>
      </CardContent>
    </Card>
  )
}

/** 레이아웃 로딩 중 스켈레톤 그리드(단일 lg 분기). */
function DashboardSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3" data-testid="dashboard-skeleton">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-40 w-full" />
      ))}
    </div>
  )
}

/** 홈 대시보드 — 위젯 그리드(저장 레이아웃 기반) + 편집. */
export function Dashboard() {
  const { data, isLoading } = useDashboardLayout()
  const save = useSaveDashboardLayout()

  // 편집 상태 — 로컬 드래프트 + 단일-레벨 undo 스냅샷. 저장 전까지 아무것도 영속화되지 않는다.
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<DashboardWidgetConfig[]>([])
  const [undoSnapshot, setUndoSnapshot] = useState<DashboardWidgetConfig[] | null>(null)
  const [addModalOpen, setAddModalOpen] = useState(false)
  // 방금 추가된 위젯 id — 강조 표시 + 스크롤 이동 대상(4초 후 자동 해제).
  const [recentlyAddedId, setRecentlyAddedId] = useState<string | null>(null)
  const recentlyAddedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 스크린리더 피드백(이동/숨김 등 편집 액션) — aria-live polite 로 알림.
  const [liveMsg, setLiveMsg] = useState('')

  // ── I2: 이동 후 포커스 복원 ──────────────────────────────────────────────
  const [moveFocus, setMoveFocus] = useState<{ id: string; dir: -1 | 1; token: number } | null>(
    null,
  )
  // 카드/이동버튼 DOM 참조 맵(id 키). 콜백 ref 로 등록.
  const cardRefs = useRef(new Map<string, HTMLDivElement>())
  const upRefs = useRef(new Map<string, HTMLButtonElement>())
  const downRefs = useRef(new Map<string, HTMLButtonElement>())
  const moveTokenRef = useRef(0)

  useEffect(() => {
    if (!moveFocus) return
    const { id, dir } = moveFocus
    const btn = (dir < 0 ? upRefs : downRefs).current.get(id)
    if (btn && !btn.disabled) {
      btn.focus()
    } else {
      cardRefs.current.get(id)?.focus()
    }
  }, [moveFocus])

  // 위젯 추가 직후 해당 카드로 스크롤 이동 + 4초간 강조 후 자동 해제.
  useEffect(() => {
    if (!recentlyAddedId) return
    cardRefs.current.get(recentlyAddedId)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    // 이전 타이머는 매 재실행/언마운트 전 아래 cleanup 이 이미 정리하므로 여기서 다시 지울 필요 없다.
    recentlyAddedTimerRef.current = setTimeout(() => setRecentlyAddedId(null), HIGHLIGHT_DURATION_MS)
    return () => {
      if (recentlyAddedTimerRef.current) {
        clearTimeout(recentlyAddedTimerRef.current)
        recentlyAddedTimerRef.current = null
      }
    }
  }, [recentlyAddedId])

  // 저장된 레이아웃 → 알려진 위젯만 해석(알 수 없는 타입은 조용히 스킵).
  const savedEntries = useMemo<ResolvedEntry[]>(() => {
    return (data?.widgets ?? [])
      .map(resolveEntry)
      .filter((e): e is ResolvedEntry => e !== null)
  }, [data])

  function enterEdit() {
    setDraft((data?.widgets ?? []).map((w) => ({ ...w })))
    setUndoSnapshot(null)
    setLiveMsg('')
    setAddModalOpen(false)
    setRecentlyAddedId(null)
    setEditing(true)
  }

  function cancelEdit() {
    setEditing(false)
    setUndoSnapshot(null)
    setLiveMsg('')
    setAddModalOpen(false)
    setRecentlyAddedId(null)
  }

  function snapshot() {
    setUndoSnapshot(draft.map((w) => ({ ...w })))
  }

  // 위젯 이동(위/아래) — 드래프트 배열 내 순서 교환. id 기반.
  function moveWidget(id: string, dir: -1 | 1) {
    // I1: setDraft 업데이터 안에서 title 을 계산하면 setLiveMsg 호출 시점엔 아직 반영 전(stale) 값을 읽게 되므로,
    // 다른 핸들러(toggleHidden 등)와 동일하게 항상 최신인 draft 로 핸들러에서 먼저 계산한다.
    const cur = draft.find((w) => w.id === id)
    const entry = cur ? resolveEntry(cur) : null
    const title = entry ? entryTitle(entry) : id
    snapshot()
    setDraft((prev) => {
      const i = prev.findIndex((w) => w.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
    setLiveMsg(`${title} 위젯을 ${dir < 0 ? '위로' : '아래로'} 이동했습니다`)
    moveTokenRef.current += 1
    setMoveFocus({ id, dir, token: moveTokenRef.current })
  }

  // 드래그앤드랍 센서 — PointerSensor distance:8 로 일반 클릭(버튼)과 드래그 제스처를 분리.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  // 충돌 판정 — closestCenter 는 "드래그 중인 카드 자체의 rect 중심"과 다른 카드 rect 중심 간의
  // 거리로 over 를 정한다. wide(col-span-3) 위젯을 드래그하면 그 오버레이도 전체 폭(3컬럼) 크기를
  // 그대로 유지하므로 중심 x 좌표가 그리드 가운데(2번째 컬럼) 근처에 고정돼, 실제 마우스 포인터가
  // 1번째 컬럼 카드 위에 있어도 2번째 컬럼 카드가 더 가깝게 계산되어 엉뚱한 위치로 건너뛴다(#645).
  // 포인터의 실제 좌표가 어느 카드 rect 안에 들어있는지로 판정하는 pointerWithin 을 우선 사용하면
  // 드래그 중인 카드의 크기/모양과 무관하게 정확한 over 를 얻을 수 있다. 포인터가 카드 사이 여백 등
  // 어떤 rect 에도 속하지 않는 경우를 위해 rectIntersection → closestCenter 순으로 폴백한다.
  const collisionDetection: CollisionDetection = useCallback((args) => {
    const pointerCollisions = pointerWithin(args)
    if (pointerCollisions.length > 0) return pointerCollisions
    const rectCollisions = rectIntersection(args)
    if (rectCollisions.length > 0) return rectCollisions
    return closestCenter(args)
  }, [])

  // 드래그 종료 — active 위젯을 over 위젯 자리로 재배치. moveWidget 과 동일하게 undo 스냅샷 + 공지.
  // 포인터 드래그는 키보드 포커스 이동이 없으므로 moveWidget 의 포커스 복원(moveTokenRef/setMoveFocus)이 불필요하다.
  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return
    const activeId = String(active.id)
    const overId = String(over.id)
    const cur = draft.find((w) => w.id === activeId)
    const entry = cur ? resolveEntry(cur) : null
    const title = entry ? entryTitle(entry) : activeId
    snapshot()
    let newIndex = -1
    setDraft((prev) => {
      const oldIdx = prev.findIndex((w) => w.id === activeId)
      const overIdx = prev.findIndex((w) => w.id === overId)
      if (oldIdx < 0 || overIdx < 0) return prev
      newIndex = overIdx
      return arrayMove(prev, oldIdx, overIdx)
    })
    if (newIndex >= 0) {
      setLiveMsg(`${title} 위젯을 ${newIndex + 1}번째 위치로 이동했습니다`)
    }
  }

  // 표시/숨김 토글. id 기반.
  function toggleHidden(id: string) {
    const cur = draft.find((w) => w.id === id)
    const nowHidden = cur ? !cur.hidden : true
    const entry = cur ? resolveEntry(cur) : null
    snapshot()
    setDraft((prev) => prev.map((w) => (w.id === id ? { ...w, hidden: nowHidden } : w)))
    setLiveMsg(`${entry ? entryTitle(entry) : id} 위젯을 ${nowHidden ? '숨김' : '표시'} 처리했습니다`)
  }

  // 테두리·제목 헤더 표시/숨김 토글(chromeless). id 기반 — hidden 과 동일 패턴.
  function toggleChromeless(id: string) {
    const cur = draft.find((w) => w.id === id)
    const nowChromeless = cur ? !cur.chromeless : true
    const entry = cur ? resolveEntry(cur) : null
    snapshot()
    setDraft((prev) => prev.map((w) => (w.id === id ? { ...w, chromeless: nowChromeless } : w)))
    setLiveMsg(
      `${entry ? entryTitle(entry) : id} 위젯 테두리·제목을 ${nowChromeless ? '숨김' : '표시'} 처리했습니다`,
    )
  }

  // 위젯 추가 — 시스템 위젯은 이미 draft 에 있으면 무시(싱글턴), 카탈로그 위젯은 새 UUID 인스턴스로 추가.
  // 상한(MAX_WIDGETS) 도달 시 무시(모달 쪽에서도 버튼 비활성화로 방지, 여기는 방어적 가드).
  function addWidget(type: string) {
    if (draft.length >= MAX_WIDGETS) return
    const sys = getDashboardWidget(type)
    if (sys) {
      if (draft.some((w) => w.type === type)) return
      snapshot()
      setDraft((prev) => [...prev, { id: type, type, count: 5, hidden: false }])
      setLiveMsg(`${sys.title} 위젯을 추가했습니다`)
      setRecentlyAddedId(type)
      return
    }
    const cat = getCatalogWidget(type)
    if (!cat) return
    const id = crypto.randomUUID()
    snapshot()
    setDraft((prev) => [
      ...prev,
      { id, type, count: 0, hidden: false, params: cat.defaultParams, label: null },
    ])
    setLiveMsg(`${cat.title} 위젯을 추가했습니다`)
    setRecentlyAddedId(id)
  }

  // 카탈로그 위젯 삭제(완전 제거). 시스템 위젯은 숨김만 가능(호출부에서 카탈로그에만 노출).
  function removeWidget(id: string) {
    const cur = draft.find((w) => w.id === id)
    const entry = cur ? resolveEntry(cur) : null
    snapshot()
    setDraft((prev) => prev.filter((w) => w.id !== id))
    setLiveMsg(`${entry ? entryTitle(entry) : id} 위젯을 삭제했습니다`)
  }

  // 카탈로그 위젯 설정(필터/라벨) 적용 — 추가 시점 기본값 편집과 이후 편집이 동일 경로.
  function applyCatalogConfig(id: string, patch: { params: Record<string, unknown>; label: string | null }) {
    snapshot()
    setDraft((prev) => prev.map((w) => (w.id === id ? { ...w, ...patch } : w)))
    setLiveMsg('위젯 설정을 변경했습니다')
  }

  // 항목 수 변경(시스템 위젯 전용).
  function setCount(id: string, count: number) {
    const cur = draft.find((w) => w.id === id)
    const entry = cur ? resolveEntry(cur) : null
    snapshot()
    setDraft((prev) => prev.map((w) => (w.id === id ? { ...w, count } : w)))
    setLiveMsg(`${entry ? entryTitle(entry) : id} 위젯 항목 수를 ${count}개로 변경했습니다`)
  }

  function undo() {
    if (!undoSnapshot) return
    setDraft(undoSnapshot)
    setUndoSnapshot(null)
    setLiveMsg('마지막 편집을 되돌렸습니다')
  }

  function saveEdit() {
    save.mutate(draft, {
      onSuccess: () => {
        setEditing(false)
        setUndoSnapshot(null)
        setLiveMsg('대시보드 레이아웃을 저장했습니다')
      },
      onError: (err) => handleApiError(err, '대시보드 저장에 실패했습니다'),
    })
  }

  const homeIcon = <Home className="h-5 w-5 text-muted-foreground" />

  if (isLoading)
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <PageHeader data-testid="canvas-header" title="홈" icon={homeIcon} />
        <div className="flex-1 overflow-auto p-4">
          <DashboardSkeleton />
        </div>
      </div>
    )

  // 편집 드래프트 → 알려진 위젯만 해석(순서/숨김 모두 포함).
  const draftEntries: ResolvedEntry[] = draft
    .map(resolveEntry)
    .filter((e): e is ResolvedEntry => e !== null)

  // 시스템 위젯 갤러리 — draft 에 아예 없는 시스템 타입만(싱글턴 재추가 경로). 카탈로그는 갤러리에 항상 전부 노출.
  const draftSystemTypes = new Set(draft.filter((w) => getDashboardWidget(w.type)).map((w) => w.type))
  const absentSystemWidgets = allDashboardWidgets().filter((w) => !draftSystemTypes.has(w.type))

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        data-testid="canvas-header"
        title="홈"
        icon={homeIcon}
        actions={
          !editing ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="dashboard-edit-toggle"
              onClick={enterEdit}
            >
              <Pencil className="h-4 w-4" />
              편집
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="dashboard-add-widget-open"
              disabled={draft.length >= MAX_WIDGETS}
              onClick={() => setAddModalOpen(true)}
            >
              <Plus className="h-4 w-4" />
              위젯 추가
            </Button>
          )
        }
      />
      <div className="flex-1 space-y-4 overflow-auto p-4">
        {editing && (
          <div
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-ai-accent/40 bg-ai-accent/5 px-4 py-2"
            data-testid="dashboard-edit-banner"
          >
            <span className="text-sm font-medium text-ai-accent">편집 중</span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-testid="dashboard-edit-undo"
                disabled={!undoSnapshot}
                onClick={undo}
              >
                <Undo2 className="h-4 w-4" />
                되돌리기
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="dashboard-edit-cancel"
                onClick={cancelEdit}
              >
                취소
              </Button>
              <Button
                type="button"
                size="sm"
                data-testid="dashboard-edit-save"
                disabled={save.isPending}
                onClick={saveEdit}
              >
                {save.isPending ? '저장 중…' : '저장'}
              </Button>
            </div>
          </div>
        )}

        <div className="sr-only" aria-live="polite" data-testid="dashboard-edit-live">
          {liveMsg}
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3" data-testid="dashboard">
          {editing ? (
            <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragEnd={handleDragEnd}>
              <SortableContext items={draftEntries.map((e) => e.cfg.id)} strategy={rectSortingStrategy}>
                {draftEntries.map((entry, i) => (
                  <EditableWidgetCard
                    key={entry.cfg.id}
                    entry={entry}
                    index={i}
                    total={draftEntries.length}
                    onMove={(dir) => moveWidget(entry.cfg.id, dir)}
                    onToggleHidden={() => toggleHidden(entry.cfg.id)}
                    onToggleChromeless={() => toggleChromeless(entry.cfg.id)}
                    onCount={(n) => setCount(entry.cfg.id, n)}
                    onApplyCatalogConfig={(patch) => applyCatalogConfig(entry.cfg.id, patch)}
                    onRemove={() => removeWidget(entry.cfg.id)}
                    highlighted={entry.cfg.id === recentlyAddedId}
                    cardRef={(el) => {
                      if (el) cardRefs.current.set(entry.cfg.id, el)
                      else cardRefs.current.delete(entry.cfg.id)
                    }}
                    upRef={(el) => {
                      if (el) upRefs.current.set(entry.cfg.id, el)
                      else upRefs.current.delete(entry.cfg.id)
                    }}
                    downRef={(el) => {
                      if (el) downRefs.current.set(entry.cfg.id, el)
                      else downRefs.current.delete(entry.cfg.id)
                    }}
                  />
                ))}
              </SortableContext>
            </DndContext>
          ) : (
            savedEntries
              .filter((e) => !e.cfg.hidden)
              .map((entry) => <WidgetCard key={entry.cfg.id} entry={entry} />)
          )}
        </div>

        {editing && (
          <AddWidgetModal
            open={addModalOpen}
            onOpenChange={setAddModalOpen}
            systemWidgets={absentSystemWidgets}
            catalogWidgets={allCatalogWidgets()}
            disabled={draft.length >= MAX_WIDGETS}
            onAdd={addWidget}
          />
        )}
      </div>
    </div>
  )
}
