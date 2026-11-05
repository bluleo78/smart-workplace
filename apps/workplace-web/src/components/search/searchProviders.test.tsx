// 통합 검색(WP-1353)의 앱별 provider — 기존 API 를 MSW 로 가로채 쿼리·합치기·이어 받기를 지킨다.
// dom 프로젝트(MSW 셋업)에서 돌도록 .tsx 다 — 화면은 없다.
import { QueryClient } from '@tanstack/react-query'
import { http, HttpResponse, type JsonBodyType } from 'msw'
import { describe, expect, it } from 'vitest'

import { formatListTime } from '@/lib/formatters'
import { server } from '@/test/msw/server'

import { createSearchProviders, dedupeHits, pickGroupHits } from './searchProviders'

const API = '/api/v1'

/** 테스트용 provider 묶음 — 테스트마다 새 QueryClient(캐시 공유 없음)와 내 id 5. */
function providers(qc = new QueryClient(), meId: number | null = 5) {
  return createSearchProviders({ queryClient: qc, meId })
}

/** 메일 검색 결과 한 건 — 통합 검색 메일 API(/search/mail)가 주는 모양. 기본은 받은편지함. */
function mail(id: number, accountId: number, receivedAt: string | null, extra: object = {}) {
  return {
    id,
    accountId,
    subject: `메일 ${id}`,
    snippet: `미리 ${id}`,
    fromName: null,
    fromAddress: `a${accountId}@x.com`,
    receivedAt,
    folderKind: 'INBOX',
    folderId: null,
    folderName: '받은편지함',
    firstRecipient: null,
    recipientCount: 0,
    ...extra,
  }
}

