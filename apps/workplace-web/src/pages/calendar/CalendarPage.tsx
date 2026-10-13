import { addDays, addMonths, format, isSameMonth, startOfDay, startOfMonth } from 'date-fns'
import { ChevronDown } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { useRegisterAiScreenContext } from '@/components/ai/screen-context/useAiScreenContext'
import { CalendarEditDialog } from '@/components/calendar/CalendarEditDialog'
import { CalendarSidebar } from '@/components/calendar/CalendarSidebar'
import { EventDialog } from '@/components/calendar/EventDialog'
import { MobileMiniCalendarPanel } from '@/components/calendar/MobileMiniCalendarPanel'
import { RecurrenceScopeDialog } from '@/components/calendar/RecurrenceScopeDialog'
import { AgendaView } from '@/components/calendar/views/AgendaView'
import { MobileAgendaView } from '@/components/calendar/views/MobileAgendaView'
import { MonthView } from '@/components/calendar/views/MonthView'
import { DayView, WeekView } from '@/components/calendar/views/WeekView'
import { Page } from '@/components/layout/Page'
import { MobileSidebarSheet } from '@/components/mobile/MobileSidebarSheet'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { useAgendaChunks } from '@/hooks/queries/useAgendaChunks'
import { useCalendarEvent, useCalendarEvents } from '@/hooks/queries/useCalendarEvents'
import {
  useCreateEvent,
  useDeleteEvent,
  useUpdateEvent,
} from '@/hooks/queries/useCalendarMutations'
import { useCalendars, useCreateCalendar, useDeleteCalendar, useResetCalendarEvents, useUpdateCalendar } from '@/hooks/queries/useCalendars'
import { useMyIssueDues } from '@/hooks/queries/useMyIssueDues'
import { useHistoryParam } from '@/hooks/useHistoryParam'
import { useHorizontalSwipe } from '@/hooks/useHorizontalSwipe'
import { getIsMobile, useIsMobile } from '@/hooks/useIsMobile'
import { useMinuteNow } from '@/hooks/useMinuteNow'
import { useResetOnChange } from '@/hooks/useResetOnChange'
import { buildCalendarContext } from '@/lib/aiScreenContext/builders/calendar'
import {
  CALENDAR_VIEWS,
  type CalendarLayers,
  eventsOnDay,
  isCalendarVisible,
  issueDuesOnDay,
  loadLayers,
  monthMatrix,
  saveLayers,
  toggleCalendar,
  visibleRange,
} from '@/lib/calendar'
import { headerMonthLabel } from '@/lib/calendarAgenda'
import { parseId } from '@/lib/historyParam'
import { cn } from '@/lib/utils'
import type {
  Calendar,
  CalendarEvent,
  CalendarEventRequest,
  CalendarRequest,
  CalendarViewType,
  EditScope,
  IssueDueMarker,
} from '@/types/calendar'


// 월·주·일 보기 컴포넌트 — 목록(agenda)은 모바일·데스크톱이 따로 그린다.
const GRID_VIEWS = { month: MonthView, week: WeekView, day: DayView }

