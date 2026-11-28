// Outlook 기본 캘린더 확인 창(WP-2171) — M365(Outlook)를 연결한 사용자에게 「새 일정을 Outlook 캘린더에 만들까요?」를 한 번 묻는다.
// 앱 셸(AppLayout)에 한 번 마운트한다. 캘린더 화면에 들어왔거나 M365 연결 성공 알림을 받았을 때만 캘린더·설정을 조회한다.
import { focusManager, useQueryClient } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'

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
import { calendarKeys } from '@/hooks/queries/calendarKeys'
import {
  useCalendars,
  useCalendarSettings,
  useMarkOutlookPrompted,
  useUpdateCalendarSettings,
} from '@/hooks/queries/useCalendars'
import { isOutlookCalendar, outlookPromptTarget, shouldPromptOutlookDefault } from '@/lib/calendar'
import { useM365OAuthResult } from '@/lib/m365-oauth'

/** 연결 성공 알림 뒤 Outlook 캘린더가 동기화돼 나타나기를 기다리는 시간 — 지나면 더 기다리지 않는다(다른 화면에서 뜬금없이 뜨지 않게). */
const CONNECT_WINDOW_MS = 2 * 60_000
/** 기다리는 동안 캘린더 목록을 다시 읽는 간격 */
const CONNECT_POLL_MS = 5_000
/** 지정(PUT) 실패(403 밖)가 이 횟수에 이르면 물었음으로 기록해 더 묻지 않는다 */
const MAX_SET_FAILURES = 2

/**
 * @param connectWindowMs 연결 알림 뒤 기다리는 시간(테스트용 주입)
 * @param pollMs 기다리는 동안 캘린더 목록을 다시 읽는 간격(테스트용 주입)
 */