describe('wiki', () => {
  it('size·offset 쿼리를 보내고 노트 경로를 바로 만든다, 꽉 찬 쪽이면 다음 offset', async () => {
    const seen: URLSearchParams[] = []
    server.use(
      http.get(`${API}/wiki/search`, ({ request }) => {
        seen.push(new URL(request.url).searchParams)
        return HttpResponse.json([
          {
            id: 7,
            spaceId: 3,
            spaceName: '개발',
            title: '배포 가이드',
            snippet: '…배포…',
            updatedAt: '2026-01-01T00:00:00Z',
          },
          {
            id: 8,
            spaceId: 3,
            spaceName: '개발',
            title: '배포 체크',
            snippet: '…',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ])
      }),
    )
    const page = await providers().wiki.fetchPage('배포', 20, 2)
    expect(seen[0].get('q')).toBe('배포')
    expect(seen[0].get('size')).toBe('2')
    expect(seen[0].get('offset')).toBe('20')
    expect(page.hits[0]).toMatchObject({
      key: 'wiki:7',
      href: '/wiki/spaces/3/pages/7',
      meta: '개발',
      snippet: '…배포…',
    })
    expect(page.next).toBe(22)
  })
})

describe('drive', () => {
  it('/search/drive 를 부르고 meta·href 를 만든다(폴더는 폴더 자체)', async () => {
    const seen: URLSearchParams[] = []
    server.use(
      http.get(`${API}/search/drive`, ({ request }) => {
        seen.push(new URL(request.url).searchParams)
        return HttpResponse.json({
          items: [
            {
              kind: 'FILE',
              id: 11,
              spaceId: 2,
              spaceName: '팀',
              folderId: 5,
              name: '계획.pdf',
              mimeType: 'application/pdf',
              folderPath: '문서/2026',
              snippet: null,
            },
            {
              kind: 'FOLDER',
              id: 12,
              spaceId: 2,
              spaceName: '팀',
              folderId: null,
              name: '계획',
              mimeType: null,
              folderPath: '',
              snippet: null,
            },
          ],
          hasMore: true,
        })
      }),
    )
    const page = await providers().drive.fetchPage('계획', null, 20)
    expect(seen[0].get('q')).toBe('계획')
    expect(seen[0].get('offset')).toBe('0')
    expect(seen[0].get('size')).toBe('20')
    expect(page.hits[0]).toMatchObject({
      meta: '팀 › 문서/2026',
      href: '/drive/spaces/2?folderId=5&preview=11',
    })
    expect(page.hits[1]).toMatchObject({
      meta: '팀',
      href: '/drive/spaces/2?folderId=12',
    })
    // 이름이 맞은 결과는 둘째 줄이 없다.
    expect(page.hits[0].snippet).toBeUndefined()
    expect(page.hits[0].snippetLabel).toBeUndefined()
    expect(page.next).toBe(20)
  })

  it('본문만 맞은 파일(WP-1356)은 둘째 줄에 「본문」 발췌를 단다', async () => {
    server.use(
      http.get(`${API}/search/drive`, () =>
        HttpResponse.json({
          items: [
            {
              kind: 'FILE',
              id: 21,
              spaceId: 2,
              spaceName: '팀',
              folderId: null,
              name: '보고서.docx',
              mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              folderPath: '',
              snippet: '…올해 계획 은 다음과 같다…',
            },
          ],
          hasMore: false,
        }),
      ),
    )
    const page = await providers().drive.fetchPage('계획', null, 20)
    expect(page.hits[0]).toMatchObject({
      key: 'drive:FILE:21',
      title: '보고서.docx',
      href: '/drive/spaces/2?preview=21',
      snippet: '…올해 계획 은 다음과 같다…',
      snippetLabel: '본문',
    })
    expect(page.next).toBeNull()
  })
})

describe('mail', () => {
  const stamp = (n: number) => `2026-03-01T00:${String(n).padStart(2, '0')}:00.123456Z`

  it('q·size 를 보내고 메일함 · 사람을 meta 로, 날짜를 time 으로 둔다', async () => {
    const seen: URLSearchParams[] = []
    server.use(
      http.get(`${API}/search/mail`, ({ request }) => {
        seen.push(new URL(request.url).searchParams)
        return HttpResponse.json({
          items: [
            mail(1, 1, stamp(30), { fromName: '김하나' }),
            mail(2, 1, stamp(20), {
              folderKind: 'SENT',
              folderName: '보낸편지함',
              firstRecipient: '박둘',
              recipientCount: 3,
            }),
            mail(3, 2, stamp(10), { folderKind: 'SENT', folderName: '보낸편지함', firstRecipient: 'c@x.com', recipientCount: 1 }),
            mail(4, 2, null, { folderKind: 'OTHER', folderId: 9, folderName: '거래처', subject: '  ' }),
          ],
          hasMore: false,
        })
      }),
    )
    const page = await providers().mail.fetchPage('회의', null, 20)
    expect(seen[0].get('q')).toBe('회의')
    expect(seen[0].get('size')).toBe('20')
    expect(seen[0].has('beforeId')).toBe(false)
    expect(page.hits.map((h) => h.key)).toEqual(['mail:1', 'mail:2', 'mail:3', 'mail:4'])
    expect(page.hits.map((h) => h.meta)).toEqual([
      '받은편지함 · 김하나',
      '보낸편지함 · 받는 사람 박둘 외 2명',
      '보낸편지함 · 받는 사람 c@x.com',
      '거래처 · a2@x.com',
    ])
    expect(page.hits.map((h) => h.href)).toEqual([
      '/mail/1?messageId=1',
      '/mail/1?folder=sent&messageId=2',
      '/mail/2?folder=sent&messageId=3',
      '/mail/2?box=9&messageId=4',
    ])
    expect(page.hits[0].time).toBe(formatListTime(stamp(30)))
    expect(page.hits[0].snippet).toBe('미리 1')
    expect(page.hits[3].time).toBeUndefined()
    expect(page.hits[3].title).toBe('(제목 없음)')
    expect(page.next).toBeNull()
  })

  it('hasMore 면 마지막 항목의 (receivedAt 문자열 그대로, id) 로 다음 쪽을 이어 받는다', async () => {
    const seen: URLSearchParams[] = []
    server.use(
      http.get(`${API}/search/mail`, ({ request }) => {
        const u = new URL(request.url).searchParams
        seen.push(u)
        return u.get('beforeId')
          ? HttpResponse.json({ items: [mail(3, 1, stamp(10))], hasMore: false })
          : HttpResponse.json({ items: [mail(5, 1, stamp(30)), mail(4, 2, stamp(20))], hasMore: true })
      }),
    )
    const p1 = await providers().mail.fetchPage('회의', null, 2)
    expect(p1.next).toEqual({ beforeAt: stamp(20), beforeId: 4 })
    const p2 = await providers().mail.fetchPage('회의', p1.next, 2)
    expect(seen[1].get('beforeAt')).toBe(stamp(20))
    expect(seen[1].get('beforeId')).toBe('4')
    expect(p2.hits.map((h) => h.key)).toEqual(['mail:3'])
    expect(p2.next).toBeNull()
  })

  it('수신 시각이 없는 마지막 항목이면 beforeAt 없이 beforeId 만 보낸다', async () => {
    const seen: URLSearchParams[] = []
    server.use(
      http.get(`${API}/search/mail`, ({ request }) => {
        seen.push(new URL(request.url).searchParams)
        return HttpResponse.json({ items: [mail(7, 1, null)], hasMore: true })
      }),
    )
    const p1 = await providers().mail.fetchPage('회의', null, 1)
    await providers().mail.fetchPage('회의', p1.next, 1)
    expect(seen[1].has('beforeAt')).toBe(false)
    expect(seen[1].get('beforeId')).toBe('7')
  })

  it('결과가 없으면 빈 쪽', async () => {
    server.use(http.get(`${API}/search/mail`, () => HttpResponse.json({ items: [], hasMore: false })))
    expect(await providers().mail.fetchPage('x1', null, 20)).toEqual({ hits: [], next: null })
  })

  it('API 가 500 이면 거부된다', async () => {
    server.use(http.get(`${API}/search/mail`, () => new HttpResponse(null, { status: 500 })))
    await expect(providers().mail.fetchPage('회의', null, 20)).rejects.toThrow()
  })
})

/** 메시지 검색 결과 한 건 — 서버 응답 모양. */
function msg(id: number, extra: object = {}) {
  return {
    id,
    channelId: 1,
    channelKind: 'CHANNEL',
    channelName: '개발-공지',
    parentMessageId: null,
    authorName: '김보고',
    authorKind: 'HUMAN',
    excerpt: `개발 메시지 ${id}`,
    createdAt: '2026-03-01T00:00:00.123456Z',
    ...extra,
  }
}

/** 메시지 검색 API 가짜 — 요청 쿼리(beforeAt·beforeId·size)를 남기고 정해 둔 쪽을 순서대로 돌려준다. */
function messagesServer(pages: { items: object[]; hasMore: boolean }[], seen: URLSearchParams[] = []) {
  let n = 0
  return http.get(`${API}/search/messages`, ({ request }) => {
    seen.push(new URL(request.url).searchParams)
    return HttpResponse.json(pages[Math.min(n++, pages.length - 1)])
  })
}

/** 이름 결과용 메시징 목록 가짜 — 기본은 빈 목록. */
function namesServer(channels: object[] = [], dms: object[] = [], discovered: object[] = []) {
  return [
    http.get(`${API}/messaging/channels/discover`, () => HttpResponse.json(discovered)),
    http.get(`${API}/messaging/channels`, () => HttpResponse.json(channels)),
    http.get(`${API}/messaging/dms`, () => HttpResponse.json(dms)),
  ]
}

describe('chat', () => {
  it('내 채널·DM 을 discover 보다 먼저, 내 채널은 discover 에서 중복 제거', async () => {
    server.use(
      ...namesServer(
        [
          { id: 1, name: '개발-공지', member: true, archived: false },
          { id: 3, name: '디자인', member: true, archived: false },
        ],
        [
          {
            id: 9,
            participants: [
              { userId: 5, name: '나' },
              { userId: 6, name: '개발자 김' },
            ],
          },
        ],
        [
          { id: 1, name: '개발-공지', member: false },
          { id: 2, name: '개발-공개', member: false },
        ],
      ),
      messagesServer([{ items: [], hasMore: false }]),
    )
    const page = await providers().chat.fetchPage('개발', null, 20)
    expect(page.hits.map((h) => [h.key, h.meta, h.group])).toEqual([
      ['chat:channel:1', '참여 중', '채널·DM'],
      ['chat:dm:9', '참여 중', '채널·DM'],
      ['chat:channel:2', '공개', '채널·DM'],
    ])
    expect(page.hits[1]).toMatchObject({
      title: '개발자 김',
      href: '/chat/dms/9',
    })
    expect(page.next).toBeNull()
  })

  it('이름 결과 뒤에 메시지 결과를 잇는다 — 보낸 사람·발췌·# 채널/DM 상대 이름·시각·딥링크', async () => {
    server.use(
      ...namesServer([{ id: 1, name: '개발-공지', member: true, archived: false }]),
      messagesServer([
        {
          items: [
            msg(11, { channelId: 2, channelKind: 'DM', channelName: '김보고', excerpt: '…개발 자료 공유…' }),
            msg(8, { parentMessageId: 7, authorName: '에이전트', authorKind: 'AGENT' }),
          ],
          hasMore: false,
        },
      ]),
    )
    const page = await providers().chat.fetchPage('개발', null, 20)
    expect(page.hits.map((h) => [h.key, h.group])).toEqual([
      ['chat:channel:1', '채널·DM'],
      ['chat:message:11', '메시지'],
      ['chat:message:8', '메시지'],
    ])
    expect(page.hits[1]).toMatchObject({
      title: '…개발 자료 공유…',
      sender: '김보고',
      meta: '김보고',
      href: '/chat/dms/2?message=11',
      time: formatListTime('2026-03-01T00:00:00.123456Z'),
    })
    // 스레드 답글은 루트로 스레드 칸까지 연다. 채널은 「# 이름」.
    expect(page.hits[2]).toMatchObject({
      sender: '에이전트',
      meta: '# 개발-공지',
      href: '/chat/channels/1?thread=7&message=8',
    })
    expect(page.next).toBeNull()
  })
})

describe('chat 다음 쪽', () => {
  it('다음 쪽은 이름 목록을 다시 받지 않고 메시지만 마지막 행의 createdAt(받은 문자열 그대로)·id 로 이어 받는다', async () => {
    let nameCalls = 0
    const count = (body: JsonBodyType) => () => {
      nameCalls++
      return HttpResponse.json(body)
    }
    const seen: URLSearchParams[] = []
    server.use(
      http.get(`${API}/messaging/channels/discover`, count([])),
      http.get(`${API}/messaging/channels`, count([{ id: 1, name: '팀-1', member: true, archived: false }])),
      http.get(`${API}/messaging/dms`, count([])),
      messagesServer(
        [
          { items: [msg(30, { excerpt: '팀 30' }), msg(20, { excerpt: '팀 20', createdAt: '2026-03-01T00:00:00.654321Z' })], hasMore: true },
          { items: [msg(10, { excerpt: '팀 10' })], hasMore: false },
        ],
        seen,
      ),
    )
    const p1 = await providers().chat.fetchPage('팀', null, 2)
    expect(p1.hits.map((h) => h.key)).toEqual(['chat:channel:1', 'chat:message:30', 'chat:message:20'])
    expect(p1.next).not.toBeNull()
    const callsAfterFirst = nameCalls
    const p2 = await providers().chat.fetchPage('팀', p1.next, 2)
    expect(nameCalls).toBe(callsAfterFirst)
    expect(p2.hits.map((h) => h.key)).toEqual(['chat:message:10'])
    expect(p2.next).toBeNull()
    expect(seen[0].get('beforeAt')).toBeNull()
    expect(seen[1].get('beforeAt')).toBe('2026-03-01T00:00:00.654321Z')
    expect(seen[1].get('beforeId')).toBe('20')
    expect(seen[1].get('size')).toBe('2')
  })
})

describe('pickGroupHits', () => {
  const h = (key: string, group?: string) => ({ key, app: 'chat' as const, title: key, href: '/', group })
  const names = ['a', 'b', 'c'].map((k) => h(k, '채널·DM'))
  const messages = ['m1', 'm2', 'm3'].map((k) => h(k, '메시지'))

  it('대화 묶음은 이름 2 + 메시지 1', () => {
    expect(pickGroupHits('chat', [...names, ...messages]).map((x) => x.key)).toEqual(['a', 'b', 'm1'])
  })
  it('메시지가 없으면 이름 3건, 메시지는 이름이 적어도 1건까지만', () => {
    expect(pickGroupHits('chat', names).map((x) => x.key)).toEqual(['a', 'b', 'c'])
    expect(pickGroupHits('chat', messages).map((x) => x.key)).toEqual(['m1'])
    expect(pickGroupHits('chat', [names[0], ...messages]).map((x) => x.key)).toEqual(['a', 'm1'])
  })
  it('다른 묶음은 group 이 있어도 앞 3건(캘린더 소제목)', () => {
    const cal = [h('x', '다가오는 일정'), h('y', '지난 일정'), h('z', '지난 일정'), h('w', '지난 일정')]
    expect(pickGroupHits('calendar', cal).map((x) => x.key)).toEqual(['x', 'y', 'z'])
  })
})

describe('취소·오류', () => {
  it('취소된 signal 이면 메일 요청이 중단돼 거부된다(signal 이 axios 까지 전달)', async () => {
    server.use(http.get(`${API}/search/mail`, () => HttpResponse.json({ items: [], hasMore: false })))
    const ctrl = new AbortController()
    ctrl.abort()
    await expect(providers().mail.fetchPage('회의', null, 20, ctrl.signal)).rejects.toThrow()
  })

  it('API 가 500 이면 provider 가 거부된다', async () => {
    server.use(http.get(`${API}/search/drive`, () => new HttpResponse(null, { status: 500 })))
    await expect(providers().drive.fetchPage('계획', null, 20)).rejects.toThrow()
  })
})

describe('issues', () => {
  it('첫 쪽에는 프로젝트가 이슈 앞에 오고, 다음 쪽은 이슈만', async () => {
    let projectCalls = 0
    server.use(
      http.get(`${API}/projects`, () => {
        projectCalls++
        return HttpResponse.json({
          content: [
            { id: 1, key: 'WP', name: '워크플레이스' },
            { id: 2, key: 'ZZ', name: '기타' },
          ],
          page: 0,
          size: 100,
          totalElements: 2,
          totalPages: 1,
        })
      }),
      http.get(`${API}/me/issues`, ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor')
        return HttpResponse.json({
          items: [
            {
              id: 50,
              projectKey: 'WP',
              number: 7,
              title: '검색 만들기',
              statusName: '진행 중',
            },
          ],
          nextCursor: cursor ? null : 'c2',
          hasMore: !cursor,
        })
      }),
    )
    const p1 = await providers().issues.fetchPage('wp', null, 20)
    expect(p1.hits.map((h) => h.key)).toEqual(['issues:project:WP', 'issues:issue:50'])
    expect(p1.hits[0]).toMatchObject({
      meta: '프로젝트',
      href: '/projects/WP',
    })
    expect(p1.hits[1]).toMatchObject({
      title: 'WP-7 검색 만들기',
      meta: '진행 중',
      href: '/projects/WP/issues/7',
    })
    expect(p1.next).toBe('c2')
    const p2 = await providers().issues.fetchPage('wp', p1.next, 20)
    expect(p2.hits.map((h) => h.key)).toEqual(['issues:issue:50'])
    expect(p2.next).toBeNull()
    expect(projectCalls).toBe(1)
  })
})

