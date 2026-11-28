// Outlook 기본 캘린더 확인 창(WP-2171) — M365(Outlook)를 연결한 사용자에게 「새 일정을 Outlook 캘린더에 만들까요?」를 한 번 묻는다.
// 앱 셸(AppLayout)에 한 번 마운트한다. 캘린더 화면에 들어왔거나 M365 연결 성공 알림을 받았을 때만 캘린더·설정을 조회한다.
import { useQueryClient } from '@tanstack/react-query'
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
import { outlookPromptTarget, shouldPromptOutlookDefault } from '@/lib/calendar'
import { useM365OAuthResult } from '@/lib/m365-oauth'

/** 연결 성공 알림 뒤 Outlook 캘린더가 동기화돼 나타나기를 기다리는 시간 — 지나면 더 기다리지 않는다(다른 화면에서 뜬금없이 뜨지 않게). */
const CONNECT_WINDOW_MS = 2 * 60_000
/** 기다리는 동안 캘린더 목록을 다시 읽는 간격 */
const CONNECT_POLL_MS = 5_000

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
  // 연결 신호 뒤 창이 실제로 열렸는가 — 기다림이 끝나도 이미 열린 창은 유지하고, 열린 적 없으면 비활성으로 돌아간다
  const [opened, setOpened] = useState(false)
  // 이 세션에서 창을 닫았는가 — 같은 창을 다시 띄우지 않는다(지정 실패 409 도 포함)
  const [closed, setClosed] = useState(false)
  // 「물었음」 기록 중복 방지
  const markedRef = useRef(false)

  // 연결 성공 알림(실패 결과는 무시) — 기다림을 (다시) 시작하고 새 Outlook 캘린더·설정을 다시 읽는다
  useM365OAuthResult((result) => {
    if (!result.ok) return
    setWaiting(true)
    setOpened(false)
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
  const active = onCalendar || (!closed && (waiting || opened))
  // 대기 중이고 아직 권할 Outlook 캘린더가 없으면 pollMs 마다 목록을 다시 읽는다
  const { data: calendars = [] } = useCalendars({
    enabled: active,
    refetchInterval: (list) => (waiting && !outlookPromptTarget(list ?? []) ? pollMs : false),
  })
  const { data: settings } = useCalendarSettings({ enabled: active })
  const decision = shouldPromptOutlookDefault({ settings, calendars, active })
  const target = outlookPromptTarget(calendars)

  const update = useUpdateCalendarSettings()
  const markPrompted = useMarkOutlookPrompted()
  const mark = markPrompted.mutate

  const markOnce = useCallback(() => {
    if (markedRef.current) return
    markedRef.current = true
    mark()
  }, [mark])

  // 기본이 이미 Outlook 이면 창 없이 물었음만 기록한다
  useEffect(() => {
    if (decision === 'mark') markOnce()
  }, [decision, markOnce])

  const open = decision === 'show' && !closed && target != null
  // 창이 열리면 기록한다(렌더 중 상태 보정 — 효과 안 setState 를 피한다)
  if (open && !opened) setOpened(true)

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
      // 403 은 쓰기 권한이 없어 어차피 지정할 수 없는 사용자 — 물었음으로 기록해 다시 묻지 않는다(409 등 다른 실패는 다음에 다시 묻는다)
      onError: (err) => {
        if (isAxiosError(err) && err.response?.status === 403) markOnce()
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