export function OutlookDefaultPrompt({
  connectWindowMs = CONNECT_WINDOW_MS,
  pollMs = CONNECT_POLL_MS,
}: { connectWindowMs?: number; pollMs?: number }) {
  const { pathname } = useLocation()
  const qc = useQueryClient()
  // 연결 직후 기다리는 중인가 — Outlook 캘린더는 백그라운드 동기화 뒤에야 생기므로 이 동안만(connectWindowMs) 목록을 주기적으로 다시 읽는다.
  // 새 연결 알림이 오면 창을 다시 시작한다. 캘린더 화면 밖(프로필 메일 설정 등)에서 연결한 직후에도 한 번 묻기 위한 신호다.
  const [waiting, setWaiting] = useState(false)
  const waitTimer = useRef<number | null>(null)
  // 연결 신호 뒤 캘린더 밖에서 창이 실제로 열렸는가 — 기다림이 끝나도 이미 열린 창은 유지하고, 열린 적 없으면 비활성으로 돌아간다.
  // 캘린더 화면에서 연 창은 세지 않는다 — 캘린더에서는 onCalendar 가 켜 두고, 캘린더를 떠나면 꺼져야 하기 때문이다(WP-2171 리뷰 후속 반려)
  const [opened, setOpened] = useState(false)
  // 창을 닫았는가 — 지금 머무는 동안 같은 창을 다시 띄우지 않는다(지정 실패 409 도 포함). 캘린더 재진입·새 연결 알림에서 풀린다
  const [closed, setClosed] = useState(false)
  // 「물었음」 기록 중복 방지
  const markedRef = useRef(false)
  // 지정(PUT) 이 403 밖의 까닭(409 등)으로 실패한 횟수 — 같은 실패가 되풀이되면 캘린더에 들어올 때마다 묻지 않게 상한을 둔다
  const setFailures = useRef(0)
  const markPrompted = useMarkOutlookPrompted()

  // 연결 성공 알림(실패 결과는 무시) — 기다림을 (다시) 시작하고 새 Outlook 캘린더·설정을 다시 읽는다.
  // 팝업은 BroadcastChannel 로도 알리므로(notifyOpener) 연결을 시작한 탭뿐 아니라 열려 있는 모든 탭이 이 알림을 받는다.
  // 새 연결이면 앞서 닫은 창도 다시 물을 수 있게 closed 를 푼다(이미 물었으면 설정의 outlookPrompted 가 막는다).
  useM365OAuthResult((result) => {
    if (!result.ok) return
    setWaiting(true)
    setOpened(false)
    // 「지금대로 두기」 기록이 아직 가는 중이면 풀지 않는다 — 기록 전 설정을 다시 읽어 방금 답한 창이 다시 뜨지 않게
    if (!markPrompted.isPending) setClosed(false)
    if (waitTimer.current != null) window.clearTimeout(waitTimer.current)
    waitTimer.current = window.setTimeout(() => setWaiting(false), connectWindowMs)
    void qc.invalidateQueries({ queryKey: calendarKeys.calendars })
    void qc.invalidateQueries({ queryKey: calendarKeys.calendarSettings })
  })
  // 언마운트 때 대기 타이머를 치운다
  useEffect(() => () => { if (waitTimer.current != null) window.clearTimeout(waitTimer.current) }, [])

  // 비활성(캘린더 화면도 연결 직후도 아님)이면 조회하지 않는다 — 앱 셸이 늘 마운트하므로 다른 화면에 부담을 주지 않게.
  // 연결 신호로 켜는 쪽은 기다리는 동안이거나 창이 이미 열린 동안만, 창을 닫은 뒤엔 꺼진다.
  const onCalendar = pathname.startsWith('/calendar')
  // 캘린더 화면에 다시 들어오면 앞서 닫은 창을 다시 물을 수 있게 closed 를 풀고, 연결 경로의 opened 도 지운다(렌더 중 상태 보정).
  // 지정이 409 등으로 실패했거나 물었음 기록이 실패한 경우만 실제로 다시 뜬다 — 기록에 성공했으면 outlookPrompted 가 true 라 판정이 'none' 이다.
  // opened 를 남기면 캘린더를 떠난 뒤에도 active 가 켜져 모든 화면에서 조회하고 창이 캘린더 밖에서 뜬다.
  const [prevOnCalendar, setPrevOnCalendar] = useState(onCalendar)
  if (onCalendar !== prevOnCalendar) {
    setPrevOnCalendar(onCalendar)
    // 닫힌 창(답했거나 실패)만 다시 연다 — 연결 경로로 떠 있는(아직 답 안 한) 창의 opened 는 남겨 캘린더를 떠나도 사라지지 않게 한다.
    // 「지금대로 두기」 기록이 가는 중이면 풀지 않는다(기록 전 설정으로 방금 답한 창이 다시 뜨지 않게 — 연결 알림 쪽과 같다)
    if (onCalendar && closed && !markPrompted.isPending) {
      setClosed(false)
      setOpened(false)
    }
  }
  const active = onCalendar || (!closed && (waiting || opened))
  // 대기 중이고 아직 Outlook 캘린더가 하나도 동기화되지 않았으면 pollMs 마다 목록을 다시 읽는다.
  // 권할 캘린더(outlookPromptTarget)가 아니라 Outlook 캘린더가 생겼는지로 멈춘다 — 위임·공유 캘린더뿐인 사용자는 기다려도 권할 것이 생기지 않는다
  const { data: calendars = [] } = useCalendars({
    enabled: active,
    refetchInterval: (list) => (waiting && !(list ?? []).some(isOutlookCalendar) ? pollMs : false),
  })
  const { data: settings } = useCalendarSettings({ enabled: active })
  const decision = shouldPromptOutlookDefault({ settings, calendars, active })
  const target = outlookPromptTarget(calendars)

  const update = useUpdateCalendarSettings()
  const mark = markPrompted.mutate

  // 기록이 실패하면 markedRef 를 되돌려 다음 활성(캘린더 재진입·새 연결)에 다시 기록·질문할 수 있게 한다
  const markOnce = useCallback(() => {
    if (markedRef.current) return
    markedRef.current = true
    mark(undefined, { onError: () => { markedRef.current = false } })
  }, [mark])

  // 기본이 이미 Outlook 이면 창 없이 물었음만 기록한다
  useEffect(() => {
    if (decision === 'mark') markOnce()
  }, [decision, markOnce])

  const open = decision === 'show' && !closed && target != null
  // 캘린더 밖(연결 알림 경로)에서 창이 열리면 기록한다(렌더 중 상태 보정 — 효과 안 setState 를 피한다)
  if (open && !opened && !onCalendar) setOpened(true)

  // 창이 실제로 떠 있는 동안만(캘린더 화면 포함) 탭으로 돌아올 때마다 설정을 다시 읽는다(staleTime 무시) — 다른 탭(같은 연결 알림을 받은 탭)에서 이미 답했으면 outlookPrompted 가 true 라 창이 닫힌다
  useEffect(() => {
    if (!open) return
    return focusManager.subscribe((focused) => {
      if (focused) void qc.invalidateQueries({ queryKey: calendarKeys.calendarSettings })
    })
  }, [open, qc])

  // 지금대로 두기·ESC(AlertDialog 는 바깥 클릭으로 닫히지 않는다) — 설정은 그대로 두고 물었음만 기록한다
  const keep = () => {
    markOnce()
    setClosed(true)
  }
  // Outlook 캘린더로 지정 — 성공해야 물었음을 기록한다(409 등 실패면 다음에 다시 묻는다). 어느 쪽이든 창은 닫는다.
  const setDefault = (e: React.MouseEvent) => {
    e.preventDefault() // AlertDialogAction 의 자동 닫기를 막고 결과 뒤에 닫는다
    if (!target) return
    update.mutate(target.id, {
      onSuccess: markOnce,
      // 403 은 쓰기 권한이 없어 어차피 지정할 수 없는 사용자 — 물었음으로 기록해 다시 묻지 않는다.
      // 409 등 다른 실패는 다음에 다시 묻되, MAX_SET_FAILURES 번째 실패면 되풀이되는 실패로 보고 물었음으로 기록한다
      onError: (err) => {
        if (isAxiosError(err) && err.response?.status === 403) {
          markOnce()
          return
        }
        setFailures.current += 1
        if (setFailures.current >= MAX_SET_FAILURES) markOnce()
      },
      onSettled: () => setClosed(true),
    })
  }

  if (!open || !target) return null
  // 지정 요청 중의 닫기(Esc)는 무시한다 — 실패해도 「물었음」이 먼저 기록되지 않게
  return (
    <AlertDialog open onOpenChange={(o) => !o && !update.isPending && keep()}>
      <AlertDialogContent data-testid="outlook-default-prompt">
        <AlertDialogHeader>
          <AlertDialogTitle>새 일정 기본 캘린더</AlertDialogTitle>
          <AlertDialogDescription className="break-keep">
            {/* 계정 이메일이 없으면 괄호 없이 묻는다 */}
            {`새 일정을 Outlook 캘린더${target.accountEmail ? `(${target.accountEmail})` : ''}에 만들까요?`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="outlook-default-prompt-keep" disabled={update.isPending} onClick={keep}>
            지금대로 두기
          </AlertDialogCancel>
          <AlertDialogAction
            data-testid="outlook-default-prompt-set"
            disabled={update.isPending}
            onClick={setDefault}
          >
            Outlook 캘린더로 지정
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
