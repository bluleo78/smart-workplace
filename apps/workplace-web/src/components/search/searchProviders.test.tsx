// 통합 검색(WP-1353)의 앱별 provider — 기존 API 를 MSW 로 가로채 쿼리·합치기·이어 받기를 지킨다.
// dom 프로젝트(MSW 셋업)에서 돌도록 .tsx 다 — 화면은 없다.
import { http, HttpResponse, type JsonBodyType } from 'msw'
import { describe, expect, it } from 'vitest'

import { server } from '@/test/msw/server'

import { SEARCH_PROVIDERS } from './searchProviders'

const API = '/api/v1'

/** 메일 한 통 — 목록 API 가 주는 모양 중 provider 가 읽는 것만. */
function mail(id: number, accountId: number, receivedAt: string, extra: object = {}) {
  return { id, accountId, subject: `메일 ${id}`, fromName: null, fromAddress: `a${accountId}@x.com`, snippet: `미리 ${id}`, receivedAt, ...extra }
}

describe('wiki', () => {
  it('size·offset 쿼리를 보내고 노트 경로를 바로 만든다, 꽉 찬 쪽이면 다음 offset', async () => {
    const seen: URLSearchParams[] = []
    server.use(
      http.get(`${API}/wiki/search`, ({ request }) => {
        seen.push(new URL(request.url).searchParams)
        return HttpResponse.json([
          { id: 7, spaceId: 3, spaceName: '개발', title: '배포 가이드', snippet: '…배포…', updatedAt: '2026-01-01T00:00:00Z' },
          { id: 8, spaceId: 3, spaceName: '개발', title: '배포 체크', snippet: '…', updatedAt: '2026-01-01T00:00:00Z' },
        ])
      }),
    )
    const page = await SEARCH_PROVIDERS.wiki.fetchPage('배포', 20, 2)
    expect(seen[0].get('q')).toBe('배포')
    expect(seen[0].get('size')).toBe('2')
    expect(seen[0].get('offset')).toBe('20')
    expect(page.hits[0]).toMatchObject({ key: 'wiki:7', href: '/wiki/spaces/3/pages/7', meta: '개발', snippet: '…배포…' })
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
            { kind: 'FILE', id: 11, spaceId: 2, spaceName: '팀', folderId: 5, name: '계획.pdf', mimeType: 'application/pdf', folderPath: '문서/2026' },
            { kind: 'FOLDER', id: 12, spaceId: 2, spaceName: '팀', folderId: null, name: '계획', mimeType: null, folderPath: '' },
          ],
          hasMore: true,
        })
      }),
    )
    const page = await SEARCH_PROVIDERS.drive.fetchPage('계획', null, 20)
    expect(seen[0].get('q')).toBe('계획')
    expect(seen[0].get('offset')).toBe('0')
    expect(seen[0].get('size')).toBe('20')
    expect(page.hits[0]).toMatchObject({ meta: '팀 › 문서/2026', href: '/drive/spaces/2?folderId=5&preview=11' })
    expect(page.hits[1]).toMatchObject({ meta: '팀', href: '/drive/spaces/2?folderId=12' })
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
    const page = await SEARCH_PROVIDERS.mail.fetchPage('회의', null, 20)
    expect(page.hits.map((h) => h.key)).toEqual(['mail:2', 'mail:3', 'mail:1'])
    expect(page.hits[2].meta).toBe('김하나')
    expect(page.hits[0].meta).toBe('a1@x.com')
    expect(page.hits[0].href).toBe('/mail/1?messageId=2')
    expect(page.next).toBeNull()
  })

  it('계정이 없으면 빈 쪽', async () => {
    server.use(http.get(`${API}/mail/accounts`, () => HttpResponse.json([])))
    expect(await SEARCH_PROVIDERS.mail.fetchPage('x1', null, 20)).toEqual({ hits: [], next: null })
  })

  it('A 25건이 B 5건보다 모두 최신이면 1쪽 A 20건, 2쪽 A 남은 5 + B 5, 빠짐·중복 없이 끝난다', async () => {
    const a = Array.from({ length: 25 }, (_, i) => mail(100 + i, 1, stamp(59 - i)))
    const b = Array.from({ length: 5 }, (_, i) => mail(200 + i, 2, stamp(20 - i)))
    mailServer({ 1: a, 2: b })
    const p1 = await SEARCH_PROVIDERS.mail.fetchPage('회의', null, 20)
    expect(p1.hits).toHaveLength(20)
    expect(p1.hits.every((h) => h.key.startsWith('mail:1'))).toBe(true)
    expect(p1.next).not.toBeNull()
    const p2 = await SEARCH_PROVIDERS.mail.fetchPage('회의', p1.next, 20)
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
        HttpResponse.json([{ id: 9, participants: [{ userId: 5, name: '나' }, { userId: 6, name: '개발자 김' }] }]),
      ),
      http.get(`${API}/auth/me`, () => HttpResponse.json({ id: 5, name: '나' })),
    )
    const page = await SEARCH_PROVIDERS.chat.fetchPage('개발', null, 20)
    expect(page.hits.map((h) => [h.key, h.meta])).toEqual([
      ['chat:channel:1', '참여 중'],
      ['chat:dm:9', '참여 중'],
      ['chat:channel:2', '공개'],
    ])
    expect(page.hits[1]).toMatchObject({ title: '개발자 김', href: '/chat/dms/9' })
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
      http.get(`${API}/messaging/channels`, count([1, 2, 3].map((id) => ({ id, name: `팀-${id}`, member: true, archived: false })))),
      http.get(`${API}/messaging/dms`, count([])),
      http.get(`${API}/auth/me`, count({ id: 5, name: '나' })),
    )
    const p1 = await SEARCH_PROVIDERS.chat.fetchPage('팀', null, 2)
    expect(p1.hits.map((h) => h.key)).toEqual(['chat:channel:1', 'chat:channel:2'])
    expect(p1.next).not.toBeNull()
    const callsAfterFirst = calls
    const p2 = await SEARCH_PROVIDERS.chat.fetchPage('팀', p1.next, 2)
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
    await expect(SEARCH_PROVIDERS.mail.fetchPage('회의', null, 20, ctrl.signal)).rejects.toThrow()
  })

  it('API 가 500 이면 provider 가 거부된다', async () => {
    server.use(http.get(`${API}/search/drive`, () => new HttpResponse(null, { status: 500 })))
    await expect(SEARCH_PROVIDERS.drive.fetchPage('계획', null, 20)).rejects.toThrow()
  })
})