describe('ai', () => {
  const ID = '11111111-1111-4111-8111-111111111111'

  it('/search/ai-conversations 를 부르고 질문·답 접두·빈 제목 대체·time·href 를 만든다', async () => {
    const seen: URLSearchParams[] = []
    server.use(
      http.get(`${API}/search/ai-conversations`, ({ request }) => {
        seen.push(new URL(request.url).searchParams)
        return HttpResponse.json({
          items: [
            { sessionId: ID, title: '배포 질문', lastMessageAt: '2020-01-02T03:00:00Z', role: 'USER', excerpt: '배포 어떻게 해요' },
            { sessionId: '22222222-2222-4222-8222-222222222222', title: '  ', lastMessageAt: '2020-01-02T03:00:00Z', role: 'ASSISTANT', excerpt: '배포는 이렇게' },
          ],
          hasMore: true,
        })
      }),
    )
    const page = await providers().ai.fetchPage('배포', null, 20)
    expect(seen[0].get('q')).toBe('배포')
    expect(seen[0].get('offset')).toBe('0')
    expect(seen[0].get('size')).toBe('20')
    expect(page.hits[0]).toMatchObject({
      key: `ai:${ID}`,
      app: 'ai',
      title: '배포 질문',
      href: `/?aiChat=${ID}`,
      snippet: '질문 · 배포 어떻게 해요',
      time: '2020. 1. 2.',
    })
    expect(page.hits[1]).toMatchObject({ title: '지난 대화', snippet: '답 · 배포는 이렇게' })
    expect(page.next).toBe(20)
  })

  it('다음 쪽은 offset 을 이어 받고 hasMore 가 false 면 next 가 null', async () => {
    const offsets: string[] = []
    server.use(
      http.get(`${API}/search/ai-conversations`, ({ request }) => {
        offsets.push(new URL(request.url).searchParams.get('offset') ?? '')
        return HttpResponse.json({ items: [], hasMore: false })
      }),
    )
    const page = await providers().ai.fetchPage('배포', 20, 20)
    expect(offsets).toEqual(['20'])
    expect(page).toEqual({ hits: [], next: null })
  })
})

