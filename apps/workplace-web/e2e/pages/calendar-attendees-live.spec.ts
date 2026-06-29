// M365 참석자 양방향 라이브 스모크 (#547)
//
// 실행 조건:
//   M365_LIVE=1 \
//   LIVE_USER=dh.yang@iacloud.kr \
//   LIVE_PASSWORD=<비밀번호> \
//   LIVE_MEMBER_ID=<내부멤버userId> \   # 초대 대상 내부 사용자 ID
//   pnpm exec playwright test calendar-attendees-live
//
// 전제:
//   - API :9090 실행 중 (V111 마이그레이션 적용됨)
//   - dh.yang@iacloud.kr M365 계정 연결됨 (Calendars.ReadWrite)
//   - 동기화된 writable M365 캘린더 1개 이상 존재
//
// 검증 범위: §4 create+참석자 전송, §5 invite, §6 remove, §8 비주최자 409
// 비검증 범위: §1~3,7 (Outlook 사이드 액션 + sync 대기 필요)

import { expect, test } from '@playwright/test'
import type { Calendar, CalendarEvent } from '../../src/types/calendar'

const LIVE = process.env.M365_LIVE === '1'

// ── 환경변수 ──────────────────────────────────────────────────
const USER = process.env.LIVE_USER ?? 'dh.yang@iacloud.kr'
const PASSWORD = process.env.LIVE_PASSWORD ?? ''
// 초대할 내부 멤버 userId (앱 DB 기준)
const MEMBER_ID = Number(process.env.LIVE_MEMBER_ID ?? '0')

// ── 공통 헬퍼 ────────────────────────────────────────────────

/** 로그인 후 accessToken 반환 */
async function login(request: import('@playwright/test').APIRequestContext): Promise<string> {
  const resp = await request.post('/api/v1/auth/login', {
    data: { username: USER, password: PASSWORD },
  })
  expect(resp.ok(), `로그인 실패: ${resp.status()}`).toBeTruthy()
  const body = await resp.json()
  return body.accessToken as string
}

/** Authorization 헤더 포함 API 호출 헬퍼 */
function auth(jwt: string) {
  return { Authorization: `Bearer ${jwt}` }
}

// ── 테스트 그룹 ──────────────────────────────────────────────

