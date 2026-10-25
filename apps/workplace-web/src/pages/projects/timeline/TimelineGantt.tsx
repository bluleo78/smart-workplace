import '@svar-ui/react-gantt/style.css'
// 행 40px·시간축 텍스트 위계 오버라이드(#646) — .timeline-gantt-root 스코프로만 적용.
import './timeline-gantt.css'

import {
  Gantt,
  type IApi,
  type IColumnConfig,
  type IScaleConfig,
  type ITask,
  registerScaleUnit,
  Willow,
  WillowDark,
} from '@svar-ui/react-gantt'
import { addDays, format, parseISO } from 'date-fns'
import { Diamond } from 'lucide-react'
import { useTheme } from 'next-themes'
import { type RefObject, useEffect, useMemo, useRef, useState } from 'react'

import { formatDateKey } from '@/lib/formatters'
import type { IssueStatus } from '@/types/issue'

import {
  dayCellLabel,
  ganttAxisBounds,
  isWeekend,
  rollupOverlay,
  weekMonthAdd,
  weekMonthDiff,
  weekMonthEnd,
  weekMonthOf,
  weekMonthStart,
  weeksInWeekMonth,
} from './timelineData'
import type {
  TimelineCycleBand,
  TimelineDependencyEdge,
  TimelineEpicGroup,
  TimelineMilestoneMarker,
  TimelineZoom,
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

// 보기 단위 타입은 순수 로직(timelineData)도 쓰므로 timelineTypes 에 둔다(WP-889) — 기존 import 경로 호환용 재수출.
export type { TimelineZoom }

export interface TimelineGanttProps {
  /** 에픽 그룹 트리(#649) — bars 대신 groups 를 받아 부모(에픽)/자식(하위 이슈) 트리로 렌더한다. */
  groups: TimelineEpicGroup[]
  /** 펼친 그룹 key 목록 — localStorage 지속은 페이지(TimelinePage)가 소유. 빈 목록이면 전부 접힘이 기본. */
  expandedKeys: string[]
  /** SVAR 트리 토글 → 페이지 상태로 펼침 여부 보고. */
  onToggleGroup: (key: string, open: boolean) => void
  milestones: TimelineMilestoneMarker[]
  cycles: TimelineCycleBand[]
  dependencies: TimelineDependencyEdge[]
  zoom: TimelineZoom
  /** 비멤버 조회 전용 모드 — 드래그/리사이즈/링크 편집 전면 비활성 */
  readOnly: boolean
  /** [오늘] 버튼 등에서 특정 날짜로 스크롤 이동 — 요청마다 새 객체(seq)라 같은 날짜를 다시 눌러도 스크롤한다(WP-938). */
  scrollRequest?: TimelineScrollRequest
  /** 조회 기간(WP-595) — 간트 축을 이 기간 앞뒤로 자르는 기준. null/없음이면 「전체」라 오늘 기준. */
  period?: { from: string; to: string } | null
  /** 막대 이동/리사이즈 저장. 실패하면 reject 해야 간트가 서버 상태로 되돌린다(아래 saveFailures 참조). */
  onBarChange: (issueNumber: number, change: { startDate: string; dueDate: string }) => Promise<unknown>
  onBarClick: (issueNumber: number) => void
  onMilestoneClick: (id: number, anchorRect: DOMRect) => void
  onLaneClick: (date: string, anchorRect: DOMRect) => void
}

// 그룹(에픽) 행의 SVAR task id 는 문자열 네임스페이스로 이슈번호(number)와 분리한다.
// 마일스톤 레인 좌측 "마일스톤" 라벨 폭 + 여백 확보용 고정값(px) — 우측 스크롤 시 칩의
// translateX 가 음수에 가까워지며 라벨 위로 겹치는 것을 막는다. 라벨 실측 대신 고정 여백을
// 쓴 것은 이 스코프에서 동적 폭 측정이 과설계이기 때문(YAGNI).
const MILESTONE_LABEL_RESERVED_PX = 64
// 겹치는 사이클 이름표 한 줄 높이(text-xs 줄 높이 16px) — 줄을 나눌 때 아래로 내리는 간격(WP-489).
const CYCLE_LABEL_LANE_PX = 16

const GROUP_ID_PREFIX = 'group-'
const groupTaskId = (key: string) => `${GROUP_ID_PREFIX}${key}`
const isGroupTaskId = (id: unknown): id is string =>
  typeof id === 'string' && id.startsWith(GROUP_ID_PREFIX)
// 그룹 task id → group key. 막대 없는 에픽 요약(range=null)은 id 에 '-nobar' 접미사가 붙으므로 제거한다.
const groupKeyFromTaskId = (id: string) => id.slice(GROUP_ID_PREFIX.length).replace(/-nobar$/, '')
// 미정 하위 task 의 id 네임스페이스 — 숫자 이슈번호와 분리해 정적 CSS(막대 숨김)·클릭 분기에 사용.
const UNDATED_ID_PREFIX = 'undated-'
// 그리드 시작일/기간 컬럼에서 "미정" 으로 표기할 행 — 미정 하위(undated) 또는 막대 없는 에픽 요약(nobar).
const isUndatedRow = (row: unknown): boolean => {
  const r = row as { undated?: boolean; nobar?: boolean }
  return !!r.undated || !!r.nobar
}

// 이슈 상태별 막대 색상 — IssueStatusIcon/IssueStatusBadge 와 동일한 시맨틱 토큰(hex 금지). CANCELED 는 「취소」 상태 필터일 때만
// 막대로 온다(WP-247) — 흐린 회색.
const STATUS_BAR_COLOR: Record<IssueStatus, string> = {
  TODO: 'var(--muted-foreground)',
  IN_PROGRESS: 'var(--primary)',
  DONE: 'var(--success)',
  CANCELED: 'color-mix(in oklab, var(--muted-foreground) 55%, transparent)',
}

// 에픽 요약 막대에 주입하는 얇은 막대 CSS 변수(WP-249) — timeline-gantt.css 의 ::after 가 읽는다. 값이 없으면 모두 제거.
const ROLLUP_VARS = ['--rollup-left', '--rollup-width', '--rollup-in-start', '--rollup-in-end'] as const
const NO_ROLLUP_VALUES = ROLLUP_VARS.map(() => '')

// 주 보기 위쪽 행은 주 경계에 맞춘 달(WP-605) — SVAR 기본 'month' 는 달 경계 주를 양쪽 달에 두 번 세어 축이 길수록
// 아래쪽 주 칸보다 밀린다. 단위는 모듈 로드 때 한 번 등록한다(같은 이름 재등록은 덮어쓰기라 HMR 에도 안전).
/** 걸어 둔 차트 스크롤 — 걸 날짜(건 뒤 비운다)와 예약한 프레임. */
/**
 * 스크롤 요청 — 날짜만 넘기면 같은 날짜를 다시 요청할 때(「전체」 기간에서 처음 진입 날짜 = 「오늘」, 「오늘」 두 번) 상태가
 * 바뀌지 않아 효과가 다시 돌지 않았다(WP-938). 요청마다 seq 를 올린 새 객체로 넘겨 매번 스크롤하게 한다.
 */
export interface TimelineScrollRequest {
  date: string
  seq: number
}

interface PendingScroll {
  date: string | null
  frame: number
}

/**
 * 한 프레임 뒤 scroll-chart 를 건다(이미 예약한 프레임은 취소). 그때 api 가 아직 없으면 날짜를 남겨 둔다 —
 * api 가 붙을 때(Gantt ref) 다시 부른다. 효과·ref 콜백 두 곳에서 부르므로 refs 만 읽는 모듈 함수로 둔다(의존성 없음).
 */
function applyScroll(pending: PendingScroll, apiRef: RefObject<IApi | null>) {
  cancelAnimationFrame(pending.frame)
  pending.frame = requestAnimationFrame(() => {
    const api = apiRef.current
    if (!pending.date || !api) return
    api.exec('scroll-chart', { date: parseISO(pending.date) })
    pending.date = null
  })
}

const WEEK_MONTH_UNIT = 'weekmonth'
registerScaleUnit(WEEK_MONTH_UNIT, {
  start: weekMonthStart,
  end: weekMonthEnd,
  isSame: (a, b) => weekMonthOf(a).getTime() === weekMonthOf(b).getTime(),
  add: weekMonthAdd,
  diff: weekMonthDiff,
  smallerCount: { week: weeksInWeekMonth, day: (date: Date) => weeksInWeekMonth(date) * 7 },
})

const WEEK_SCALES: IScaleConfig[] = [
  { unit: WEEK_MONTH_UNIT, step: 1, format: (date) => format(weekMonthOf(date), 'yyyy년 M월') },
  { unit: 'week', step: 1, format: (date) => format(date, "'W'w") },
]

// 일 보기(WP-889) — 위 행은 달, 아래 행은 날짜·요일. 일은 달 안에 딱 맞게 나뉘어 주 보기처럼 칸이 밀리지 않는다.
const DAY_SCALES: IScaleConfig[] = [
  { unit: 'month', step: 1, format: (date) => format(date, 'yyyy년 M월') },
  { unit: 'day', step: 1, format: dayCellLabel },
]

// 일 보기 칸 폭 — 「25 토」 라벨(12px)이 잘리지 않는 최소 폭. 주·월은 SVAR 기본 폭을 그대로 쓴다.
const DAY_CELL_WIDTH = 44

const MONTH_SCALES: IScaleConfig[] = [
  { unit: 'year', step: 1, format: (date) => format(date, 'yyyy년') },
  { unit: 'month', step: 1, format: (date) => format(date, 'M월') },
]

const SCALES_BY_ZOOM: Record<TimelineZoom, IScaleConfig[]> = {
  day: DAY_SCALES,
  week: WEEK_SCALES,
  month: MONTH_SCALES,
}

// SVAR 기본 그리드 컬럼 헤더가 영문(Task name/Start date/Duration)이라 앱 전체 한국어 UI와
// 어긋남 — id/width 는 SVAR 기본값(getDefaultColumns)을 유지하고 header 텍스트만 교체한다.
const GRID_COLUMNS: IColumnConfig[] = [
  // 240 — 취소 에픽에서 옮겨진 이슈의 「← 원래 에픽」 접미사가 잘리지 않게(WP-247 UI 리뷰).
  { id: 'text', header: '이슈', width: 240, flexgrow: 1, sort: true },
  // 미정 행(날짜 없는 하위/막대 없는 에픽)은 시작일/기간 대신 "미정" 표기. template 을 주면 SVAR
  // 기본 포매터(start=%d-%m-%Y) 대신 이 함수가 쓰인다. 날짜는 다른 목록과 같은 연-월-일(WP-633) — SVAR 기본
  // 일-월-연(「11-10-2026」)은 11월 10일로 읽히기 쉬웠다.
  {
    id: 'start',
    header: '시작일',
    width: 120,
    align: 'center',
    sort: true,
    // 시작일만 있는 미정 하위는 「미정」 대신 실제 시작일을 보인다(WP-484) — 막대·기간은 여전히 없다(마감일 기준 일정).
    template: (value: Date, row: ITask) => {
      if (!isUndatedRow(row)) return value ? formatDateKey(value) : ''
      const undatedStart = (row as { undatedStart?: string | null }).undatedStart
      return undatedStart ? formatDateKey(parseISO(undatedStart)) : '미정'
    },
  },
  {
    id: 'duration',
    header: '기간',
    width: 100,
    align: 'center',
    sort: true,
    // 기간은 일 단위 — 숫자만 보이면 며칠인지 알기 어려웠다(WP-633)
    template: (value: number, row: ITask) => (isUndatedRow(row) || value == null ? '' : `${value}일`),
  },
]

/**
 * TimelineBar/Milestone/Cycle/Dependency 데이터 모델을 SVAR React Gantt 의
 * task/link 스키마로 변환해 렌더링하는 어댑터. 페이지 쪽은 SVAR 내부 API를
 * 전혀 알 필요 없이 이 컴포넌트의 props 만 소비한다.
 */
export function TimelineGantt({
  groups,
  expandedKeys,
  onToggleGroup,
  milestones,
  cycles,
  dependencies,
  zoom,
  readOnly,
  scrollRequest,
  period,
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

  // 에픽 막대 아래 얇은 막대(하위 실제 범위, WP-249) — 요약 막대 id → ROLLUP_VARS 순서의 CSS 값(%)을 미리 만든다.
  // rollup 은 range 가 에픽 자체 기간일 때만 있으므로 range 도 항상 있다.
  const rollupValuesByTaskId = useMemo(
    () =>
      new Map(
        groups.flatMap((g) => {
          if (!g.range || !g.rollup) return []
          const o = rollupOverlay(g.range, g.rollup)
          return [[groupTaskId(g.key), [o.left, o.width, o.inStart, o.inEnd].map((v) => `${v}%`)] as const]
        }),
      ),
    [groups],
  )

  // 요약 막대 id → 종료 상태(WP-247). 진행 중 에픽은 넣지 않아 속성이 없다.
  const epicStatusByTaskId = useMemo(
    () => new Map(groups.flatMap((g) => (g.status === 'DONE' || g.status === 'CANCELED' ? [[groupTaskId(g.key), g.status] as const] : []))),
    [groups],
  )

  // 막대 저장 실패 횟수 — 그룹 행에 실어 SVAR 가 tasks 를 다시 파싱하게 한다(WP-248). SVAR init 은 새 tasks 를
  // 이전 값과 깊은 비교해 같으면 무시하므로, 실패 후 재조회 응답이 이전과 같으면 드래그로 옮겨진 막대(와 하위 기준으로
  // 재계산된 에픽 요약 막대)가 그대로 남는다.
  const [saveFailures, setSaveFailures] = useState(0)

  const tasks = useMemo<ITask[]>(() => {
    // SVAR 는 bar 엘리먼트에 task 필드 기반 커스텀 className 주입 API 가 없음(고정 `wx-bar wx-${type}`,
    // 스파이크 노트 참조) — 상태별 색상은 아래 이펙트에서 DOM에 직접 CSS 변수를 주입해 구현한다(#639).
    // 마일스톤은 더 이상 SVAR task 로 렌더되지 않는다(#648) — 이슈 행을 차지하지 않도록 상단 고정
    // 레인(칩)+세로 점선 오버레이로 완전히 분리했다.
    // 에픽 그룹 트리(#649) — 그룹 행(summary) + 자식 행(task, parent 연결)을 순서대로 쌓는다.
    const expanded = new Set(expandedKeys)
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
      // 그룹은 항상 summary 로 렌더(완료·취소 에픽 식별 위해 wx-summary 클래스 필요, WP-247).
      // 자식이 없는 그룹은 open 필드를 넣지 않음(#656 가드) — 완료/취소 에픽은 색칠되지만 펼칠 수 없다.
      const hasChildren = group.bars.length > 0 || group.undatedChildren.length > 0
      // range 가 null 이면 그릴 에픽 막대가 없다 — id 에 '-nobar' 를 붙여 정적 CSS 로 막대만 숨긴다.
      const noBar = group.range === null
      const summaryId = noBar ? `${groupId}-nobar` : groupId
      // 진행률은 텍스트로 병기 — SVAR 그리드 셀 커스텀 렌더 미지원 전제의 안전한 표현.
      // 에픽 없음 그룹(epicNumber === null)은 진행률 대신 최상위 이슈(막대) 개수를 병기한다.
      const baseText =
        group.epicNumber === null
          ? `${group.title} (${group.bars.length})`
          : group.total > 0
            ? `${group.title} (${group.done}/${group.total})`
            : group.title
      // 완료·취소 에픽은 그리드에 상태를 병기한다(WP-247) — 진행률과 같은 이유로 text 에 싣는다(셀 커스텀 렌더 미사용).
      const statusSuffix = group.status === 'DONE' ? ' · 완료' : group.status === 'CANCELED' ? ' · 취소' : ''
      result.push({
        id: summaryId,
        text: baseText + statusSuffix,
        // no-epic 도 range 를 롤업해 받으므로(#662) 그리드 시작일/기간 컬럼엔 항상 실제 값이 뜬다.
        // 그래도 range 자체가 비는 케이스(막대 없는 에픽)를 위해 group.bars[0]?.due 폴백은 유지 (SVAR 는 start 필수).
        start: parseISO(fallbackDate),
        end: addDays(parseISO(fallbackDue), 1),
        type: 'summary',
        ...(hasChildren ? { open: expanded.has(group.key) } : {}),
        ...(noBar ? { nobar: true } : {}), // 시작일/기간 컬럼 "미정" 표기용 마커
        saveFailures, // 위 saveFailures 참조 — 그룹 행에만 실어도 깊은 비교가 깨진다
      })
      // 미정 하위(#에픽펼침) — 에픽 아래 그리드 행으로만 보이고 간트 막대는 CSS 로 숨긴다.
      // unscheduled:true 로 두어 에픽 요약 막대 span 계산에서 제외한다(placeholder 날짜가 span 을 늘리지 않게).
      for (const kid of group.undatedChildren) {
        result.push({
          id: `${UNDATED_ID_PREFIX}${kid.number}`,
          parent: summaryId,
          text: `${kid.projectKey}-${kid.number} ${kid.title}`,
          start: parseISO(fallbackDate),
          end: addDays(parseISO(fallbackDate), 1),
          type: 'task',
          unscheduled: true,
          undated: true,
          undatedStart: kid.startDate, // 시작일 컬럼 표기용(WP-484) — 막대 날짜(start)는 placeholder 라 쓰지 않는다
          issueNumber: kid.number,
        })
      }
      for (const bar of group.bars) {
        const startDate = bar.start ? parseISO(bar.start) : parseISO(bar.due)
        const endDate = addDays(parseISO(bar.due), 1)
        result.push({
          id: bar.issueNumber,
          parent: groupId,
          text: `${bar.issueKey} ${bar.title}${bar.formerEpicTitle ? ` ← ${bar.formerEpicTitle}` : ''}`,
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
  }, [groups, expandedKeys, saveFailures])

  // 이슈번호 → 마감일 맵 — 의존성 모순(#669) 판정에 사용. bars 는 이미 화면에 렌더되는 이슈만 담고
  // 있으므로 별도 조회 없이 여기서 파생한다.
  const dueDateByIssueNumber = useMemo(() => {
    const map = new Map<number, string>()
    for (const bar of bars) map.set(bar.issueNumber, bar.due)
    return map
  }, [bars])

  // 간트 축 범위(WP-595) — 막대가 조회 기간 앞뒤로 크게 넘으면(예: 1900~2099) 축을 그 안으로 자른다. 넘지 않으면 undefined 라
  // SVAR 자동 범위(autoScale)를 그대로 쓴다. 200년 축에서는 처음 열 때도 「오늘」을 눌러도 엉뚱한 해가 보였다.
  const periodFrom = period?.from
  const periodTo = period?.to
  const axis = useMemo(() => {
    let min: Date | null = null
    let max: Date | null = null
    for (const t of tasks) {
      if (t.start && (!min || t.start < min)) min = t.start
      if (t.end && (!max || t.end > max)) max = t.end
    }
    const range = periodFrom && periodTo ? { from: periodFrom, to: periodTo } : null
    return ganttAxisBounds(min, max, range, new Date())
  }, [tasks, periodFrom, periodTo])

  const links = useMemo(
    () =>
      dependencies.map((edge, index) => {
        const predecessorDue = dueDateByIssueNumber.get(edge.fromIssueNumber)
        const successorDue = dueDateByIssueNumber.get(edge.toIssueNumber)
        // 후행 마감일 < 선행 마감일 — 의존성 순서와 실제 일정이 모순되는 링크(#669, soft 시각 경고).
        // 완료 여부는 보지 않는다(결정 코멘트: 타임라인 축은 날짜 비교만).
        const contradictory = !!(predecessorDue && successorDue && successorDue < predecessorDue)
        return {
          id: `dep-${edge.fromIssueNumber}-${edge.toIssueNumber}-${index}`,
          source: edge.fromIssueNumber,
          target: edge.toIssueNumber,
          // 이 앱의 유일한 의존성 유형은 "선행 필요"(finish-to-start) — 선행 이슈가 끝나야
          // 후행 이슈가 시작 가능하다는 의미이므로 화살표는 e2s(end-to-start)여야 한다(#671).
          type: 'e2s' as const,
          contradictory,
        }
      }),
    [dependencies, dueDateByIssueNumber],
  )

  // 사이클 구간에 속한 날짜는 highlightTime 이 반환하는 CSS 클래스로 셀 배경을 물들인다.
  const highlightTime = useMemo(() => {
    const bands = cycles.map((cycle) => ({
      start: parseISO(cycle.startDate).getTime(),
      end: parseISO(cycle.endDate).getTime(),
    }))
    // SVAR 는 일 단위 칸마다 부른다(일 보기에서만 칸이 하루) — 일 보기에서는 주말 음영(WP-889)도 함께 단다.
    const shadeWeekends = zoom === 'day'
    return (date: Date) => {
      const time = date.getTime()
      const classes: string[] = []
      if (bands.some((band) => time >= band.start && time < band.end)) classes.push('timeline-cycle-band')
      if (shadeWeekends && isWeekend(date)) classes.push('timeline-weekend')
      return classes.join(' ')
    }
  }, [cycles, zoom])

  const scales = SCALES_BY_ZOOM[zoom]
  // SVAR 는 <Willow>/<WillowDark> 테마 래퍼가 있어야 CSS 변수(막대 배경·보더·마일스톤 다이아몬드 등)가
  // 채워진다 — 래퍼 없이 렌더하면 막대가 투명해져 텍스트만 남는다. 앱 폰트 스택 유지 위해 fonts=false.
  const { resolvedTheme } = useTheme()
  const ThemeWrapper = resolvedTheme === 'dark' ? WillowDark : Willow

  // scroll-chart 는 한 프레임 미뤄 부른다 — 간트가 처음 마운트되는 그 커밋에서 바로 부르면 SVAR 가 차트 폭을 재기 전이라
  // 시간축 눈금·의존 화살표가 그려지지 않았다. 상태 목록 관문(WP-938) 뒤에 마운트되면 날짜가 이미 정해진 채 첫 커밋을 맞는다.
  // 그 프레임에 아직 api 가 붙지 않았으면 날짜를 남겨 두었다가 api 가 붙을 때(아래 Gantt ref) 다시 건다(applyScroll).
  const scrollRef = useRef<PendingScroll>({ date: null, frame: 0 })
  useEffect(() => {
    if (!scrollRequest) return
    const pending = scrollRef.current
    pending.date = scrollRequest.date
    applyScroll(pending, apiRef)
    return () => cancelAnimationFrame(pending.frame)
  }, [scrollRequest])

  // 보기 단위를 바꾸면 보던 날짜를 그대로 둔다(WP-889) — SVAR 는 가로 스크롤 px 만 남겨, 칸이 넓은 일 보기로 바꾸면
  // 몇 달 뒤가, 월 보기로 바꾸면 축 끝이 보였다. 바꾸기 직전 차트 가운데 날짜(viewCenterRef — 아래 오버레이 효과가 스크롤마다
  // 갱신)를 새 축에서도 가운데에 둔다. 왼쪽 끝 날짜로 맞추면 좁은 화면에서 주→일로 바꿀 때 보던 날짜가 오른쪽 밖으로 밀렸다.
  // 이 효과는 오버레이 효과보다 먼저 선언돼야 새 축으로 viewCenterRef 가 덮이기 전에 읽는다. 새 축은 SVAR 가 다음 프레임에 잰다.
  const viewCenterRef = useRef<number | null>(null)
  const prevZoomRef = useRef(zoom)
  useEffect(() => {
    if (prevZoomRef.current === zoom) return
    prevZoomRef.current = zoom
    const center = viewCenterRef.current
    if (center == null) return
    const frame = requestAnimationFrame(() => {
      const api = apiRef.current
      const chartScales = api?.getState()._scales
      const scroller = containerRef.current?.querySelector<HTMLElement>('.wx-chart')
      if (!api || !chartScales || !scroller) return
      const msPerPixel = (chartScales.end.getTime() - chartScales.start.getTime()) / chartScales.width
      const left = (center - chartScales.start.getTime()) / msPerPixel - scroller.clientWidth / 2
      // DOM scrollLeft 를 직접 바꾸면 SVAR 가 자기 상태의 scrollLeft 로 다시 덮는다 — 액션으로 상태째 옮긴다(축 끝에서는 SVAR 가 자른다).
      api.exec('scroll-chart', { left: Math.max(0, Math.min(left, chartScales.width - scroller.clientWidth)) })
    })
    return () => cancelAnimationFrame(frame)
  }, [zoom])

  // 오늘 세로선 + 사이클 밴드 라벨 오버레이 — 스파이크 노트대로 `.wx-chart`(실 스크롤 컨테이너) 의
  // scroll 이벤트에서 순수 DOM transform 갱신(리액트 리렌더 없이 동기화, 성능 고려).
  useEffect(() => {
    const container = containerRef.current
    const api = apiRef.current
    if (!container || !api) return
    const scroller = container.querySelector<HTMLElement>('.wx-chart')
    if (!scroller) return

    let todayLeft = 0
    // 차트 가운데 날짜 계산용 — recompute 가 새 축으로 채운다.
    let axisStart = 0
    let axisMsPerPixel = 0
    // 차트 영역 왼쪽 끝(containerRef 기준) — 사이클 이름표를 이보다 왼쪽(그리드 표 위)에 그리지 않는다(WP-489).
    let chartLeft = 0
    const bandLefts = new Map<number, { left: number; width: number }>()
    // 마일스톤 오버레이 좌표(#648) — 마감일 오름차순으로 마감일 정확한 X 와 칩 폭을 둔다. vline 은 늘 이 X,
    // 칩은 스크롤 뒤 겹치거나 차트 왼쪽에 걸리면 우측으로 밀어 배치한다(applyTransform).
    const milestoneLayout: { id: number; x: number; width: number }[] = []

    const recompute = () => {
      const chartScales = api.getState()._scales
      if (!chartScales) return
      const msPerPixel = (chartScales.end.getTime() - chartScales.start.getTime()) / chartScales.width
      const toOffset = (date: Date) => (date.getTime() - chartScales.start.getTime()) / msPerPixel
      axisStart = chartScales.start.getTime()
      axisMsPerPixel = msPerPixel
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
      // 기간이 겹치는 사이클은 이름표 줄을 나눈다(WP-489) — 시작일 순으로 훑어, 앞 줄의 마지막 사이클이 끝난 뒤에
      // 시작하면 그 줄에, 아니면 새 줄에 둔다. 날짜 기준이라 스크롤과 무관하다.
      const laneEnds: string[] = []
      for (const band of [...cycles].sort((a, b) => a.startDate.localeCompare(b.startDate))) {
        let lane = laneEnds.findIndex((end) => end < band.startDate)
        if (lane < 0) lane = laneEnds.length
        laneEnds[lane] = band.endDate
        const el = cycleBandLabelRefs.current.get(band.id)
        if (el) el.style.top = `${baseTop + lane * CYCLE_LABEL_LANE_PX}px`
      }
      chartLeft = baseLeft
      todayLeft = baseLeft + toOffset(new Date())
      bandLefts.clear()
      for (const band of cycles) {
        const left = baseLeft + toOffset(parseISO(band.startDate))
        const width = baseLeft + toOffset(parseISO(band.endDate)) - left
        bandLefts.set(band.id, { left, width })
      }
      milestoneLayout.length = 0
      for (const m of [...milestones].sort((a, b) => a.dueDate.localeCompare(b.dueDate))) {
        const width = milestoneChipRefs.current.get(m.id)?.offsetWidth ?? 0
        milestoneLayout.push({ id: m.id, x: baseLeft + toOffset(parseISO(m.dueDate)), width })
      }
      applyTransform()
    }

    const applyTransform = () => {
      const scrollLeft = scroller.scrollLeft
      if (axisMsPerPixel > 0) viewCenterRef.current = axisStart + (scrollLeft + scroller.clientWidth / 2) * axisMsPerPixel
      if (todayLineRef.current) {
        todayLineRef.current.style.transform = `translateX(${todayLeft - scrollLeft}px)`
      }
      for (const [id, { left, width }] of bandLefts) {
        const el = cycleBandLabelRefs.current.get(id)
        if (!el) continue
        // 차트 왼쪽 밖으로 스크롤된 부분은 잘라 낸다 — 이름표는 차트 왼쪽 끝에 붙고, 다 지나가면 숨긴다(WP-489).
        const start = left - scrollLeft
        const visibleLeft = Math.max(start, chartLeft)
        const visibleWidth = start + width - visibleLeft
        el.style.visibility = visibleWidth > 0 ? '' : 'hidden'
        el.style.transform = `translateX(${visibleLeft}px)`
        el.style.width = `${Math.max(visibleWidth, 0)}px`
      }
      // 마일스톤은 사이클 이름표처럼 차트 영역 안에만 그린다(WP-861) — 마감일이 차트 왼쪽 밖으로 스크롤되면
      // 칩·점선을 숨겨 왼쪽 그리드 표 위에 겹치지 않게 하고, 마감일은 보이는데 칩만 걸치면 차트 왼쪽 끝에 붙인다.
      // 좌측 "마일스톤" 라벨 예약 폭보다 왼쪽으로도 밀리지 않는다(그리드가 좁을 때).
      const minChipLeft = Math.max(chartLeft, MILESTONE_LABEL_RESERVED_PX)
      // 마감일 오름차순으로 훑으며 직전 칩과 겹치면 그 우측 +4px 로 밀어 배치(간단한 충돌 회피).
      let prevRight = -Infinity
      for (const { id, x, width } of milestoneLayout) {
        const lineX = x - scrollLeft
        const visible = lineX >= chartLeft
        const vline = milestoneVlineRefs.current.get(id)
        if (vline) {
          vline.style.visibility = visible ? '' : 'hidden'
          vline.style.transform = `translateX(${lineX}px)`
        }
        const chip = milestoneChipRefs.current.get(id)
        if (!chip) continue
        chip.style.visibility = visible ? '' : 'hidden'
        if (!visible) continue
        const left = Math.max(lineX - width / 2, minChipLeft, prevRight + 4)
        chip.style.transform = `translateX(${left}px)`
        prevRight = left + width
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
        const color = STATUS_BAR_COLOR[bar.status]
        // data-task-id 는 이슈 번호와 정확히 일치해야 한다 — 이전의 접미사 매칭($=)은 번호 5 가
        // 번호 25(에픽 자식)의 접미사라 둘 다 매칭돼 querySelector 가 같은 막대를 반환, 서로 다른
        // 상태색을 번갈아 덮어쓰며 MutationObserver 무한 루프 → 렌더러 프리즈를 일으켰다(#649 회귀).
        // SVAR 는 숫자 task id 를 접두어 없이 그대로(문자열 id 만 ':' 접두) 렌더하므로 정확 매칭이 맞다.
        const el = container.querySelector<HTMLElement>(`.wx-bar[data-task-id="${bar.issueNumber}"]`)
        if (!el || el.style.getPropertyValue('--wx-gantt-task-color') === color) continue
        el.style.setProperty('--wx-gantt-task-color', color)
        el.style.setProperty('--wx-gantt-task-fill-color', color)
      }
      // 얇은 막대 변수(WP-249)도 같은 이유로 여기서 재적용한다. 요약 막대 전부를 돌며 값이 없어진 막대는 지운다 —
      // 에픽 막대 자체가 그대로면 SVAR 가 style 을 다시 쓰지 않아 옛 변수가 남는다. 다른 값만 써서 옵저버 루프를 막는다.
      // SVAR 는 문자열 id 에 ':' 접두를 붙여 렌더하므로 떼고 정확 매칭한다(접미사 매칭은 #649 회귀 전례).
      for (const el of container.querySelectorAll<HTMLElement>('.wx-bar.wx-summary')) {
        const id = (el.dataset.taskId ?? '').replace(/^:/, '')
        const values = rollupValuesByTaskId.get(id) ?? NO_ROLLUP_VALUES
        ROLLUP_VARS.forEach((name, i) => {
          if (el.style.getPropertyValue(name) === values[i]) return
          if (values[i]) el.style.setProperty(name, values[i])
          else el.style.removeProperty(name)
        })
        // 완료·취소 에픽 표시(WP-247) — 색은 CSS 가 data-epic-status 로 칠한다. 값이 같으면 건드리지 않아 옵저버 루프를 막는다.
        const status = epicStatusByTaskId.get(id) ?? null
        if ((el.dataset.epicStatus ?? null) !== status) {
          if (status) el.dataset.epicStatus = status
          else delete el.dataset.epicStatus
        }
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
  }, [bars, tasks, rollupValuesByTaskId, epicStatusByTaskId])

  // 의존성 모순 링크 강조(#669) — SVAR 는 링크별 커스텀 className/color 주입 API 가 없어(바 색상과
  // 동일한 제약, 위 STATUS_BAR_COLOR 이펙트 참조) `data-link-id` 를 가진 <g> 안의 `.wx-line-draw`
  // 스트로크를 destructive 시맨틱 토큰으로 직접 덮어쓴다. SVAR 재렌더가 style 을 씻어내므로
  // MutationObserver 로 재적용.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const applyLinkColors = () => {
      for (const link of links) {
        // SVAR 는 문자열 id 에 내부적으로 ':' 접두를 붙여 렌더한다(setID, 스파이크 노트 미기재 —
        // #669 구현 중 실측). link.id 는 `dep-{from}-{to}-{index}` 형태로 항목마다 유일해
        // 접미(ends-with) 매칭으로 접두사 유무와 무관하게 안전하게 식별 가능하다.
        const el = container.querySelector<SVGPolylineElement>(
          `g[data-link-id$="${link.id}"] polyline.wx-line-draw`,
        )
        if (!el) continue
        const color = link.contradictory ? 'var(--destructive)' : ''
        if (el.style.stroke === color) continue
        el.style.stroke = color
      }
    }
    applyLinkColors()
    const observer = new MutationObserver(applyLinkColors)
    observer.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    })
    return () => observer.disconnect()
  }, [links])

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
                  if (isGroupTaskId(ev.id)) onToggleGroupRef.current(groupKeyFromTaskId(ev.id), ev.mode)
                })
                // 첫 진입 스크롤이 api 보다 먼저 와 남아 있으면 이제 건다(applyScroll).
                if (scrollRef.current.date) applyScroll(scrollRef.current, apiRef)
              }
              if (!api) apiRef.current = null
            }}
            tasks={tasks}
            links={links}
            scales={scales}
            // 일 보기만 칸 폭을 정한다 — 주·월은 SVAR 기본 폭(지금까지의 모양)을 그대로 둔다.
            {...(zoom === 'day' ? { cellWidth: DAY_CELL_WIDTH } : {})}
            // 축을 자를 때만 고정 범위(autoScale 끔) — SVAR 는 start·end 가 둘 다 있고 autoScale 이 꺼져야 그 범위를 쓴다.
            {...(axis ? { start: axis.start, end: axis.end, autoScale: false } : {})}
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
                }).catch(() => setSaveFailures((n) => n + 1)) // 에러 안내는 호출부(mutation) 몫
              }
            }}
            onSelectTask={(ev) => {
              // 그룹(에픽) 행 클릭 = 에픽 이슈 상세로 이동. no-epic 가상 그룹은 이동 대상이 없어 무시.
              if (!ev.id) return
              if (isGroupTaskId(ev.id)) {
                const key = groupKeyFromTaskId(ev.id)
                const group = groups.find((g) => g.key === key)
                if (group?.epicNumber != null) onBarClick(group.epicNumber)
                return
              }
              // 미정 하위 행(undated-{번호}) 클릭 → 해당 이슈 상세로 이동.
              if (typeof ev.id === 'string' && ev.id.startsWith(UNDATED_ID_PREFIX)) {
                onBarClick(Number(ev.id.slice(UNDATED_ID_PREFIX.length)))
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
