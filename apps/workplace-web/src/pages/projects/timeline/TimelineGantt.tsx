import '@svar-ui/react-gantt/style.css'
// 행 40px·시간축 텍스트 위계 오버라이드(#646) — .timeline-gantt-root 스코프로만 적용.
import './timeline-gantt.css'

import {
  Gantt,
  type IApi,
  type IColumnConfig,
  type IScaleConfig,
  type ITask,
  Willow,
  WillowDark,
} from '@svar-ui/react-gantt'
import { addDays, format, parseISO } from 'date-fns'
import { Diamond } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useEffect, useMemo, useRef } from 'react'

import type {
  TimelineCycleBand,
  TimelineDependencyEdge,
  TimelineEpicGroup,
  TimelineMilestoneMarker,
} from './timelineTypes'

// 데이터 모델(TimelineBar 등)은 timelineTypes.ts 로 이동했다 — timelineData.ts 와 이 파일이
// 서로의 타입을 import 하는 순환을 막기 위함(#649). 하위 호환을 위해 재노출한다.
export type {
  TimelineBar,
  TimelineCycleBand,
  TimelineDependencyEdge,
  TimelineEpicGroup,
  TimelineMilestoneMarker,
} from './timelineTypes'

export type TimelineZoom = 'week' | 'month'

export interface TimelineGanttProps {
  /** 에픽 그룹 트리(#649) — bars 대신 groups 를 받아 부모(에픽)/자식(하위 이슈) 트리로 렌더한다. */
  groups: TimelineEpicGroup[]
  /** 접힌 그룹 key 목록 — localStorage 지속은 페이지(TimelinePage)가 소유. */
  collapsedKeys: string[]
  /** SVAR 트리 토글 → 페이지 상태로 접힘 여부 보고. */
  onToggleGroup: (key: string, open: boolean) => void
  milestones: TimelineMilestoneMarker[]
  cycles: TimelineCycleBand[]
  dependencies: TimelineDependencyEdge[]
  zoom: TimelineZoom
  /** 비멤버 조회 전용 모드 — 드래그/리사이즈/링크 편집 전면 비활성 */
  readOnly: boolean
  /** [오늘] 버튼 등에서 특정 날짜로 스크롤 이동 */
  scrollToDate?: string
  onBarChange: (issueNumber: number, change: { startDate: string; dueDate: string }) => void
  onBarClick: (issueNumber: number) => void
  onMilestoneClick: (id: number, anchorRect: DOMRect) => void
  onLaneClick: (date: string, anchorRect: DOMRect) => void
}

// 그룹(에픽) 행의 SVAR task id 는 문자열 네임스페이스로 이슈번호(number)와 분리한다.
// 마일스톤 레인 좌측 "마일스톤" 라벨 폭 + 여백 확보용 고정값(px) — 우측 스크롤 시 칩의
// translateX 가 음수에 가까워지며 라벨 위로 겹치는 것을 막는다. 라벨 실측 대신 고정 여백을
// 쓴 것은 이 스코프에서 동적 폭 측정이 과설계이기 때문(YAGNI).
const MILESTONE_LABEL_RESERVED_PX = 64

const GROUP_ID_PREFIX = 'group-'
const groupTaskId = (key: string) => `${GROUP_ID_PREFIX}${key}`
const isGroupTaskId = (id: unknown): id is string =>
  typeof id === 'string' && id.startsWith(GROUP_ID_PREFIX)

// 이슈 상태별 막대 색상 — IssueStatusIcon/IssueStatusBadge 와 동일한 시맨틱 토큰(hex 금지). CANCELED 이슈는
// groupTimelineIssues 에서 막대 목록 자체에 포함되지 않아 매핑 대상이 아니다.
const STATUS_BAR_COLOR: Record<'TODO' | 'IN_PROGRESS' | 'DONE', string> = {
  TODO: 'var(--muted-foreground)',
  IN_PROGRESS: 'var(--primary)',
  DONE: 'var(--success)',
}

