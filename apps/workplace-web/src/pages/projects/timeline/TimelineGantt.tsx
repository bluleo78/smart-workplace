import '@svar-ui/react-gantt/style.css'

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
import { useTheme } from 'next-themes'
import { useEffect, useMemo, useRef } from 'react'

import type { IssueStatus } from '@/types/issue'

/** 간트에 표시할 이슈 1건 — start 가 null 이면 마감일만 있는 이슈(1일 폭 막대로 렌더). */
export interface TimelineBar {
  issueNumber: number
  issueKey: string
  title: string
  start: string | null
  due: string
  status: IssueStatus
}

/** 프로젝트 마일스톤 — SVAR milestone 타입 task 로 매핑된다. */
export interface TimelineMilestoneMarker {
  id: number
  name: string
  dueDate: string
}

/** 사이클(스프린트) 구간 — 눈금 셀 배경(highlightTime)으로 표시. */
export interface TimelineCycleBand {
  id: number
  name: string
  startDate: string
  endDate: string
}

/** 이슈 간 의존 관계 — 표시 전용(SVAR link 생성 편집 UI는 비활성). */
export interface TimelineDependencyEdge {
  fromIssueNumber: number
  toIssueNumber: number
}

export type TimelineZoom = 'week' | 'month'

export interface TimelineGanttProps {
  bars: TimelineBar[]
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
  onMilestoneMove: (id: number, dueDate: string) => void
  onMilestoneClick: (id: number, anchorRect: DOMRect) => void
  onLaneClick: (date: string, anchorRect: DOMRect) => void
}

// 이슈 상태별 막대 색상 — IssueStatusIcon/IssueStatusBadge 와 동일한 시맨틱 토큰(hex 금지). CANCELED 이슈는
// splitSchedulable 에서 막대 목록 자체에 포함되지 않아 매핑 대상이 아니다.
const STATUS_BAR_COLOR: Record<'TODO' | 'IN_PROGRESS' | 'DONE', string> = {
  TODO: 'var(--muted-foreground)',
  IN_PROGRESS: 'var(--primary)',
  DONE: 'var(--success)',
}

// 마일스톤은 이슈번호(number)와 SVAR task id 네임스페이스가 충돌하지 않도록 문자열 접두어를 쓴다.
const MILESTONE_ID_PREFIX = 'milestone-'
const milestoneTaskId = (id: number) => `${MILESTONE_ID_PREFIX}${id}`
const isMilestoneTaskId = (id: unknown): id is string =>
  typeof id === 'string' && id.startsWith(MILESTONE_ID_PREFIX)
