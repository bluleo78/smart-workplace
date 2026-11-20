// InboxList 화면 테스트 공용 도우미(WP-1844) — inboxArchive.test.tsx(WP-1690)와 inboxUnreadA11y.test.tsx 가 같이 쓴다.
// 알림 픽스처 notif(), 보기 상태를 쥐는 InboxHarness, MSW 핸들러 묶음(renderInbox)을 한곳에 둬 두 파일의 중복을 없앤다.
import { http, HttpResponse } from 'msw'
import { useState } from 'react'

import { InboxList, type InboxView, InboxViewTabs } from '@/components/layout/InboxList'
import { renderScreen } from '@/test/renderScreen'
import type { NotificationResponse } from '@/types/notification'

/** 알림 1건 — appRail.test.tsx 와 같은 기본값. */
export function notif(over: Partial<NotificationResponse> = {}): NotificationResponse {
  return {
    id: 1,
    type: 'COMMENTED',
    actorId: 9,
    actorName: '업무 비서',
    actorKind: 'AGENT',
    issueId: 7,
    projectKey: 'WP',
    issueNumber: 3,
    issueTitle: '리팩터링',
    commentId: 55,
    eventId: null,
    eventTitle: null,
    eventStartsAt: null,
    read: true,
    createdAt: new Date().toISOString(),
    ...over,
  }
}

/** InboxList 는 보기 상태를 바깥이 들고 있어야 해서(제어 전용), 테스트에서는 상태만 쥐는 얇은 래퍼로 띄운다. */
export function InboxHarness({
  screenEmpty = false,
  onNavigate,
  hideHeader = false,
}: {
  screenEmpty?: boolean
  onNavigate?: () => void
  /** true 면 실제 모바일 NotificationsPage 처럼 탭을 InboxList 밖에 그리고 InboxList 는 hideHeader 로 띄운다. */
  hideHeader?: boolean
}) {
  const [view, setView] = useState<InboxView>('inbox')
  return (
    <>
      {hideHeader && <InboxViewTabs view={view} onChange={setView} />}
      <InboxList enabled view={view} onViewChange={setView} screenEmpty={screenEmpty} onNavigate={onNavigate} hideHeader={hideHeader} />
    </>
  )
}

/** InboxList 가 늘 부르는 부가 조회(읽지 않은 수·푸시 설정) 핸들러. 목록·보관함 응답은 테스트가 준다. */
export function inboxSupportHandlers() {
  return [
    http.get('/api/v1/notifications/unread-count', () => HttpResponse.json({ count: 0 })),
    http.get('/api/v1/push/config', () => HttpResponse.json({ enabled: false, vapidPublicKey: null })),
  ]
}

/**
 * InboxList 를 띄운다.
 * - inbox: 알림 GET 응답. 함수면 요청마다 평가한다(읽음 처리 뒤 응답을 바꾸는 테스트용).
 * - archived: 보관함 응답(되돌리기 성공 뒤에는 그 id 만 뺀다). unarchived: 되돌리기 요청 바디 ids.
 * - unarchiveFails: true 면 되돌리기 POST 를 500 으로 실패시킨다(WP-1845 실패 뒤 포커스·토스트).
 * - onMarkRead: POST /notifications/:id/read 가 올 때 부르는 콜백. markedRead: 그 id 모음.
 * - onNavigate·hideHeader: 하네스로 넘긴다(WP-1848 빈 상태 CTA). inboxStatus: 200 이 아니면 알림 GET 을 그 상태로 실패시킨다. inboxCalls: 알림 GET 횟수.
 */
export function renderInbox(
  opts: {
    inbox?: NotificationResponse[] | (() => NotificationResponse[])
    archived?: NotificationResponse[]
    screenEmpty?: boolean
    onMarkRead?: (id: number) => void
    onNavigate?: () => void
    hideHeader?: boolean
    inboxStatus?: number
    unarchiveFails?: boolean
  } = {},
) {
  const { inbox = [notif({ id: 1 })], archived = [], screenEmpty = false, onMarkRead, onNavigate, hideHeader = false, inboxStatus = 200, unarchiveFails = false } = opts
  const inboxCalls = { count: 0 }
  const unarchived: number[][] = []
  const markedRead: number[] = []
  let archiveRows = archived
  const view = renderScreen(<InboxHarness screenEmpty={screenEmpty} onNavigate={onNavigate} hideHeader={hideHeader} />, {
    path: '/',
    handlers: [
      http.get('/api/v1/notifications', () => {
        inboxCalls.count += 1
        return inboxStatus === 200 ? HttpResponse.json(typeof inbox === 'function' ? inbox() : inbox) : new HttpResponse(null, { status: inboxStatus })
      }),
      http.get('/api/v1/notifications/archived', () => HttpResponse.json(archiveRows)),
      ...inboxSupportHandlers(),
      http.post('/api/v1/notifications/unarchive', async ({ request }) => {
        if (unarchiveFails) return new HttpResponse(null, { status: 500 })
        const body = (await request.json()) as { ids: number[] }
        unarchived.push(body.ids)
        archiveRows = archiveRows.filter((r) => !body.ids.includes(r.id)) // 성공 뒤 보관함에서 그 id 만 빠진다
        return HttpResponse.json({ restoredIds: body.ids })
      }),
      http.post('/api/v1/notifications/:id/read', ({ params }) => {
        const id = Number(params.id)
        markedRead.push(id)
        onMarkRead?.(id)
        // 실제 API 처럼 본문 없는 204 로 답한다(appRail.test.tsx 의 읽음 목과 같은 계약).
        return new HttpResponse(null, { status: 204 })
      }),
    ],
  })
  return { ...view, unarchived, markedRead, inboxCalls }
}