describe('issues', () => {
  it('첫 쪽에는 프로젝트가 이슈 앞에 오고, 다음 쪽은 이슈만', async () => {
    let projectCalls = 0
    server.use(
      http.get(`${API}/projects`, () => {
        projectCalls++
        return HttpResponse.json({ content: [{ id: 1, key: 'WP', name: '워크플레이스' }, { id: 2, key: 'ZZ', name: '기타' }], page: 0, size: 100, totalElements: 2, totalPages: 1 })
      }),
      http.get(`${API}/me/issues`, ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor')
        return HttpResponse.json({
          items: [{ id: 50, projectKey: 'WP', number: 7, title: '검색 만들기', statusName: '진행 중' }],
          nextCursor: cursor ? null : 'c2',
          hasMore: !cursor,
        })
      }),
    )
    const p1 = await SEARCH_PROVIDERS.issues.fetchPage('wp', null, 20)
    expect(p1.hits.map((h) => h.key)).toEqual(['issues:project:WP', 'issues:issue:50'])
    expect(p1.hits[0]).toMatchObject({ meta: '프로젝트', href: '/projects/WP' })
    expect(p1.hits[1]).toMatchObject({ title: 'WP-7 검색 만들기', meta: '진행 중', href: '/projects/WP/issues/7' })
    expect(p1.next).toBe('c2')
    const p2 = await SEARCH_PROVIDERS.issues.fetchPage('wp', p1.next, 20)
    expect(p2.hits.map((h) => h.key)).toEqual(['issues:issue:50'])
    expect(p2.next).toBeNull()
    expect(projectCalls).toBe(1)
  })
})

describe('ai·calendar', () => {
  it('늘 빈 쪽', async () => {
    expect(await SEARCH_PROVIDERS.ai.fetchPage('x1', null, 20)).toEqual({ hits: [], next: null })
    expect(await SEARCH_PROVIDERS.calendar.fetchPage('x1', null, 20)).toEqual({ hits: [], next: null })
  })
})