const milestoneIdFromTaskId = (taskId: string) => Number(taskId.slice(MILESTONE_ID_PREFIX.length))

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
  bars,
  milestones,
  cycles,
  dependencies,
  zoom,
  readOnly,
  scrollToDate,
  onBarChange,
  onBarClick,
  onMilestoneMove,
  onMilestoneClick,
  onLaneClick,
}: TimelineGanttProps) {
  const apiRef = useRef<IApi | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const todayLineRef = useRef<HTMLDivElement | null>(null)
  const cycleBandLabelRefs = useRef(new Map<number, HTMLDivElement>())

  const tasks = useMemo<ITask[]>(() => {
    // SVAR 는 bar 엘리먼트에 task 필드 기반 커스텀 className 주입 API 가 없음(고정 `wx-bar wx-${type}`,
    // 스파이크 노트 참조) — 상태별 색상은 아래 이펙트에서 DOM에 직접 CSS 변수를 주입해 구현한다(#639).
    const barTasks: ITask[] = bars.map((bar) => {
      const startDate = bar.start ? parseISO(bar.start) : parseISO(bar.due)
      const endDate = addDays(parseISO(bar.due), 1)
      return {
        id: bar.issueNumber,
        text: `${bar.issueKey} ${bar.title}`,
        start: startDate,
        end: endDate,
        type: 'task',
        progress: bar.status === 'DONE' ? 100 : 0,
        dueOnly: bar.start === null,
        status: bar.status,
      }
    })

    const milestoneTasks: ITask[] = milestones.map((milestone) => ({
      id: milestoneTaskId(milestone.id),
      text: milestone.name,
      start: parseISO(milestone.dueDate),
      end: parseISO(milestone.dueDate),
      type: 'milestone',
    }))

    return [...barTasks, ...milestoneTasks]
  }, [bars, milestones])

  const links = useMemo(
    () =>
      dependencies.map((edge, index) => ({
        id: `dep-${edge.fromIssueNumber}-${edge.toIssueNumber}-${index}`,
        source: edge.fromIssueNumber,
        target: edge.toIssueNumber,
        type: 's2s' as const,
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

    const recompute = () => {
      const chartScales = api.getState()._scales
      if (!chartScales) return
      const msPerPixel = (chartScales.end.getTime() - chartScales.start.getTime()) / chartScales.width
      const toOffset = (date: Date) => (date.getTime() - chartScales.start.getTime()) / msPerPixel
      // 오버레이는 containerRef 기준 absolute — `.wx-chart` 가 그리드 패널 뒤에서 시작하므로 그 시작 오프셋을 더한다.
      const baseLeft = scroller.getBoundingClientRect().left - container.getBoundingClientRect().left
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
    }

    recompute()
    scroller.addEventListener('scroll', applyTransform)
    return () => scroller.removeEventListener('scroll', applyTransform)
  }, [cycles, zoom, tasks])

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
      if (target.closest('.wx-bar')) return // 막대/마일스톤 클릭은 onSelectTask 가 처리
      const scales = api.getState()._scales
      if (!scales) return
      const rect = scroller.getBoundingClientRect()
      const offsetX = event.clientX - rect.left + scroller.scrollLeft
      const msPerPixel = (scales.end.getTime() - scales.start.getTime()) / scales.width
      const date = new Date(scales.start.getTime() + offsetX * msPerPixel)
      onLaneClick(format(date, 'yyyy-MM-dd'), target.getBoundingClientRect())
    }
    scroller.addEventListener('click', handleClick)
    return () => scroller.removeEventListener('click', handleClick)
  }, [onLaneClick, readOnly])

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
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
            apiRef.current = api
          }}
          tasks={tasks}
          links={links}
          scales={scales}
          columns={GRID_COLUMNS}
          readonly={readOnly}
          highlightTime={highlightTime}
          onUpdateTask={(ev) => {
            if (ev.inProgress) return // 드래그 진행중 중간 이벤트는 무시하고 확정 시점만 저장
            const { id, task } = ev
            if (isMilestoneTaskId(id)) {
              // 마일스톤 드래그는 SVAR 가 task.end 를 채우지 않고 task.start 만 갱신해 보낸다(단일 날짜 타입 특성).
              const movedDate = task.start ?? task.end
              if (movedDate) {
                onMilestoneMove(milestoneIdFromTaskId(id), format(movedDate, 'yyyy-MM-dd'))
              } else {
                console.warn(`마일스톤 이동 실패: task.start/end 모두 미존재`, id)
              }
              return
            }
            if (typeof id === 'number' && task.start && task.end) {
              onBarChange(id, {
                startDate: format(task.start, 'yyyy-MM-dd'),
                dueDate: format(addDays(task.end, -1), 'yyyy-MM-dd'),
              })
            }
          }}
          onSelectTask={(ev) => {
            if (!ev.id) return
            if (isMilestoneTaskId(ev.id)) {
              // 다이아몬드 앵커 — SVAR 는 이벤트에 DOM 엘리먼트를 넘기지 않아 data-task-id 로 직접 조회한다.
              // (SVAR 가 문자열 id 를 DOM 에 `:` 접두어로 직렬화해 정확한 값을 모르므로 endsWith 셀렉터 사용)
              const el = containerRef.current?.querySelector(`.wx-bar[data-task-id$="${ev.id}"]`)
              const anchorRect =
                el?.getBoundingClientRect() ??
                containerRef.current?.getBoundingClientRect() ??
                new DOMRect(0, 0, 0, 0)
              onMilestoneClick(milestoneIdFromTaskId(ev.id), anchorRect)
              return
            }
            if (typeof ev.id === 'number') onBarClick(ev.id)
          }}
        />
      </ThemeWrapper>
    </div>
  )
}