describe('calendar', () => {
  const row = (id: number, extra: object = {}) => ({
    id,
    title: `주간 회의 ${id}`,
    startsAt: '2026-11-06T01:00:00Z',
    endsAt: '2026-11-06T02:00:00Z',
    allDay: false,
    location: null,
    calendarName: '내 캘린더',
    calendarColor: 'blue',
    recurrenceRule: null,
    occurrenceStart: '2026-11-06T01:00:00Z',
    past: false,
    matchedField: 'TITLE',
    matchedText: null,
    ...extra,
  })

  it('q·cursor·limit 쿼리를 보내고 일정 경로 hit 으로 바꾸며 nextCursor 를 next 로 돌려준다', async () => {
    const seen: URLSearchParams[] = []
    server.use(
      http.get(`${API}/calendar/events/search`, ({ request }) => {
        const sp = new URL(request.url).searchParams
        seen.push(sp)
        return HttpResponse.json(
          sp.get('cursor')
            ? { items: [row(3, { past: true })], nextCursor: null, truncated: false }
            : { items: [row(1), row(2, { matchedField: 'LOCATION', matchedText: '판교' })], nextCursor: '20', truncated: false },
        )
      }),
    )
    const p1 = await providers().calendar.fetchPage('주간', null, 20)
    expect(Object.fromEntries(seen[0])).toEqual({ q: '주간', limit: '20' })
    expect(p1.hits.map((h) => h.key)).toEqual(['calendar:1', 'calendar:2'])
    expect(p1.hits[0]).toMatchObject({ title: '주간 회의 1', href: '/calendar?eventId=1', app: 'calendar' })
    expect(p1.hits[1]).toMatchObject({ snippet: '판교', snippetLabel: '장소' })
    expect(p1.next).toBe('20')
    const p2 = await providers().calendar.fetchPage('주간', p1.next, 20)
    expect(seen[1].get('cursor')).toBe('20')
    expect(p2.hits[0]).toMatchObject({ key: 'calendar:3', dimmed: true })
    expect(p2.next).toBeNull()
  })
})

