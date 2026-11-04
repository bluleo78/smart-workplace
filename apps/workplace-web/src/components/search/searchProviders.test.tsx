// 통합 검색(WP-1353)의 앱별 provider — 기존 API 를 MSW 로 가로채 쿼리·합치기·이어 받기를 지킨다.
// dom 프로젝트(MSW 셋업)에서 돌도록 .tsx 다 — 화면은 없다.
import { QueryClient } from '@tanstack/react-query'
import { http, HttpResponse, type JsonBodyType } from 'msw'
import { describe, expect, it } from 'vitest'

import { server } from '@/test/msw/server'

import { createSearchProviders, dedupeHits } from './searchProviders'

const API = '/api/v1'

/** 테스트용 provider 묶음 — 테스트마다 새 QueryClient(캐시 공유 없음)와 내 id 5. */
function providers(qc = new QueryClient(), meId: number | null = 5) {
  return createSearchProviders({ queryClient: qc, meId })
}

/** 메일 한 통 — 목록 API 가 주는 모양 중 provider 가 읽는 것만. */
function mail(id: number, accountId: number, receivedAt: string, extra: object = {}) {
  return {
    id,
    accountId,
    subject: `메일 ${id}`,
    fromName: null,
    fromAddress: `a${accountId}@x.com`,
    snippet: `미리 ${id}`,
    receivedAt,
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
    expect(page.next).toBe(20)
  })
})

describe('mail', () => {
  /** 계정별 받은편지함 — beforeId·beforeAt 이전 행만, 최신순, limit 건. */
  function mailServer(rows: Record<number, ReturnType<typeof mail>[]>) {
    server.use(
      http.get(`${API}/mail/accounts`, () => HttpResponse.json(Object.keys(rows).map((id) => ({ id: Number(id) })))),
      http.get(`${API}/mail/accounts/:id/messages`, ({ request, params }) => {
        const u = new URL(request.url).searchParams
        const limit = Number(u.get('limit'))
        const beforeId = u.get('beforeId')
        let list = [...rows[Number(params.id)]].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
        if (beforeId) {
          const at = list.findIndex((m) => m.id === Number(beforeId))
          list = list.slice(at + 1)
        }
        return HttpResponse.json(list.slice(0, limit))
      }),
    )
  }
  const stamp = (n: number) => `2026-03-01T00:${String(n).padStart(2, '0')}:00.000000Z`

  it('두 계정 결과를 최신순으로 합치고 보낸 사람을 meta 로 둔다', async () => {
    mailServer({
      1: [mail(1, 1, stamp(10), { fromName: '김하나' }), mail(2, 1, stamp(30))],
      2: [mail(3, 2, stamp(20))],
    })
    const page = await providers().mail.fetchPage('회의', null, 20)
    expect(page.hits.map((h) => h.key)).toEqual(['mail:2', 'mail:3', 'mail:1'])
    expect(page.hits[2].meta).toBe('김하나')
    expect(page.hits[0].meta).toBe('a1@x.com')
    expect(page.hits[0].href).toBe('/mail/1?messageId=2')
    expect(page.next).toBeNull()
  })

  it('계정이 없으면 빈 쪽', async () => {
    server.use(http.get(`${API}/mail/accounts`, () => HttpResponse.json([])))
    expect(await providers().mail.fetchPage('x1', null, 20)).toEqual({
      hits: [],
      next: null,
    })
  })

  it('A 25건이 B 5건보다 모두 최신이면 1쪽 A 20건, 2쪽 A 남은 5 + B 5, 빠짐·중복 없이 끝난다', async () => {
    const a = Array.from({ length: 25 }, (_, i) => mail(100 + i, 1, stamp(59 - i)))
    const b = Array.from({ length: 5 }, (_, i) => mail(200 + i, 2, stamp(20 - i)))
    mailServer({ 1: a, 2: b })
    const p1 = await providers().mail.fetchPage('회의', null, 20)
    expect(p1.hits).toHaveLength(20)
    expect(p1.hits.every((h) => h.key.startsWith('mail:1'))).toBe(true)
    expect(p1.next).not.toBeNull()
    const p2 = await providers().mail.fetchPage('회의', p1.next, 20)
    expect(p2.hits.map((h) => h.key)).toEqual([...a.slice(20), ...b].map((m) => `mail:${m.id}`))
    expect(p2.next).toBeNull()
    const keys = [...p1.hits, ...p2.hits].map((h) => h.key)
    expect(new Set(keys).size).toBe(30)
  })
})

