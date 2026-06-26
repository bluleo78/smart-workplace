// 고정 홈 대시보드 — 게이트 §1 의 3-레이어 구조 + 위젯 그리드 편집 모드.
//   ① 합성 레이어(카운트 + 주의 필요) → ② 빠른 액션 → ③ 소스별 위젯 그리드(커스터마이즈 대상).
// ①② 는 그리드 밖(풀폭) 고정, ③ 만 사용자 저장 레이아웃 순서로 렌더한다.
// 편집 모드는 ③(위젯 그리드)에만 적용: 표시/숨김·순서 이동·항목 수·되돌리기 → 저장/취소.
import { ArrowDown, ArrowUp, Eye, EyeOff, Home, Pencil, Plus, Undo2 } from 'lucide-react'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { useInboxPanel } from '@/components/layout/InboxContext'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useDashboardLayout, useSaveDashboardLayout } from '@/hooks/queries/useDashboard'
import { handleApiError } from '@/lib/api-error'
import type { DashboardWidgetConfig } from '@/types/dashboard'

import { QuickActions } from './QuickActions'
import { SynthesisLayer } from './synthesis/SynthesisLayer'
import { allDashboardWidgets, type DashboardWidget, getDashboardWidget } from './widgets/registry'

// 항목 수 선택지 — 백엔드 화이트리스트({3,5,10})와 일치.
const COUNT_OPTIONS = [3, 5, 10] as const

/** 위젯 한 칸 — 카드 프레임(헤더 클릭 시 딥링크 또는 인박스 패널) + 격리된 본문. tall 위젯은 2행 span. */
function WidgetCard({ widget, count }: { widget: DashboardWidget; count: number }) {
  const { title, icon: Icon, Component, deepLink, tall } = widget
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
  return (
    <Card
      // 피드성(tall) 위젯은 lg 에서 2행을 차지(게이트 §1.2). 인덱스 하드코딩이 아닌 정의 속성 기반.
      className={`border-l-2 border-l-ai-accent${tall ? ' lg:row-span-2' : ''}`}
      data-testid="dashboard-widget"
      data-widget={widget.type}
    >
      <CardHeader className="pb-2">
        {/* deepLink 있으면 모듈 이동(Link), 없으면 인박스 패널 오픈(button) — SynthesisLayer 의 CountCell 과 동일 패턴. */}
        {deepLink ? (
          <Link to={deepLink} className={headerClassName}>
            {headerInner}
          </Link>
        ) : (
          <button type="button" onClick={() => openInbox()} className={headerClassName}>
            {headerInner}
          </button>
        )}
      </CardHeader>
      <CardContent>
        {/* 본문 lazy 로드 — 위젯별 스켈레톤으로 폴백(격리). count = 표시 항목 수. */}
        <Suspense fallback={<Skeleton className="h-20 w-full" />}>
          <Component count={count} />
        </Suspense>
      </CardContent>
    </Card>
  )
}