describe('issues 프로젝트 상한', () => {
  const manyProjects = () =>
    http.get(`${API}/projects`, () =>
      HttpResponse.json({
        content: [1, 2, 3].map((n) => ({
          id: n,
          key: `P${n}`,
          name: `검색 프로젝트 ${n}`,
        })),
        page: 0,
        size: 100,
        totalElements: 3,
        totalPages: 1,
      }),
    )
  const issueRows = http.get(`${API}/me/issues`, () =>
    HttpResponse.json({
      items: [
        {
          id: 50,
          projectKey: 'WP',
          number: 7,
          title: '검색',
          statusName: '열림',
        },
      ],
      nextCursor: null,
      hasMore: false,
    }),
  )

  it('size=4 이고 프로젝트가 3개 맞아도 프로젝트는 2개까지, 이슈가 같이 나온다', async () => {
    server.use(manyProjects(), issueRows)
    const page = await providers().issues.fetchPage('검색', null, 4)
    const projects = page.hits.filter((h) => h.key.startsWith('issues:project:'))
    expect(projects).toHaveLength(2)
    expect(page.hits.some((h) => h.key === 'issues:issue:50')).toBe(true)
  })

  it('queryClient 를 주면 검색어가 달라도 프로젝트 목록은 한 번만 받는다', async () => {
    let calls = 0
    server.use(
      http.get(`${API}/projects`, () => {
        calls += 1
        return HttpResponse.json({
          content: [],
          page: 0,
          size: 100,
          totalElements: 0,
          totalPages: 1,
        })
      }),
      issueRows,
    )
    const qc = new QueryClient()
    const p = providers(qc)
    await p.issues.fetchPage('가나', null, 20)
    await p.issues.fetchPage('가나다', null, 20)
    expect(calls).toBe(1)
  })
})