describe('chat', () => {
  it('내 채널·DM 을 discover 보다 먼저, 내 채널은 discover 에서 중복 제거', async () => {
    server.use(
      http.get(`${API}/messaging/channels/discover`, () =>
        HttpResponse.json([
          { id: 1, name: '개발-공지', member: false },
          { id: 2, name: '개발-공개', member: false },
        ]),
      ),
      http.get(`${API}/messaging/channels`, () =>
        HttpResponse.json([
          { id: 1, name: '개발-공지', member: true, archived: false },
          { id: 3, name: '디자인', member: true, archived: false },
        ]),
      ),
      http.get(`${API}/messaging/dms`, () =>
        HttpResponse.json([
          {
            id: 9,
            participants: [
              { userId: 5, name: '나' },
              { userId: 6, name: '개발자 김' },
            ],
          },
        ]),
      ),
    )
    const page = await providers().chat.fetchPage('개발', null, 20)
    expect(page.hits.map((h) => [h.key, h.meta])).toEqual([
      ['chat:channel:1', '참여 중'],
      ['chat:dm:9', '참여 중'],
      ['chat:channel:2', '공개'],
    ])
    expect(page.hits[1]).toMatchObject({
      title: '개발자 김',
      href: '/chat/dms/9',
    })
    expect(page.next).toBeNull()
  })
})

describe('chat 다음 쪽', () => {
  it('첫 쪽에서 전체를 받아 두고 다음 쪽은 요청 없이 나머지를 자른다', async () => {
    let calls = 0
    const count = (body: JsonBodyType) => () => {
      calls++
      return HttpResponse.json(body)
    }
    server.use(
      http.get(`${API}/messaging/channels/discover`, count([])),
      http.get(
        `${API}/messaging/channels`,
        count(
          [1, 2, 3].map((id) => ({
            id,
            name: `팀-${id}`,
            member: true,
            archived: false,
          })),
        ),
      ),
      http.get(`${API}/messaging/dms`, count([])),
    )
    const p1 = await providers().chat.fetchPage('팀', null, 2)
    expect(p1.hits.map((h) => h.key)).toEqual(['chat:channel:1', 'chat:channel:2'])
    expect(p1.next).not.toBeNull()
    const callsAfterFirst = calls
    const p2 = await providers().chat.fetchPage('팀', p1.next, 2)
    expect(calls).toBe(callsAfterFirst)
    expect(p2.hits.map((h) => h.key)).toEqual(['chat:channel:3'])
    expect(p2.next).toBeNull()
  })
})

describe('취소·오류', () => {
  it('취소된 signal 이면 메일 요청이 중단돼 거부된다(signal 이 axios 까지 전달)', async () => {
    server.use(http.get(`${API}/mail/accounts`, () => HttpResponse.json([{ id: 1 }])))
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
  it('늘 빈 쪽', async () => {
    expect(await providers().ai.fetchPage('x1', null, 20)).toEqual({
      hits: [],
      next: null,
    })
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

describe('mail 계정 일부 실패', () => {
  it('한 계정이 500 이어도 다른 계정 결과는 나오고, 실패 계정은 끝으로 표시되지 않는다', async () => {
    server.use(
      http.get(`${API}/mail/accounts`, () => HttpResponse.json([{ id: 1 }, { id: 2 }])),
      http.get(`${API}/mail/accounts/:id/messages`, ({ params }) =>
        params.id === '1' ? new HttpResponse(null, { status: 500 }) : HttpResponse.json([mail(5, 2, '2026-03-01T00:10:00.000000Z')]),
      ),
    )
    const page = await providers().mail.fetchPage('회의', null, 20)
    expect(page.hits.map((h) => h.key)).toEqual(['mail:5'])
    // 계정 1 은 아직 못 읽었으므로 다음 쪽이 남아 있다.
    expect(page.next).not.toBeNull()
    expect((page.next as Record<number, unknown>)[1]).toBeUndefined()
    expect((page.next as Record<number, unknown>)[2]).toBe('done')
  })

  it('모든 계정이 실패하면 거부된다', async () => {
    server.use(
      http.get(`${API}/mail/accounts`, () => HttpResponse.json([{ id: 1 }, { id: 2 }])),
      http.get(`${API}/mail/accounts/:id/messages`, () => new HttpResponse(null, { status: 500 })),
    )
    await expect(providers().mail.fetchPage('회의', null, 20)).rejects.toThrow()
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