/** 편집 모드 위젯 카드 — 본문 + 표시/숨김·이동·항목수 컨트롤. 숨김은 dimmed 로 잔류(재표시 경로). */
function EditableWidgetCard({
  widget,
  cfg,
  index,
  total,
  onMove,
  onToggleHidden,
  onCount,
  cardRef,
  upRef,
  downRef,
}: {
  widget: DashboardWidget
  cfg: DashboardWidgetConfig
  index: number
  total: number
  onMove: (dir: -1 | 1) => void
  onToggleHidden: () => void
  onCount: (count: number) => void
  // 포커스 복원용 ref(I2: 경계 이동 후 포커스 유지) — 카드/위·아래 버튼.
  cardRef: (el: HTMLDivElement | null) => void
  upRef: (el: HTMLButtonElement | null) => void
  downRef: (el: HTMLButtonElement | null) => void
}) {
  const { title, icon: Icon } = widget
  return (
    <Card
      ref={cardRef}
      // 포커스 복원 대상이 될 수 있어 tabIndex=-1(프로그램적 focus 허용, 탭 순서 비참여).
      // 경계 이동 시 카드로 포커스가 떨어지므로 가시 포커스 링 유지(WCAG 2.4.7). 마우스 클릭엔 안 뜨게 focus-visible.
      tabIndex={-1}
      className={`border-l-2 border-l-ai-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50${cfg.hidden ? ' opacity-50' : ''}`}
      data-testid="dashboard-widget"
      data-widget={widget.type}
      data-hidden={cfg.hidden}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Icon className="h-4 w-4" />
            <CardTitle className="text-sm font-medium">{title}</CardTitle>
          </div>
          {/* 위/아래 이동 — 키보드 조작 필수(WCAG 2.5.7). 양 끝은 disabled. 32px(§2.5.8 권장). */}
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
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* 항목 수 세그먼트(3·5·10) — 버튼 기반(키보드 명확). */}
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
        {/* 편집 모드에서도 실데이터 미리보기(현재 count 반영). */}
        <Suspense fallback={<Skeleton className="h-20 w-full" />}>
          <widget.Component count={cfg.count} />
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

/** 그리드 한 항목 = 알려진 위젯 정의 + 그 구성. 알 수 없는 타입은 미리 걸러진다. */
type ResolvedEntry = { def: DashboardWidget; cfg: DashboardWidgetConfig }

/** 홈 대시보드 — ①합성 ②빠른액션 ③소스 그리드(3-레이어). 그리드만 저장 레이아웃 기반 + 편집. */
export function Dashboard() {
  const { data, isLoading } = useDashboardLayout()
  const save = useSaveDashboardLayout()

  // 편집 상태 — 로컬 드래프트 + 단일-레벨 undo 스냅샷. 저장 전까지 아무것도 영속화되지 않는다.
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<DashboardWidgetConfig[]>([])
  const [undoSnapshot, setUndoSnapshot] = useState<DashboardWidgetConfig[] | null>(null)
  // 스크린리더 피드백(이동/숨김 등 편집 액션) — aria-live polite 로 알림.
  const [liveMsg, setLiveMsg] = useState('')

  // ── I2: 이동 후 포커스 복원 ──────────────────────────────────────────────
  // 마지막 이동 요청(타입 + 방향) — 리렌더 후 effect 가 이 토큰을 보고 포커스를 되돌린다.
  // token 으로 동일 type 연속 이동도 매번 effect 가 재실행되게 한다.
  const [moveFocus, setMoveFocus] = useState<{ type: string; dir: -1 | 1; token: number } | null>(
    null,
  )
  // 카드/이동버튼 DOM 참조 맵(타입 키). 콜백 ref 로 등록.
  const cardRefs = useRef(new Map<string, HTMLDivElement>())
  const upRefs = useRef(new Map<string, HTMLButtonElement>())
  const downRefs = useRef(new Map<string, HTMLButtonElement>())
  // 단조 증가 토큰 — 동일 type 연속 이동도 effect 재실행을 보장(Date.now 같은 비순수 호출 회피).
  const moveTokenRef = useRef(0)

  // 이동 직후: 같은 방향 이동 버튼이 아직 활성이면 거기에, (경계라) disabled 면 카드 자체에 포커스.
  useEffect(() => {
    if (!moveFocus) return
    const { type, dir } = moveFocus
    const btn = (dir < 0 ? upRefs : downRefs).current.get(type)
    if (btn && !btn.disabled) {
      btn.focus()
    } else {
      cardRefs.current.get(type)?.focus()
    }
  }, [moveFocus])

  // 저장된 레이아웃 → 알려진 위젯만 해석(알 수 없는 타입은 조용히 스킵).
  const savedEntries = useMemo<ResolvedEntry[]>(() => {
    return (data?.widgets ?? [])
      .map((cfg) => {
        const def = getDashboardWidget(cfg.type)
        return def ? { def, cfg } : null
      })
      .filter((e): e is ResolvedEntry => e !== null)
  }, [data])

  // 편집 진입 — 저장본을 드래프트로 복제, undo/메시지 초기화.
  function enterEdit() {
    setDraft((data?.widgets ?? []).map((w) => ({ ...w })))
    setUndoSnapshot(null)
    setLiveMsg('')
    setEditing(true)
  }

  // 편집 취소 — 드래프트를 마지막 저장본으로 되돌리고 종료(영속화 없음).
  function cancelEdit() {
    setEditing(false)
    setUndoSnapshot(null)
    setLiveMsg('')
  }

  // 모든 변형 액션 직전에 현재 드래프트를 스냅샷(단일-레벨 undo).
  function snapshot() {
    setUndoSnapshot(draft.map((w) => ({ ...w })))
  }

  // 위젯 이동(위/아래) — 드래프트 배열 내 순서 교환. 이동 후 포커스 복원 토큰 갱신.
  function moveWidget(type: string, dir: -1 | 1) {
    snapshot()
    setDraft((prev) => {
      const i = prev.findIndex((w) => w.type === type)
      const j = i + dir
      if (i < 0 || j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
    const def = getDashboardWidget(type)
    setLiveMsg(`${def?.title ?? type} 위젯을 ${dir < 0 ? '위로' : '아래로'} 이동했습니다`)
    // I2: 리렌더 후 effect 가 포커스를 복원하도록 토큰 갱신(동일 type 연속 이동도 트리거).
    moveTokenRef.current += 1
    setMoveFocus({ type, dir, token: moveTokenRef.current })
  }

  // 표시/숨김 토글.
  // I1: updater 콜백 안에서 nowHidden 을 잡으면 React19 동시성에서 보장이 안 되므로,
  // 핸들러에서 항상 최신인 draft 로 먼저 계산한 뒤 setDraft/aria-live 에 사용한다.
  function toggleHidden(type: string) {
    const cur = draft.find((w) => w.type === type)
    const nowHidden = cur ? !cur.hidden : true
    snapshot()
    setDraft((prev) => prev.map((w) => (w.type === type ? { ...w, hidden: nowHidden } : w)))
    const def = getDashboardWidget(type)
    setLiveMsg(`${def?.title ?? type} 위젯을 ${nowHidden ? '숨김' : '표시'} 처리했습니다`)
  }

  // B1: 부재(미시드) 위젯을 draft 에 재추가 — snapshot 먼저(undo 일관성) → append.
  function addWidget(type: string) {
    snapshot()
    setDraft((prev) =>
      prev.some((w) => w.type === type) ? prev : [...prev, { type, count: 5, hidden: false }],
    )
    const def = getDashboardWidget(type)
    setLiveMsg(`${def?.title ?? type} 위젯을 추가했습니다`)
  }

  // 항목 수 변경.
  function setCount(type: string, count: number) {
    snapshot()
    setDraft((prev) => prev.map((w) => (w.type === type ? { ...w, count } : w)))
    const def = getDashboardWidget(type)
    setLiveMsg(`${def?.title ?? type} 위젯 항목 수를 ${count}개로 변경했습니다`)
  }

  // 되돌리기 — 마지막 액션 이전 스냅샷으로 복원(단일 레벨; 복원 후 비활성화).
  function undo() {
    if (!undoSnapshot) return
    setDraft(undoSnapshot)
    setUndoSnapshot(null)
    setLiveMsg('마지막 편집을 되돌렸습니다')
  }

  // 저장 — 드래프트를 PUT. 성공 시 편집 종료(캐시는 응답으로 갱신), 실패 시 토스트.
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

  // 홈 상단 헤더 — 타 모듈과 동일한 '아이콘 + 모듈명' PageHeader(#505). 사이드바 없는 홈의 타이틀 담당.
  const homeIcon = <Home className="h-5 w-5 text-muted-foreground" />

  // 레이아웃 로딩 중에는 ①② 도 데이터가 무의미하므로 전체 스켈레톤(③ 자리). 헤더는 동일 유지.
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
    .map((cfg) => {
      const def = getDashboardWidget(cfg.type)
      return def ? { def, cfg } : null
    })
    .filter((e): e is ResolvedEntry => e !== null)

  // B1: draft 에 아예 없는 위젯 타입(레거시 변환·문자열-배열 저장 등으로 시드 안 됨) — 갤러리로 재추가 경로.
  // (숨김=dimmed 잔류는 draft 에 '있는' hidden 위젯 전용. 갤러리는 draft 에 '없는' 타입만 다룬다.)
  const draftTypes = new Set(draft.map((w) => w.type))
  const absentWidgets = allDashboardWidgets().filter((w) => !draftTypes.has(w.type))

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 상단 헤더 — 모듈명(아이콘+'홈')은 PageHeader 가, 편집 진입 토글은 우측 actions 가 담당(#505).
          편집 중에는 헤더 토글을 숨기고 본문 편집 배너(저장/취소/되돌리기)가 컨트롤을 맡는다. */}
      <PageHeader
        data-testid="canvas-header"
        title="홈"
        icon={homeIcon}
        actions={
          !editing && (
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
          )
        }
      />
      <div className="flex-1 space-y-4 overflow-auto p-4">
        {/* ① 합성 레이어 — 풀폭(그리드 밖). 편집 중에는 비편집 영역으로 데이터 의미가 약하므로 dim. */}
      <div className={editing ? 'pointer-events-none opacity-60' : undefined}>
        <SynthesisLayer />
        {/* ② 빠른 액션 — 풀폭(그리드 밖). */}
        <div className="mt-4">
          <QuickActions />
        </div>
      </div>

      {/* 편집 배너 — 저장/취소/되돌리기. */}
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

      {/* 편집 액션 스크린리더 피드백. */}
      <div className="sr-only" aria-live="polite" data-testid="dashboard-edit-live">
        {liveMsg}
      </div>

      {/* ③ 소스별 위젯 그리드 — 커스터마이즈 레이어. 피드성은 row-span. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3" data-testid="dashboard">
        {editing
          ? // 편집 모드: 숨김 포함 전부 표시(숨김은 dimmed → 재표시 경로).
            draftEntries.map((e, i) => (
              <EditableWidgetCard
                key={e.def.type}
                widget={e.def}
                cfg={e.cfg}
                index={i}
                total={draftEntries.length}
                onMove={(dir) => moveWidget(e.def.type, dir)}
                onToggleHidden={() => toggleHidden(e.def.type)}
                onCount={(n) => setCount(e.def.type, n)}
                cardRef={(el) => {
                  if (el) cardRefs.current.set(e.def.type, el)
                  else cardRefs.current.delete(e.def.type)
                }}
                upRef={(el) => {
                  if (el) upRefs.current.set(e.def.type, el)
                  else upRefs.current.delete(e.def.type)
                }}
                downRef={(el) => {
                  if (el) downRefs.current.set(e.def.type, el)
                  else downRefs.current.delete(e.def.type)
                }}
              />
            ))
          : // 일반 뷰: 숨김 제외, 저장 순서로 렌더.
            savedEntries
              .filter((e) => !e.cfg.hidden)
              .map((e) => <WidgetCard key={e.def.type} widget={e.def} count={e.cfg.count} />)}
      </div>

      {/* B1: 추가 가능한 위젯 갤러리 — draft 에 없는 타입만 재추가 경로로 노출(게이트 §2). */}
      {editing && absentWidgets.length > 0 && (
        <div data-testid="dashboard-add-gallery">
          <div className="mb-2 text-sm font-medium text-muted-foreground">추가 가능한 위젯</div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {absentWidgets.map((w) => {
              const Icon = w.icon
              return (
                <Card
                  key={w.type}
                  className="border-dashed"
                  data-testid="dashboard-add-card"
                  data-widget={w.type}
                >
                  <CardContent className="flex items-center justify-between gap-2 py-4">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Icon className="h-4 w-4" />
                      <span className="text-sm font-medium">{w.title}</span>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      data-testid="widget-add"
                      aria-label={`추가: ${w.title}`}
                      onClick={() => addWidget(w.type)}
                    >
                      <Plus className="h-4 w-4" />
                      추가
                    </Button>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </div>
      )}
      </div>
    </div>
  )
}