const WEEK_SCALES: IScaleConfig[] = [
  { unit: 'month', step: 1, format: (date) => format(date, 'yyyy년 M월') },
  { unit: 'week', step: 1, format: (date) => format(date, "'W'w") },
]

const MONTH_SCALES: IScaleConfig[] = [
  { unit: 'year', step: 1, format: (date) => format(date, 'yyyy년') },
  { unit: 'month', step: 1, format: (date) => format(date, 'M월') },
]

// SVAR 기본 그리드 컬럼 헤더가 영문(Task name/Start date/Duration)이라 앱 전체 한국어 UI와
// 어긋남 — id/width 는 SVAR 기본값(getDefaultColumns)을 유지하고 header 텍스트만 교체한다.
const GRID_COLUMNS: IColumnConfig[] = [
  { id: 'text', header: '이슈', width: 183, flexgrow: 1, sort: true },
  { id: 'start', header: '시작일', width: 120, align: 'center', sort: true },
  { id: 'duration', header: '기간', width: 100, align: 'center', sort: true },
]

/**
 * TimelineBar/Milestone/Cycle/Dependency 데이터 모델을 SVAR React Gantt 의
 * task/link 스키마로 변환해 렌더링하는 어댑터. 페이지 쪽은 SVAR 내부 API를
 * 전혀 알 필요 없이 이 컴포넌트의 props 만 소비한다.
 */