/** 캘린더 페이지 — 뷰 전환·날짜 네비·일정 CRUD + 캘린더 컨테이너 CRUD + 필터를 통합 관리. */
export function CalendarPage() {
  const navigate = useNavigate()
  const location = useLocation()
  // 일정 상세 = URL ?eventId(상태의 단일 원천, WP-208). 일정 클릭은 push → 시스템 뒤로가기가 다이얼로그만 닫는다.
  // 알림·홈 딥링크(#659)와 같은 키 — 예전처럼 소비 후 replace 로 지우지 않는다(뒤로가기·forward 가 다이얼로그를 여닫는다).
  const [searchParams, setSearchParams] = useSearchParams()
  const eventParam = useHistoryParam('eventId')
  const eventIdParam = parseId(eventParam.value)
  // 새 일정 딥링크(?new=true) — 홈 대시보드 "오늘 일정" 위젯 빈 상태 CTA(#653) 등에서 진입.
  const deepLinkNew = searchParams.get('new') === 'true'
  // 첫 보기 — 모바일은 일정 목록(WP-136: 월 칩이 두세 글자로 잘려 읽히지 않음), 데스크톱은 월. 마운트 때 한 번만 정한다(isMobile 선언 전이라 동기 판정).
  const [view, setView] = useState<CalendarViewType>(() => (getIsMobile() ? 'agenda' : 'month'))
  // 모바일(<lg): 오늘/‹/› 와 뷰 전환(단일 select)을 헤더 아래 도구 줄로 내린다(U2-5) — 390px 헤더에선 제목이 잘린다.
  const isMobile = useIsMobile()
  // 모바일 이동 버튼 — 44×44 터치 타깃. 데스크톱은 기본 크기(sm) 그대로.
  const navBtnClass = isMobile ? 'h-11 min-w-11 px-3' : undefined
  const arrowBtnClass = isMobile ? 'h-11 w-11 px-0 text-lg' : undefined
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()))
  // 모바일 목록 보기 = 일정 목록(MobileAgendaView, 무한 불러오기). 데스크톱 목록은 기존 AgendaView 그대로.
  const mobileAgenda = isMobile && view === 'agenda'
  // 지금 시각 — 목록은 지금 선·흐림 때문에 분 단위, 다른 모바일 보기는 헤더 연도 라벨만 쓰므로 날짜 단위(새해 경계 갱신), 데스크톱은 멈춤.
  const { now, resumeCount } = useMinuteNow(mobileAgenda ? 'minute' : isMobile ? 'day' : null)
  const todayKey = startOfDay(now).getTime()
  // 자정 따라가기(아래 렌더 중 판정) 기록 — 마지막으로 확인한 오늘·화면 복귀 횟수, 스크롤 중이라 따라가지 않고 남긴 (지난) 오늘(stale).
  const [follow, setFollow] = useState<{ todayKey: number; resumeCount: number; stale: number | null }>({
    todayKey,
    resumeCount,
    stale: null,
  })
  // 모바일 헤더 미니 달력(WP-136) — 펼침 여부와 패널이 보여 주는 달(패널 안 ‹ › 는 본문 anchor 를 움직이지 않는다).
  const [miniOpen, setMiniOpen] = useState(false)
  // 패널을 닫을 때 포커스를 돌려줄 제목 버튼 — 날짜 선택·Esc 로 패널이 사라져도 포커스가 body 로 빠지지 않게.
  const titleToggleRef = useRef<HTMLButtonElement>(null)
  // 새 일정 다이얼로그는 로컬 상태(?new 는 이번 범위 밖). 기존 일정은 URL 이 열림을 정한다.
  const [creating, setCreating] = useState(false)
  // 마지막으로 연 일정 스냅숏 — 반복 회차는 마스터 id 를 공유해 URL(eventId)만으로는 회차 날짜를 알 수 없다.
  // 다이얼로그가 닫힌 뒤에도 남겨 두어 범위 선택·삭제 확인 다이얼로그가 읽는다.
  const [editing, setEditing] = useState<CalendarEvent | null>(null)
  // 2단계 다이얼로그(삭제 확인·반복 범위 선택) 동안 EventDialog 만 숨기는 표식 — 그 일정 id.
  // 히스토리는 건드리지 않는다: 바깥(알림·홈)에서 열린 일정은 마크가 없어 닫기가 -1 로 캘린더를 떠나고,
  // 페이지가 언마운트되면 확인 다이얼로그가 뜨지 못해 삭제·수정이 유실된다. 닫기는 2단계가 성공한 뒤에만.
  const [suspendedId, setSuspendedId] = useState<number | null>(null)
  // URL 이 다른 일정·닫힘으로 바뀌면 표식을 푼다(렌더 중 조정) — forward 로 같은 일정에 돌아와도 다시 열린다.
  if (suspendedId != null && suspendedId !== eventIdParam) setSuspendedId(null)
  const dialogOpen =
    creating || (eventIdParam != null && editing?.id === eventIdParam && suspendedId !== eventIdParam)
  const [defaultStart, setDefaultStart] = useState<Date | undefined>()
  // 반복 회차 수정/삭제 시 scope 선택 다이얼로그 모드(null=닫힘)
  const [scopeMode, setScopeMode] = useState<'edit' | 'delete' | null>(null)
  // scope 선택 전까지 보류하는 수정 body
  const [pendingBody, setPendingBody] = useState<CalendarEventRequest | null>(null)
  // 단일 일정 삭제 확인 다이얼로그 표시 여부
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)

  // 캘린더 컨테이너 CRUD 다이얼로그 상태.
  const [calEditOpen, setCalEditOpen] = useState(false)
  const [editingCal, setEditingCal] = useState<Calendar | null>(null)

  // 사이드바 표시 레이어 토글 — localStorage 에서 초기화.
  const [layers, setLayers] = useState<CalendarLayers>(loadLayers)

  // 내 캘린더 목록.
  const { data: calendars = [] } = useCalendars()
  // 내 캘린더 id 집합 — filterByCalendar 에서 "내 캘린더인지" 판별.
  const myCalendarIds = useMemo(() => new Set(calendars.map((c) => c.id)), [calendars])

  const createCal = useCreateCalendar()
  const updateCal = useUpdateCalendar()
  const deleteCal = useDeleteCalendar()
  const resetCal = useResetCalendarEvents()
  // 리셋 확인 다이얼로그에 표시할 캘린더(null=닫힘).
  const [resettingCal, setResettingCal] = useState<Calendar | null>(null)

  // anchor·view 변경 시에만 from/to 재계산
  const { from, to } = useMemo(() => visibleRange(view, anchor), [view, anchor])
  // 모바일 목록은 청크 조회(useAgendaChunks)가 따로 하므로 본문 범위 조회를 끈다(일요일 시작 30일 범위를 헛되이 받지 않게).
  const { data: events = [], isSuccess: eventsLoaded } = useCalendarEvents(from, to, { enabled: !mobileAgenda })
  // 내게 할당된 이슈 마감일을 같은 가시 범위로 조회해 읽기전용 오버레이.
  const { data: issueDues = [] } = useMyIssueDues(from, to, { enabled: !mobileAgenda })

  // 캘린더 표시 토글 + 초대받은 일정 토글 존중.
  // 내 캘린더(myCalendarIds) 면 캘린더별 토글, 아니면 invited 토글.
  const filterByCalendar = useMemo(
    () => (e: CalendarEvent) =>
      myCalendarIds.has(e.calendarId) ? isCalendarVisible(layers, e.calendarId) : layers.invited,
    [myCalendarIds, layers],
  )

  const visibleEvents = useMemo(() => events.filter(filterByCalendar), [events, filterByCalendar])

  // 모바일 일정 목록 — anchor(기본 오늘)부터 30일 청크를 이어 조회. 목록 보기가 아니면 조회하지 않는다.
  const agenda = useAgendaChunks(anchor, {
    enabled: mobileAgenda,
    filter: filterByCalendar,
    showIssueDues: layers.issueDues,
  })
  // 모바일 헤더에 보일 달 — 목록 보기에선 맨 위 묶음의 날(새 목록이 알려 오기 전엔 anchor), 그 밖엔 anchor.
  const headerMonth = (mobileAgenda && agenda.topDay) || anchor

  // 패널 달 — 펼칠 때 헤더에 보이는 달부터, 펼친 채 anchor 가 바뀌면(스와이프·딥링크) 그 달로 따라간다.
  // anchor 가 바뀐 렌더에선 맨 위 날짜가 null 로 돌아가 headerMonth 가 곧 anchor 다.
  const [panelMonth, setPanelMonth] = useResetOnChange(`${anchor.getTime()}:${miniOpen}`, headerMonth)
  // 미니 캘린더는 한 달(6주 그리드)을 보여주므로, 본문 범위와 별개로 그 그리드 범위의 일정/마감을 조회한다(월 보기에선 본문과 같아 자동 dedup).
  // 데스크톱 사이드바는 anchor 의 달, 모바일 헤더 패널은 패널이 보여 주는 달 — 모바일은 패널이 펼쳐졌을 때만 조회한다(☰ 시트엔 미니 달력이 없다).
  const miniMonth = isMobile ? panelMonth : anchor
  const miniRange = useMemo(() => visibleRange('month', miniMonth), [miniMonth])
  const miniEnabled = !isMobile || miniOpen
  const { data: miniEvents = [] } = useCalendarEvents(miniRange.from, miniRange.to, { enabled: miniEnabled })
  const { data: miniDues = [] } = useMyIssueDues(miniRange.from, miniRange.to, { enabled: miniEnabled })

  // 자정 따라가기 — 목록 보기에서 오늘이 바뀌었거나 화면에 돌아왔을 때, (지난) 오늘부터 보던 목록이면 새 오늘로 옮긴다.
  // 첫 묶음 아래로 스크롤해 읽는 중이면 맨 위로 튀지 않게 그 날을 stale 로 남겼다가 화면 복귀 때 따라간다. 직접 고른 다른 날은 두고,
  // 목록 밖(월·주·일)에선 판정하지 않는다(목록에 들어올 때 판정). "맨 위가 첫 묶음" 으로 보는 이유: 지난 오늘에 일정이 없으면
  // 첫 묶음이 뒤 날짜라 "맨 위 = 지난 오늘" 로는 판정할 수 없다.
  if (mobileAgenda && (follow.todayKey !== todayKey || follow.resumeCount !== resumeCount)) {
    const anchorKey = anchor.getTime()
    const following = anchorKey !== todayKey && (anchorKey === follow.todayKey || anchorKey === follow.stale)
    const top = agenda.topDay
    const atListStart = top == null || agenda.days.length === 0 || top.getTime() === agenda.days[0].day.getTime()
    const move = following && (atListStart || follow.resumeCount !== resumeCount)
    if (move) setAnchor(new Date(todayKey))
    setFollow({ todayKey, resumeCount, stale: move ? null : following ? anchorKey : follow.stale })
  }

  // WP-54: 캘린더 화면 컨텍스트 — 보기·기간·일정 수 + 열린 일정(다이얼로그).
  // 일정 수는 조회 성공 후에만 싣는다(로딩 중 0건으로 오인 방지). 다이얼로그가 닫히면 editing 이 남아 있어도 focus 를 뺀다.
  const openEditing = dialogOpen && !creating ? editing : null
  // 모바일 목록 보기는 실제로 불러온 범위(첫 청크 시작 ~ 마지막 청크 끝)와 그 범위의 일정 수를 싣는다.
  // loadedRange 는 렌더마다 새 객체라 원시값으로 풀어 memo 의존성에 넣는다(안 그러면 매 렌더 컨텍스트를 다시 등록).
  const ctxFrom = mobileAgenda ? agenda.loadedRange.from : from
  const ctxTo = mobileAgenda ? agenda.loadedRange.to : to
  const ctxCount = mobileAgenda ? agenda.count : eventsLoaded ? visibleEvents.length : undefined
  const screenContext = useMemo(
    () =>
      buildCalendarContext({
        view,
        from: ctxFrom,
        to: ctxTo,
        count: ctxCount,
        creating,
        editing: openEditing
          ? {
              id: openEditing.id,
              masterEventId: openEditing.masterEventId ?? null,
              title: openEditing.title,
              startsAt: openEditing.startsAt,
              endsAt: openEditing.endsAt,
              allDay: openEditing.allDay,
              location: openEditing.location,
              calendarName: openEditing.calendarName,
              myRsvpStatus: openEditing.myRsvpStatus ?? null,
              occurrenceDate: openEditing.occurrenceDate ?? null,
            }
          : null,
      }),
    [view, ctxFrom, ctxTo, ctxCount, creating, openEditing],
  )
  useRegisterAiScreenContext(screenContext)

  // 점 찍을 날 — 미니 캘린더가 보여 주는 달 기준, 표시 토글을 존중.
  const markedDates = useMemo(
    () =>
      monthMatrix(miniMonth).filter(
        (day) =>
          eventsOnDay(miniEvents.filter(filterByCalendar), day).length > 0 ||
          (layers.issueDues && issueDuesOnDay(miniDues, day).length > 0),
      ),
    [miniMonth, layers, miniEvents, miniDues, filterByCalendar],
  )

  const create = useCreateEvent()
  const update = useUpdateEvent()
  const remove = useDeleteEvent()

  // issueDues / invited 토글(keyof Pick 으로 타입 안전).
  const toggleLayer = (key: keyof Pick<CalendarLayers, 'issueDues' | 'invited'>, value: boolean) => {
    const next = { ...layers, [key]: value }
    saveLayers(next)
    setLayers(next)
  }

  // 캘린더 컨테이너 표시 토글.
  const onToggleCalendar = (id: number) => {
    const next = toggleCalendar(layers, id)
    saveLayers(next)
    setLayers(next)
  }

  // 방향(dir)과 현재 뷰에 따라 anchor 이동
  const step = (dir: 1 | -1) =>
    setAnchor((a) =>
      view === 'month' ? addMonths(a, dir) : addDays(a, view === 'day' ? dir : 7 * dir),
    )

  // 모바일 월·주·일 본문 좌우 스와이프(WP-136) — 왼쪽으로 밀면 다음 기간, 오른쪽이면 이전 기간. 목록 보기에는 걸지 않는다(무한 스크롤).
  const swipe = useHorizontalSwipe((dir) => step(dir === 'next' ? 1 : -1))

  // 모바일 목록을 첫 청크·맨 위로 되돌린다(anchor 가 같으면 훅이 스스로 되돌리지 않는다) — [오늘]·보기 전환·미니 달력 날짜 선택.
  // 남겨 둔 stale 도 지운다 — 직접 고른 날(지난 오늘을 다시 골라도)을 화면 복귀 때 덮지 않게.
  const resetAgenda = () => {
    agenda.reset()
    setFollow((f) => ({ ...f, stale: null }))
  }

  // [오늘] — anchor 를 오늘로. 모바일 목록은 이미 오늘부터 보고 있었어도 첫 청크·맨 위로.
  const goToday = () => {
    setAnchor(startOfDay(new Date()))
    if (mobileAgenda) resetAgenda()
  }

  // 보기 전환(모바일 select). 목록으로 들어오면 청크를 1개로 되돌린다(불러 둔 뒤 청크를 다시 받지 않게).
  // 월 보기에서 들어오면 그 달 기준(이번 달이면 오늘, 아니면 1일 — anchor 그대로면 그 달 앞부분이 숨는다), 주·일에선 anchor 그대로.
  const changeView = (next: CalendarViewType) => {
    setView(next)
    // 목록에서 나갈 땐 헤더가 보여 주던 날(맨 위 묶음) 기준 — 목록 시작을 쓰면 헤더 「12월」인데 월 보기가 10월로 뜬다.
    if (mobileAgenda && next !== 'agenda') setAnchor(startOfDay(headerMonth))
    if (isMobile && next === 'agenda') {
      if (view === 'month') {
        const today = startOfDay(new Date())
        setAnchor(isSameMonth(anchor, today) ? today : startOfMonth(anchor))
      }
      resetAgenda()
    }
  }

  // 헤더 미니 달력 펼침/접힘(펼칠 때의 달은 panelMonth 가 맞춘다).
  const toggleMini = () => setMiniOpen((o) => !o)

  // 패널 접기(날짜 선택·Esc) — 포커스를 제목 버튼으로 돌려준다.
  const closeMini = () => {
    setMiniOpen(false)
    titleToggleRef.current?.focus()
  }

  // 미니 달력에서 날짜 선택 — 그 날로 이동하고 접는다. 목록은 그 날부터 다시(같은 날이어도 맨 위로), 월·주·일은 그 날이 든 기간으로.
  const pickMiniDate = (d: Date) => {
    setAnchor(startOfDay(d))
    closeMini()
    if (mobileAgenda) resetAgenda()
  }

  // 새 일정 다이얼로그 열기 (시작 시각 선택 시 전달)
  const openNew = (start?: Date) => {
    setEditing(null)
    setDefaultStart(start)
    setCreating(true)
  }

  // 기존 일정 열기 — 스냅숏을 남기고 ?eventId 를 push(이미 열린 상태면 replace).
  const openEdit = (e: CalendarEvent) => {
    setCreating(false)
    setEditing(e)
    eventParam.open(String(e.id))
  }

  // 다이얼로그 닫기 — ‹·ESC·바깥 클릭·취소·저장 완료 공통. 새 일정은 상태만, 기존 일정은 연 히스토리 항목을 되돌린다.
  const closeDialog = () => {
    if (creating) setCreating(false)
    else eventParam.close()
  }

  // 새 일정 딥링크(?new=true) 처리 — 진입 시 1회 다이얼로그 오픈 후 쿼리파라미터 정리(replace).
  useEffect(() => {
    if (!deepLinkNew) return
    openNew()
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('new')
        return next
      },
      { replace: true },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkNew])

  // URL 이 가리키는 일정이 스냅숏과 다르면(알림·홈 딥링크·새로고침) 단건 조회로 채운다 — 성공 시 그 날짜로 이동.
  // (반복 회차를 가리켜도 GET /events/{id} 는 마스터를 반환 — 회차 특정 없이 마스터로 연다, #659 지침 4항.)
  // 삭제됐거나 권한이 없으면(404/403) 토스트로 안내하고 eventId 만 replace 로 지운다(다른 쿼리·router state 유지).
  // 토스트가 곧 '없음' 상태라 닫을 다이얼로그가 없다 — 스펙 §6 '조용한 replace 금지'의 허용 예외(WP-208).
  // 남겨 두면 다음 일정 탭이 push 가 아닌 replace 가 되어(이미 열린 값으로 판정) 그 다이얼로그를 닫을 때 -1 로 캘린더를 떠난다.
  const needFetch = eventIdParam != null && editing?.id !== eventIdParam
  const { data: deepLinkEvent, isError: deepLinkFailed } = useCalendarEvent(needFetch ? eventIdParam : null)
  useEffect(() => {
    if (!needFetch) return
    if (deepLinkEvent && deepLinkEvent.id === eventIdParam) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 서버 응답(외부)으로 스냅숏을 채운다(MailInboxPage 와 같은 처리)
      setAnchor(startOfDay(new Date(deepLinkEvent.startsAt)))
      setCreating(false)
      setEditing(deepLinkEvent)
    } else if (deepLinkFailed) {
      toast.error('일정을 찾을 수 없거나 접근 권한이 없습니다')
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.delete('eventId')
          return next
        },
        { replace: true, state: location.state },
      )
    }
    // location.state 는 실패 시점 값만 필요 — 의존성에 넣으면 무관한 state 변경마다 재평가된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needFetch, deepLinkEvent, deepLinkFailed, eventIdParam])

  // 생성·수정 공용 submit 핸들러
  const submit = (body: CalendarEventRequest) => {
    // 새 일정 저장 중에 이전 스냅숏(editing)이 수정 대상으로 잡히지 않게 creating 을 먼저 본다.
    if (!creating && editing) {
      if (editing.occurrenceDate != null) {
        // 범위 선택으로 넘어간다 — URL(?eventId)은 그대로, EventDialog 만 숨긴다.
        setPendingBody(body)
        setSuspendedId(editing.id)
        setScopeMode('edit')
        return
      }
      update.mutate({ id: editing.id, body }, { onSuccess: () => closeDialog() })
    } else {
      create.mutate(body, { onSuccess: () => setCreating(false) })
    }
  }

  // 삭제 → 2단계(반복=범위 선택, 단일=삭제 확인). URL 은 그대로 두고 EventDialog 만 숨긴다.
  const onDelete = () => {
    if (!editing) return
    setSuspendedId(editing.id)
    if (editing.occurrenceDate != null) {
      setScopeMode('delete')
      return
    }
    setConfirmDeleteOpen(true)
  }

  // 2단계 결과 — 성공이면 일반 닫기 규칙으로 일정 상세를 닫고, 실패면 EventDialog 로 돌아간다.
  const secondStepCallbacks = {
    onSuccess: () => closeDialog(),
    onError: () => setSuspendedId(null),
  }

  // 삭제 확인 — AlertDialogAction 의 자동 닫기(onOpenChange(false))를 막아 '취소'와 구분한다.
  const confirmDelete = (e: React.MouseEvent) => {
    e.preventDefault()
    if (!editing) return
    setConfirmDeleteOpen(false)
    remove.mutate({ id: editing.id }, secondStepCallbacks)
  }

  // 삭제 확인 닫힘(취소·ESC·바깥) — EventDialog 로 돌아간다.
  const onConfirmDeleteOpenChange = (o: boolean) => {
    setConfirmDeleteOpen(o)
    if (!o) setSuspendedId(null)
  }

  const onPickScope = (scope: EditScope) => {
    if (!editing) return
    const id = editing.masterEventId ?? editing.id
    const occurrenceDate = editing.occurrenceDate
    if (scopeMode === 'edit' && pendingBody) {
      update.mutate({ id, body: pendingBody, scope, occurrenceDate }, secondStepCallbacks)
    } else if (scopeMode === 'delete') {
      remove.mutate({ id, scope, occurrenceDate }, secondStepCallbacks)
    }
    setScopeMode(null)
    setPendingBody(null)
  }

  // 범위 선택 취소 — EventDialog 로 돌아간다(URL 그대로).
  const cancelScope = () => {
    setScopeMode(null)
    setPendingBody(null)
    setSuspendedId(null)
  }

  // 이슈 마감 칩 클릭 → 해당 이슈 상세로 이동(읽기전용 오버레이).
  const openIssue = (m: IssueDueMarker) =>
    navigate(`/projects/${m.projectKey}/issues/${m.number}`)

  // 캘린더 컨테이너 추가/수정 핸들러.
  const openAddCalendar = () => {
    setEditingCal(null)
    setCalEditOpen(true)
  }
  const openEditCalendar = (c: Calendar) => {
    setEditingCal(c)
    setCalEditOpen(true)
  }
  const submitCalendar = (body: CalendarRequest) => {
    if (editingCal) {
      updateCal.mutate({ id: editingCal.id, body }, { onSuccess: () => setCalEditOpen(false) })
    } else {
      createCal.mutate(body, { onSuccess: () => setCalEditOpen(false) })
    }
  }
  const deleteCalendar = () => {
    if (!editingCal) return
    deleteCal.mutate(editingCal.id, { onSuccess: () => setCalEditOpen(false) })
  }

  // 케밥 "모든 일정 삭제" → 확인 다이얼로그 오픈.
  const openResetCalendar = (c: Calendar) => setResettingCal(c)
  // 확인 → 리셋 실행 후 다이얼로그 닫기.
  const confirmResetCalendar = () => {
    if (!resettingCal) return
    resetCal.mutate(resettingCal.id, { onSuccess: () => setResettingCal(null) })
  }

  const viewProps = {
    events: visibleEvents,
    issueDues: layers.issueDues ? issueDues : [],
    anchor,
    onSelectEvent: openEdit,
    onSelectIssue: openIssue,
    onCreateAt: openNew,
  }

  // 오늘/이전/다음 — 데스크톱은 헤더 제목 앞(icon 슬롯), 모바일은 헤더 아래 도구 줄 왼쪽에 둔다.
  const navControls = (
    <div className="flex items-center gap-1">
      <Button
        variant="outline"
        size="sm"
        data-testid="calendar-today"
        className={navBtnClass}
        onClick={goToday}
      >
        오늘
      </Button>
      {/* ‹ › — 모바일 목록 보기에선 숨긴다(아래로 스크롤하면 이어서 불러온다). 모바일 도구 줄에선 [오늘]과 같은 테두리 버튼(U3-R10). */}
      {!mobileAgenda &&
        ([-1, 1] as const).map((dir) => (
          <Button
            key={dir}
            variant={isMobile ? 'outline' : 'ghost'}
            size="sm"
            data-testid={dir < 0 ? 'calendar-prev' : 'calendar-next'}
            className={arrowBtnClass}
            // 글리프만으로는 이름이 무의미해 뷰별 단위를 붙인다(#818) — step() 은 month=한 달, day=하루, 그 외=7일.
            aria-label={`${dir < 0 ? '이전' : '다음'} ${view === 'month' ? '달' : view === 'day' ? '날' : '주'}`}
            onClick={() => step(dir)}
          >
            {dir < 0 ? '‹' : '›'}
          </Button>
        ))}
    </div>
  )

  // 모바일 헤더 제목 — 「10월 ▾」 버튼으로 미니 달력을 펼친다(같은 해면 'M월'). ▾ 는 aria-hidden 아이콘이라 제목 텍스트·h1 이름은
  // 보이는 달 그대로이고, 동작은 aria-expanded·헤더 밖 숨긴 설명(aria-describedby)으로 알린다. 데스크톱 제목은 'yyyy년 M월'.
  const headerLabel = headerMonthLabel(headerMonth, now)
  const title = isMobile ? (
    <button
      ref={titleToggleRef}
      type="button"
      data-testid="calendar-title-toggle"
      aria-expanded={miniOpen}
      aria-controls={miniOpen ? 'calendar-mobile-mini' : undefined}
      aria-describedby="calendar-title-hint"
      onClick={toggleMini}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && miniOpen) closeMini()
      }}
      // 터치 높이 44px(헤더 56px 안) — 모바일 핵심 진입점. 좌우 -mx-1·px-1 로 글자 시작 위치는 그대로 두고 눌림 배경만 준다.
      className="-mx-1 inline-flex min-h-11 max-w-full items-center gap-1 rounded-md px-1 active:bg-accent"
    >
      <span data-testid="calendar-title" className="truncate">{headerLabel}</span>
      <ChevronDown
        aria-hidden="true"
        className={cn('size-5 shrink-0 text-muted-foreground', miniOpen && 'rotate-180 text-primary')}
      />
    </button>
  ) : (
    <span data-testid="calendar-title">{format(anchor, 'yyyy년 M월')}</span>
  )

  // 월·주·일 본문 컴포넌트(목록이면 없음).
  const GridView = view === 'agenda' ? null : GRID_VIEWS[view]

  return (
    <>
      {/* 모바일: 사이드바는 바텀시트(☰), 데스크톱: 기존 가로 배치 */}
      <MobileSidebarSheet
        title="캘린더"
        sidebar={
          <CalendarSidebar
            onNew={() => openNew()}
            anchor={anchor}
            onSelectDate={(d) => setAnchor(startOfDay(d))}
            layers={layers}
            onToggleLayer={toggleLayer}
            calendars={calendars}
            onToggleCalendar={onToggleCalendar}
            onAddCalendar={openAddCalendar}
            onEditCalendar={openEditCalendar}
            onResetCalendar={openResetCalendar}
            markedDates={markedDates}
            hideMiniCalendar={isMobile}
          />
        }
      >
        {/* 데스크톱은 사이드바 옆 나머지 폭(flex-1)을 차지하는 Page 틀. */}
        <Page className="min-w-0 flex-1">
          {/* 상단 네비게이션 바 — 오늘/이전/다음 + 뷰 전환. 모바일은 헤더에 제목만, 이동·뷰 전환은 아래 도구 줄(U2-5). */}
          <Page.Header
            icon={isMobile ? undefined : navControls}
            title={title}
            actions={isMobile ? undefined : CALENDAR_VIEWS.map((v) => (
              <Button
                key={v.key}
                size="sm"
                variant={view === v.key ? 'default' : 'ghost'}
                // 시각적으로만(배경색) 표현되던 선택 상태를 프로그램적으로도 노출 (#818).
                aria-pressed={view === v.key}
                data-testid={`calendar-view-${v.key}-btn`}
                onClick={() => setView(v.key)}
              >
                {v.label}
              </Button>
            ))}
          />
          {isMobile && (
            // 제목 버튼 설명(aria-describedby 대상) — h1 밖에 두어 제목 텍스트·이름에 섞이지 않게 한다. 화면엔 보이지 않는다.
            <span id="calendar-title-hint" hidden>
              날짜를 골라 이동하는 달력
            </span>
          )}
          {isMobile && miniOpen && (
            <MobileMiniCalendarPanel
              id="calendar-mobile-mini"
              selected={anchor}
              month={panelMonth}
              onMonthChange={setPanelMonth}
              onSelect={pickMiniDate}
              onEscape={closeMini}
              markedDates={markedDates}
            />
          )}
          {/* 미니 달력을 펼친 동안엔 도구 줄을 숨겨 패널 바로 아래 목록이 이어지게 한다(시안 ③) — 펼친 동안 [오늘]은 날짜 탭으로,
              보기 전환은 패널과 무관해 잃는 기능이 없고, 열린 상태는 헤더 ▲ 가 알린다. */}
          {isMobile && !miniOpen && (
            <div data-testid="calendar-mobile-toolbar" className="flex h-12 shrink-0 items-center gap-1 border-b px-2">
              {navControls}
              <div className="flex-1" />
              {/* 네이티브 select — OS 피커(iOS 휠)로 열리고 현재 뷰를 한 칸에 보여준다. 데스크톱 뷰 버튼 testid 는 그대로. */}
              <select
                data-testid="calendar-view-select"
                aria-label="보기 전환"
                value={view}
                onChange={(e) => changeView(e.target.value as CalendarViewType)}
                className="h-11 shrink-0 rounded-md border bg-background px-2 text-sm"
              >
                {CALENDAR_VIEWS.map((v) => (
                  <option key={v.key} value={v.key}>{v.label}</option>
                ))}
              </select>
            </div>
          )}

          {/* 뷰 렌더링 — 월/주/일 그리드가 자체 스크롤·여백을 가져 padded=false(세로 쌓기). */}
          <Page.Body padded={false} className="flex-col">
            {/* 모바일 월·주·일은 좌우 스와이프 영역으로 감싼다(pan-y: 세로 스크롤은 브라우저, 스와이프 뒤 click 은 훅이 한 번 막는다). */}
            {GridView &&
              (isMobile ? (
                <div data-testid="calendar-swipe-area" className="flex min-h-0 flex-1 touch-pan-y flex-col" {...swipe}>
                  <GridView {...viewProps} />
                </div>
              ) : (
                <GridView {...viewProps} />
              ))}
            {mobileAgenda && <MobileAgendaView agenda={agenda} now={now} onSelectEvent={openEdit} onSelectIssue={openIssue} />}
            {view === 'agenda' && !isMobile && <AgendaView {...viewProps} />}
          </Page.Body>
        </Page>
      </MobileSidebarSheet>

      {/* 일정 생성/편집 다이얼로그 */}
      <EventDialog
        open={dialogOpen}
        onOpenChange={(o) => {
          if (!o) closeDialog()
        }}
        event={creating ? undefined : (editing ?? undefined)}
        defaultStart={defaultStart}
        onSubmit={submit}
        onDelete={onDelete}
        isPending={create.isPending || update.isPending}
      />

      {/* 캘린더 컨테이너 추가/편집 다이얼로그 */}
      <CalendarEditDialog
        open={calEditOpen}
        onOpenChange={setCalEditOpen}
        calendar={editingCal}
        onSubmit={submitCalendar}
        onDelete={deleteCalendar}
        isPending={createCal.isPending || updateCal.isPending}
      />

      {/* 반복 회차 수정/삭제 시 적용 범위 선택 */}
      {scopeMode && (
        <RecurrenceScopeDialog
          open={!!scopeMode}
          mode={scopeMode}
          onPick={onPickScope}
          onCancel={cancelScope}
        />
      )}

      {/* 캘린더 강제 리셋(모든 일정 삭제) 확인 다이얼로그 */}
      <AlertDialog open={resettingCal != null} onOpenChange={(o) => !o && setResettingCal(null)}>
        <AlertDialogContent data-testid="calendar-reset-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>모든 일정 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              {resettingCal?.name}의 모든 일정을 영구 삭제합니다. 되돌릴 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              data-testid="calendar-reset-confirm-submit"
              variant="destructive"
              onClick={confirmResetCalendar}
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 단일 일정 삭제 확인 다이얼로그 */}
      <AlertDialog open={confirmDeleteOpen} onOpenChange={onConfirmDeleteOpenChange}>
        <AlertDialogContent data-testid="calendar-confirm-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>일정 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              정말 삭제하시겠습니까? 되돌릴 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="calendar-confirm-delete-cancel">취소</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              data-testid="calendar-confirm-delete-confirm"
              onClick={confirmDelete}
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