describe('dedupeHits', () => {
  it('같은 key 는 처음 것만 남긴다', () => {
    const h = (key: string, title: string) => ({
      key,
      app: 'wiki' as const,
      title,
      href: '/',
    })
    expect(dedupeHits([h('a', '1'), h('b', '2'), h('a', '3')]).map((x) => x.title)).toEqual(['1', '2'])
  })
})

describe('isSearchable', () => {
  it('한 글자 번호는 이슈만 통과, 그 밖의 앱은 공백 뺀 두 글자부터', () => {
    const p = providers()
    expect(p.issues.isSearchable('7')).toBe(true)
    expect(p.issues.isSearchable('#7')).toBe(true)
    expect(p.issues.isSearchable('가')).toBe(false)
    for (const app of ['ai', 'chat', 'mail', 'calendar', 'drive', 'wiki', 'contacts'] as const) {
      expect(p[app].isSearchable('7')).toBe(false)
      expect(p[app].isSearchable('#7')).toBe(true) // 두 글자
      expect(p[app].isSearchable(' 7 ')).toBe(false)
      expect(p[app].isSearchable('가나')).toBe(true)
    }
  })
})

describe('wiki snippet', () => {
  it('서버 snippet 의 HTML 태그는 provider 가 벗겨 평문으로 낸다', async () => {
    server.use(
      http.get(`${API}/wiki/search`, () =>
        HttpResponse.json([
          {
            id: 7,
            spaceId: 3,
            spaceName: '개발',
            title: 't',
            snippet: '…<b>배포</b> &amp; 롤백…',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ]),
      ),
    )
    const page = await providers().wiki.fetchPage('배포', null, 20)
    expect(page.hits[0].snippet).toBe('…배포 & 롤백…')
  })
})