test.describe('M365 참석자 라이브 스모크', () => {
  test.skip(!LIVE, 'M365_LIVE=1 환경변수가 없으면 스킵')
  test.describe.configure({ mode: 'serial' })

  let jwt: string
  // 테스트에서 생성한 이벤트 ID (teardown 에서 삭제)
  let createdEventId: number | null = null
  // writable M365 캘린더 ID
  let m365CalendarId: number | null = null

  test.beforeAll(async ({ request }) => {
    jwt = await login(request)

    // writable M365 캘린더 탐색 (isReadOnly=false)
    const cals = await request
      .get('/api/v1/calendars', { headers: auth(jwt) })
      .then((r) => r.json() as Promise<Calendar[]>)

    // M365 동기화 캘린더는 name 에 계정 이메일을 포함하거나 isReadOnly 여부로 구분
    // — isReadOnly=false 인 첫 번째 캘린더를 사용 (네이티브 + M365 모두 후보)
    const writable = cals.find((c) => !c.isReadOnly)
    if (!writable) {
      console.warn('[live] writable 캘린더 없음 — 이벤트 생성 테스트 스킵')
    } else {
      m365CalendarId = writable.id
    }
  })

  test.afterAll(async ({ request }) => {
    // 생성한 이벤트 정리
    if (createdEventId) {
      await request.delete(`/api/v1/calendar/events/${createdEventId}`, {
        headers: auth(jwt),
      })
    }
  })

  // ── §4 create 시 참석자 전송 ────────────────────────────────
  test('§4 일정 생성 시 내부 멤버를 참석자로 포함해 Graph 에 전송', async ({ request }) => {
    test.skip(!m365CalendarId, 'writable 캘린더 없음')
    test.skip(MEMBER_ID === 0, 'LIVE_MEMBER_ID 미설정')

    const from = new Date()
    from.setHours(from.getHours() + 1, 0, 0, 0)
    const to = new Date(from.getTime() + 60 * 60_000)

    const resp = await request.post('/api/v1/calendar/events', {
      headers: auth(jwt),
      data: {
        title: '[라이브스모크] 참석자 테스트',
        startsAt: from.toISOString(),
        endsAt: to.toISOString(),
        allDay: false,
        calendarId: m365CalendarId,
        attendeeUserIds: [MEMBER_ID],
      },
    })
    expect(resp.status(), `이벤트 생성 실패: ${resp.status()}`).toBe(201)

    const event: CalendarEvent = await resp.json()
    createdEventId = event.id

    // 상세 조회 — 참석자 포함 여부 확인
    const detail: CalendarEvent = await request
      .get(`/api/v1/calendar/events/${event.id}`, { headers: auth(jwt) })
      .then((r) => r.json())

    const member = detail.attendees?.find((a) => a.userId === MEMBER_ID)
    expect(member, `멤버(userId=${MEMBER_ID})가 참석자 목록에 없음`).toBeDefined()
    expect(detail.myRole).toBe('ORGANIZER')
    console.log(`[§4] 이벤트 생성 OK, attendeeCount=${detail.attendeeCount}`)
  })

  // ── §5 invite 추가 ──────────────────────────────────────────
  test('§5 주최자가 참석자 추가 → 200', async ({ request }) => {
    test.skip(!createdEventId, '§4 이벤트 없음')
    test.skip(MEMBER_ID === 0, 'LIVE_MEMBER_ID 미설정')

    // 일단 remove 해서 초기화 (§4 에서 이미 invited 상태)
    await request.delete(`/api/v1/calendar/events/${createdEventId}/attendees/${MEMBER_ID}`, {
      headers: auth(jwt),
    })

    // 다시 invite
    const resp = await request.post(`/api/v1/calendar/events/${createdEventId}/attendees`, {
      headers: auth(jwt),
      data: { userIds: [MEMBER_ID] },
    })
    expect(resp.status(), `invite 실패: ${resp.status()} ${await resp.text()}`).toBe(200)

    // 상세 조회로 참석자 확인
    const detail: CalendarEvent = await request
      .get(`/api/v1/calendar/events/${createdEventId}`, { headers: auth(jwt) })
      .then((r) => r.json())

    expect(
      detail.attendees?.some((a) => a.userId === MEMBER_ID),
      '참석자가 상세 조회에서 보이지 않음',
    ).toBeTruthy()
    console.log(`[§5] invite OK, attendeeCount=${detail.attendeeCount}`)
  })

  // ── §6 remove 제거 ──────────────────────────────────────────
  test('§6 주최자가 참석자 제거 → 200, 목록에서 사라짐', async ({ request }) => {
    test.skip(!createdEventId, '§4 이벤트 없음')
    test.skip(MEMBER_ID === 0, 'LIVE_MEMBER_ID 미설정')

    const resp = await request.delete(
      `/api/v1/calendar/events/${createdEventId}/attendees/${MEMBER_ID}`,
      { headers: auth(jwt) },
    )
    expect(resp.status(), `remove 실패: ${resp.status()} ${await resp.text()}`).toBe(200)

    const detail: CalendarEvent = await request
      .get(`/api/v1/calendar/events/${createdEventId}`, { headers: auth(jwt) })
      .then((r) => r.json())

    expect(
      detail.attendees?.every((a) => a.userId !== MEMBER_ID),
      '제거 후에도 참석자가 목록에 남아 있음',
    ).toBeTruthy()
    console.log(`[§6] remove OK, attendeeCount=${detail.attendeeCount}`)
  })

  // ── §8 비주최자 차단 409 ────────────────────────────────────
  test('§8 비주최자 외부 일정에 invite → 409', async ({ request }) => {
    // sync 된 이벤트 중 external=true && myRole !== 'ORGANIZER' 인 이벤트 탐색
    const now = new Date()
    const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const to = new Date(now.getFullYear(), now.getMonth() + 2, 1).toISOString()

    const events: CalendarEvent[] = await request
      .get(`/api/v1/calendar/events?from=${from}&to=${to}`, { headers: auth(jwt) })
      .then((r) => r.json())

    // 비주최자 외부 이벤트: myRole 이 없거나 ORGANIZER 가 아닌 external 이벤트
    // list API 는 myRole 을 반환하지 않으므로 상세 조회로 확인
    let nonOrganizerEventId: number | null = null
    for (const ev of events.filter((e) => e.external)) {
      const detail: CalendarEvent = await request
        .get(`/api/v1/calendar/events/${ev.id}`, { headers: auth(jwt) })
        .then((r) => r.json())
      if (detail.myRole !== 'ORGANIZER') {
        nonOrganizerEventId = detail.id
        console.log(`[§8] 비주최자 이벤트 발견: id=${detail.id}, myRole=${detail.myRole}`)
        break
      }
    }

    if (!nonOrganizerEventId) {
      console.warn('[§8] 비주최자 외부 이벤트 없음 — 스킵 (Outlook 에서 초대받은 일정 필요)')
      test.skip(true, '비주최자 외부 이벤트 없음')
      return
    }

    // invite 시도 → 409 기대
    const resp = await request.post(
      `/api/v1/calendar/events/${nonOrganizerEventId}/attendees`,
      {
        headers: auth(jwt),
        data: { userIds: [MEMBER_ID || 1] },
      },
    )
    expect(resp.status(), '비주최자 invite 가 409 를 반환해야 함').toBe(409)
    const body = await resp.json()
    expect(body.message).toContain('주최자')
    console.log('[§8] 비주최자 409 차단 OK')
  })
})