export function TimelineGantt({
  groups,
  collapsedKeys,
  onToggleGroup,
  milestones,
  cycles,
  dependencies,
  zoom,
  readOnly,
  scrollToDate,
  onBarChange,
  onBarClick,
  onMilestoneClick,
  onLaneClick,
}: TimelineGanttProps) {
  const apiRef = useRef<IApi | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const todayLineRef = useRef<HTMLDivElement | null>(null)
  const cycleBandLabelRefs = useRef(new Map<number, HTMLDivElement>())
  // 마일스톤 레인 칩/세로 점선 DOM 참조(#648) — SVAR task 가 아니라 별도 오버레이라 자체 ref 맵으로 관리한다.
  const milestoneChipRefs = useRef(new Map<number, HTMLButtonElement>())
  const milestoneVlineRefs = useRef(new Map<number, HTMLDivElement>())
  // 마일스톤 레인과 그 아래 차트의 그리드/차트 경계선을 잇는 구분선 — 레인이 별도 sibling div라
  // SVAR 내부 구분선이 이 행 높이에서는 그려지지 않아 시각적으로 끊겨 보이는 문제를 보정한다.
  const milestoneDividerRef = useRef<HTMLDivElement | null>(null)
  // onToggleGroup 최신 참조 — api.on 구독 콜백이 stale closure 를 잡지 않도록.
  // 렌더 중 ref 갱신은 React Compiler 가 금지하므로(react-hooks/refs) 이펙트에서 갱신한다.
  const onToggleGroupRef = useRef(onToggleGroup)
  useEffect(() => {
    onToggleGroupRef.current = onToggleGroup
  }, [onToggleGroup])

  // 그룹(에픽)의 하위 이슈 막대를 평탄화 — 색상 주입 이펙트/의존성 필터링용(#649, groups.flatMap 반복 방지).
  const bars = useMemo(() => groups.flatMap((g) => g.bars), [groups])

  const tasks = useMemo<ITask[]>(() => {
    // SVAR 는 bar 엘리먼트에 task 필드 기반 커스텀 className 주입 API 가 없음(고정 `wx-bar wx-${type}`,
    // 스파이크 노트 참조) — 상태별 색상은 아래 이펙트에서 DOM에 직접 CSS 변수를 주입해 구현한다(#639).
    // 마일스톤은 더 이상 SVAR task 로 렌더되지 않는다(#648) — 이슈 행을 차지하지 않도록 상단 고정
    // 레인(칩)+세로 점선 오버레이로 완전히 분리했다.
    // 에픽 그룹 트리(#649) — 그룹 행(summary) + 자식 행(task, parent 연결)을 순서대로 쌓는다.
    const collapsed = new Set(collapsedKeys)
    const result: ITask[] = []
    for (const group of groups) {
      const groupId = groupTaskId(group.key)
      const fallbackDate = group.range?.start ?? group.range?.due ?? group.bars[0]?.due ?? format(new Date(), 'yyyy-MM-dd')
      const fallbackDue = group.range?.due ?? group.bars[0]?.due ?? fallbackDate
      // SVAR 내부 트리 빌더(Nt2, dist/index.es.js toArray)는 `open === true` 인 노드를 만나면
      // 무조건 `n.data.forEach` 로 자식을 순회한다 — 자식이 한 번도 추가되지 않아 `data` 가
      // undefined 이거나 명시적으로 null 로 비워진(_clearBranch) 노드에 `open: true` 를 주면
      // `null/undefined.forEach()` 로 크래시한다(#656). `type` 은 이 크래시와 무관하며(둘 다
      // 영향받음), 실제 불변식은 "자식이 없으면 open 필드 자체를 넣지 않는다"이다.
      const hasChildren = group.bars.length > 0
      result.push({
        id: groupId,
        // 진행률은 텍스트로 병기 — SVAR 그리드 셀 커스텀 렌더 미지원 전제의 안전한 표현.
        text: group.total > 0 ? `${group.title} (${group.done}/${group.total})` : group.title,
        // no-epic 도 range 를 롤업해 받으므로(#662) 그리드 시작일/기간 컬럼엔 항상 실제 값이 뜬다.
        // 그래도 range 자체가 비는 케이스(막대 없는 에픽)를 위해 group.bars[0]?.due 폴백은 유지 (SVAR 는 start 필수).
        start: parseISO(fallbackDate),
        end: addDays(parseISO(fallbackDue), 1),
        type: hasChildren ? 'summary' : 'task',
        ...(hasChildren ? { open: !collapsed.has(group.key) } : {}),
      })
      for (const bar of group.bars) {
        const startDate = bar.start ? parseISO(bar.start) : parseISO(bar.due)
        const endDate = addDays(parseISO(bar.due), 1)
        result.push({
          id: bar.issueNumber,
          parent: groupId,
          text: `${bar.issueKey} ${bar.title}`,
          start: startDate,
          end: endDate,
          type: 'task',
          progress: bar.status === 'DONE' ? 100 : 0,
          dueOnly: bar.start === null,
          status: bar.status,
        })
      }
    }
    return result
  }, [groups, collapsedKeys])

  const links = useMemo(
    () =>
      dependencies.map((edge, index) => ({
        id: `dep-${edge.fromIssueNumber}-${edge.toIssueNumber}-${index}`,
        source: edge.fromIssueNumber,
        target: edge.toIssueNumber,
        // 이 앱의 유일한 의존성 유형은 "선행 필요"(finish-to-start) — 선행 이슈가 끝나야
        // 후행 이슈가 시작 가능하다는 의미이므로 화살표는 e2s(end-to-start)여야 한다(#671).
        type: 'e2s' as const,
      })),
    [dependencies],
  )

  // 사이클 구간에 속한 날짜는 highlightTime 이 반환하는 CSS 클래스로 셀 배경을 물들인다.
  const highlightTime = useMemo(() => {
    const bands = cycles.map((cycle) => ({
      start: parseISO(cycle.startDate).getTime(),
      end: parseISO(cycle.endDate).getTime(),
    }))
    return (date: Date) => {
      const time = date.getTime()
      return bands.some((band) => time >= band.start && time < band.end) ? 'timeline-cycle-band' : ''
    }
  }, [cycles])

  const scales = zoom === 'week' ? WEEK_SCALES : MONTH_SCALES
  // SVAR 는 <Willow>/<WillowDark> 테마 래퍼가 있어야 CSS 변수(막대 배경·보더·마일스톤 다이아몬드 등)가
  // 채워진다 — 래퍼 없이 렌더하면 막대가 투명해져 텍스트만 남는다. 앱 폰트 스택 유지 위해 fonts=false.
  const { resolvedTheme } = useTheme()
  const ThemeWrapper = resolvedTheme === 'dark' ? WillowDark : Willow

  useEffect(() => {
    if (!scrollToDate || !apiRef.current) return
    apiRef.current.exec('scroll-chart', { date: parseISO(scrollToDate) })
  }, [scrollToDate])

  // 오늘 세로선 + 사이클 밴드 라벨 오버레이 — 스파이크 노트대로 `.wx-chart`(실 스크롤 컨테이너) 의
  // scroll 이벤트에서 순수 DOM transform 갱신(리액트 리렌더 없이 동기화, 성능 고려).
  useEffect(() => {
    const container = containerRef.current
    const api = apiRef.current
    if (!container || !api) return
    const scroller = container.querySelector<HTMLElement>('.wx-chart')
    if (!scroller) return

    let todayLeft = 0
    const bandLefts = new Map<number, { left: number; width: number }>()
    // 마일스톤 오버레이 좌표(#648) — vline 은 항상 마감일 정확한 X, 칩은 겹칠 때 우측으로 밀어
    // 배치한 X. 두 값을 분리해야 칩이 밀려도 실제 마감 위치를 점선으로 정확히 알 수 있다.
    const milestoneLefts = new Map<number, number>()
    const chipLefts = new Map<number, number>()

    const recompute = () => {
      const chartScales = api.getState()._scales
      if (!chartScales) return
      const msPerPixel = (chartScales.end.getTime() - chartScales.start.getTime()) / chartScales.width
      const toOffset = (date: Date) => (date.getTime() - chartScales.start.getTime()) / msPerPixel
      // 오버레이는 containerRef 기준 absolute — `.wx-chart` 가 그리드 패널 뒤에서 시작하므로 그 시작 오프셋을 더한다.
      const baseLeft = scroller.getBoundingClientRect().left - container.getBoundingClientRect().left
      // 마일스톤 레인은 containerRef 와 같은 좌측 원점을 공유하는 sibling 이므로, 그리드/차트
      // 경계(baseLeft)에 맞춰 구분선을 그으면 아래 차트의 내부 경계선과 이어져 보인다. 이 경계는
      // 가로 스크롤과 무관하게 고정된 위치라 scrollLeft 보정이 필요 없다(칩/점선과의 차이점).
      if (milestoneDividerRef.current) {
        milestoneDividerRef.current.style.left = `${baseLeft}px`
      }
      // 사이클 밴드 라벨은 스케일 헤더(월/주 눈금, `.wx-scale`) 아래 차트 바디 상단에 붙여야
      // 헤더 눈금 텍스트와 겹치지 않는다 — `.wx-chart` 자체는 헤더까지 포함해 top 이 0이라 헤더 높이를 더한다.
      const scaleHeader = scroller.querySelector<HTMLElement>('.wx-scale')
      const baseTop = scaleHeader ? scaleHeader.getBoundingClientRect().height : 0
      for (const el of cycleBandLabelRefs.current.values()) {
        el.style.top = `${baseTop}px`
      }
      todayLeft = baseLeft + toOffset(new Date())
      bandLefts.clear()
      for (const band of cycles) {
        const left = baseLeft + toOffset(parseISO(band.startDate))
        const width = baseLeft + toOffset(parseISO(band.endDate)) - left
        bandLefts.set(band.id, { left, width })
      }
      // 마감일 오름차순으로 훑으며 직전 칩과 겹치면 그 우측 +4px 로 밀어 배치(간단한 충돌 회피).
      milestoneLefts.clear()
      chipLefts.clear()
      const sortedMilestones = [...milestones].sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      let prevRight = -Infinity
      for (const m of sortedMilestones) {
        const x = baseLeft + toOffset(parseISO(m.dueDate))
        milestoneLefts.set(m.id, x)
        const chip = milestoneChipRefs.current.get(m.id)
        const width = chip?.offsetWidth ?? 0
        const left = Math.max(x - width / 2, prevRight + 4)
        chipLefts.set(m.id, left)
        prevRight = left + width
      }
      applyTransform()
    }

    const applyTransform = () => {
      const scrollLeft = scroller.scrollLeft
      if (todayLineRef.current) {
        todayLineRef.current.style.transform = `translateX(${todayLeft - scrollLeft}px)`
      }
      for (const [id, { left, width }] of bandLefts) {
        const el = cycleBandLabelRefs.current.get(id)
        if (!el) continue
        el.style.transform = `translateX(${left - scrollLeft}px)`
        el.style.width = `${width}px`
      }
      for (const [id, left] of chipLefts) {
        const chip = milestoneChipRefs.current.get(id)
        // 우측 스크롤 시 (left - scrollLeft) 가 음수에 가까워지며 좌측 "마일스톤" 라벨과
        // 겹칠 수 있어, 라벨 예약 폭 미만으로는 밀리지 않도록 클램프한다.
        if (chip) chip.style.transform = `translateX(${Math.max(left - scrollLeft, MILESTONE_LABEL_RESERVED_PX)}px)`
      }
      for (const [id, left] of milestoneLefts) {
        const vline = milestoneVlineRefs.current.get(id)
        if (vline) vline.style.transform = `translateX(${left - scrollLeft}px)`
      }
    }

    recompute()
    scroller.addEventListener('scroll', applyTransform)
    return () => scroller.removeEventListener('scroll', applyTransform)
  }, [cycles, zoom, tasks, milestones])

  // 이슈 막대 상태별 색상(#639) — SVAR 는 task 필드 기반 className/style 주입 API 가 없어(스파이크 노트),
  // 렌더된 `.wx-bar` DOM 노드에 직접 CSS 변수를 주입한다. `--wx-gantt-task-color`(기본 배경)와
  // `--wx-gantt-task-fill-color`(progress 오버레이 배경, DONE=100% 라 전면 노출)를 모두 덮어써야
  // 완료 이슈 막대가 실제로 success 색으로 보인다. SVAR(내부 Svelte 렌더러)가 자체 리렌더 시 bar
  // 엘리먼트의 style 속성을 통째로 다시 쓰기 때문에(마운트 직후 1회 주입만으로는 씻겨나감),
  // MutationObserver 로 재적용한다 — 이미 값이 같으면 재기록을 skip 해 무한 루프를 막는다.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const applyColors = () => {
      for (const bar of bars) {
        if (bar.status === 'CANCELED') continue
        const color = STATUS_BAR_COLOR[bar.status]
        const el = container.querySelector<HTMLElement>(`.wx-bar[data-task-id$="${bar.issueNumber}"]`)
        if (!el || el.style.getPropertyValue('--wx-gantt-task-color') === color) continue
        el.style.setProperty('--wx-gantt-task-color', color)
        el.style.setProperty('--wx-gantt-task-fill-color', color)
      }
    }
    applyColors()
    const observer = new MutationObserver(applyColors)
    observer.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class'],
    })
    return () => observer.disconnect()
  }, [bars, tasks])

  // 클릭 X 좌표(스크롤 보정 포함) → 'yyyy-MM-dd' 날짜 문자열. 이슈 빈 레인 클릭(생성)과
  // 마일스톤 레인 빈곳 클릭(생성) 이 동일 좌표계를 공유하므로 함수로 추출해 재사용한다(#648).
  const dateFromClientX = (clientX: number): string | null => {
    const api = apiRef.current
    const container = containerRef.current
    if (!api || !container) return null
    const scroller = container.querySelector<HTMLElement>('.wx-chart')
    if (!scroller) return null
    const scales = api.getState()._scales
    if (!scales) return null
    const rect = scroller.getBoundingClientRect()
    const rawOffsetX = clientX - rect.left + scroller.scrollLeft
    // 마일스톤 레인 좌측(그리드 패널 폭 구간, "마일스톤" 라벨 근처)을 클릭하면 rawOffsetX 가
    // 음수가 될 수 있어(음수 * msPerPixel → 1970년 이전 날짜) scales 범위로 클램프한다.
    const offsetX = Math.max(0, Math.min(rawOffsetX, scales.width))
    const msPerPixel = (scales.end.getTime() - scales.start.getTime()) / scales.width
    return format(new Date(scales.start.getTime() + offsetX * msPerPixel), 'yyyy-MM-dd')
  }

  // 마일스톤 레인 빈곳 클릭 → 생성 다이얼로그(레인 클릭 경로). readOnly 에서는 비활성.
  const handleLaneClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (readOnly) return
    const date = dateFromClientX(event.clientX)
    if (date) onLaneClick(date, (event.target as HTMLElement).getBoundingClientRect())
  }

  // 눈금 빈 레인 클릭(인라인 생성) 은 SVAR 액션에 대응 항목이 없어(스파이크 노트 확인)
  // 스크롤 컨테이너(`.wx-chart`, 스파이크 노트의 셀렉터)에 네이티브 클릭 리스너를 붙여
  // 클릭 좌표 → 날짜를 직접 계산한다. readOnly 에서는 인라인 생성을 막는다.
  useEffect(() => {
    const container = containerRef.current
    const api = apiRef.current
    if (!container || !api || readOnly) return
    const scroller = container.querySelector<HTMLElement>('.wx-chart')
    if (!scroller) return
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (target.closest('.wx-bar')) return // 막대 클릭은 onSelectTask 가 처리
      const date = dateFromClientX(event.clientX)
      if (date) onLaneClick(date, target.getBoundingClientRect())
    }
    scroller.addEventListener('click', handleClick)
    return () => scroller.removeEventListener('click', handleClick)
  }, [onLaneClick, readOnly])

  return (
    <div className="flex h-full w-full flex-col">
      {/* 마일스톤 레인(#648) — 이슈 행과 분리된 상단 고정 스트립. 시간축과 같은 좌표계를 쓰며
          위 effect 가 `.wx-chart` 스크롤에 맞춰 칩/점선 transform 을 동기화한다(오늘선과 동일 패턴). */}
      <div
        data-testid="milestone-lane"
        className="bg-primary/10 relative h-8 shrink-0 overflow-hidden border-b"
        onClick={handleLaneClick}
      >
        <span className="text-primary/70 absolute top-1/2 left-3 -translate-y-1/2 text-xs font-semibold tracking-wider uppercase">
          마일스톤
        </span>
        {/* 그리드/차트 경계 구분선 — 아래 차트의 내부 경계선과 이어지도록 baseLeft 위치에 고정(스크롤 무관). */}
        <div
          ref={milestoneDividerRef}
          data-testid="milestone-lane-divider"
          className="border-border pointer-events-none absolute inset-y-0 w-0 border-l"
        />
        {milestones.map((m) => (
          <button
            key={m.id}
            type="button"
            ref={(el) => {
              if (el) milestoneChipRefs.current.set(m.id, el)
              else milestoneChipRefs.current.delete(m.id)
            }}
            data-testid={`milestone-chip-${m.id}`}
            className="bg-primary text-primary-foreground absolute top-1 flex items-center gap-1 rounded-sm px-2 py-0.5 text-xs font-medium"
            onClick={(e) => {
              e.stopPropagation() // 레인 빈곳 클릭(생성)과 분리 — 칩 클릭은 편집 팝오버만 연다.
              if (readOnly) return // readOnly 에서는 칩 클릭도 편집 팝오버를 열지 않는다.
              onMilestoneClick(m.id, e.currentTarget.getBoundingClientRect())
            }}
          >
            <Diamond className="h-3 w-3" aria-hidden="true" />
            <span className="max-w-40 truncate">{m.name}</span>
          </button>
        ))}
      </div>
      {/* timeline-gantt-root 는 timeline-gantt.css 오버라이드의 스코프 앵커(#646) */}
      <div ref={containerRef} className="timeline-gantt-root relative min-h-0 flex-1 overflow-hidden">
        {/* 오늘 세로선 — `.wx-chart` 스크롤에 맞춰 위 effect 가 transform 을 직접 갱신한다. */}
        <div
          ref={todayLineRef}
          data-testid="timeline-today-line"
          className="pointer-events-none absolute inset-y-0 left-0 z-10 w-px bg-destructive"
        />
        {/* 사이클 밴드 라벨 — highlightTime 이 칠한 배경 위에 이름을 표시한다. */}
        {cycles.map((band) => (
          <div
            key={band.id}
            ref={(el) => {
              if (el) cycleBandLabelRefs.current.set(band.id, el)
              else cycleBandLabelRefs.current.delete(band.id)
            }}
            data-testid="timeline-cycle-band"
            className="pointer-events-none absolute top-0 left-0 z-10 truncate px-1 text-xs text-muted-foreground"
          >
            {band.name}
          </div>
        ))}
        {/* 마일스톤 마감일 세로 점선(#648) — 칩이 충돌로 밀려도 실제 마감 위치는 이 점선이 정확히 보장한다. */}
        {milestones.map((m) => (
          <div
            key={m.id}
            ref={(el) => {
              if (el) milestoneVlineRefs.current.set(m.id, el)
              else milestoneVlineRefs.current.delete(m.id)
            }}
            data-testid={`milestone-vline-${m.id}`}
            className="border-primary pointer-events-none absolute inset-y-0 left-0 z-10 w-0 border-l-2 border-dashed"
          />
        ))}
        {/*
          의존 화살표는 1차 표시 전용(스펙) — SVAR 가 막대 hover 시 좌우에 렌더하는
          링크 생성용 원형 핸들(.wx-link.wx-target)만 숨긴다. 실제 화살표 경로는
          별도 SVG(svg.wx-links)라 이 규칙과 겹치지 않음 — 화살표는 그대로 보인다.
        */}
        <style>{'.wx-link.wx-target { display: none !important; }'}</style>
        {/* SVAR의 실제 prop명은 소문자 readonly — camelCase readOnly로 변경하면 동작하지 않음 */}
        {/* Willow/WillowDark 래퍼 — 테마 CSS 변수 주입(막대 색상 등), fonts=false 로 앱 폰트 스택 유지 */}
        <ThemeWrapper fonts={false}>
          <Gantt
            ref={(api) => {
              // ref 콜백은 리렌더마다 불릴 수 있어 같은 api 인스턴스에 중복 구독하지 않도록 가드.
              if (api && apiRef.current !== api) {
                apiRef.current = api
                // SVAR 트리 토글(그리드 화살표 클릭) → 접힘 상태를 페이지로 보고(#649).
                // api.on 은 액션 스트림 구독 — 그룹 행(문자열 id)만 걸러 onToggleGroup 호출.
                api.on('open-task', (ev: { id: unknown; mode: boolean }) => {
                  if (isGroupTaskId(ev.id)) onToggleGroupRef.current(ev.id.slice(GROUP_ID_PREFIX.length), ev.mode)
                })
              }
              if (!api) apiRef.current = null
            }}
            tasks={tasks}
            links={links}
            scales={scales}
            columns={GRID_COLUMNS}
            readonly={readOnly}
            // 행 40px·스케일 36px — Jira 급 밀도(#646). 제목 잘림 해소, 4px 그리드 준수
            cellHeight={40}
            scaleHeight={36}
            highlightTime={highlightTime}
            onUpdateTask={(ev) => {
              if (ev.inProgress) return // 드래그 진행중 중간 이벤트는 무시하고 확정 시점만 저장
              const { id, task } = ev
              if (typeof id === 'number' && task.start && task.end) {
                onBarChange(id, {
                  startDate: format(task.start, 'yyyy-MM-dd'),
                  dueDate: format(addDays(task.end, -1), 'yyyy-MM-dd'),
                })
              }
            }}
            onSelectTask={(ev) => {
              // 그룹(에픽) 행 클릭 = 에픽 이슈 상세로 이동. no-epic 가상 그룹은 이동 대상이 없어 무시.
              if (!ev.id) return
              if (isGroupTaskId(ev.id)) {
                const key = ev.id.slice(GROUP_ID_PREFIX.length)
                const group = groups.find((g) => g.key === key)
                if (group?.epicNumber != null) onBarClick(group.epicNumber)
                return
              }
              if (typeof ev.id === 'number') onBarClick(ev.id)
            }}
          />
        </ThemeWrapper>
      </div>
    </div>
  )
}
