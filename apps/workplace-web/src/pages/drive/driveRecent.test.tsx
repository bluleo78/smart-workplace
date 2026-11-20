// 드라이브 「최근」(WP-1699) — 화면 컴포넌트 테스트(renderScreen + MSW).
// 날짜 묶음·마지막 활동 문구·경로 줄, 빈 상태, 다음 쪽(cursor), 행 별표 단추(WP-1698 별표 API), ⋯ 「파일 위치 열기」 이동, 사이드바 입구 순서를 본다.
import { act, screen, waitFor, within } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { AIAssistantProvider } from '@/components/ai/AIAssistantContext'
import { DriveSidebar } from '@/components/drive/DriveSidebar'
import { driveKeys } from '@/hooks/queries/driveKeys'
import { fileSideHandlers } from '@/test/kits/drive/testkit-b6'
import { controlIntersection } from '@/test/kits/layout'
import { clickRetryAndExpectErrorKept, gate } from '@/test/loadErrorRetry'
import { renderScreen } from '@/test/renderScreen'
import type { DriveRecentFile, DriveRecentPage, DriveSpace, DriveStarTarget } from '@/types/drive'

import { DriveRecentView } from './DriveRecentView'

// 실제 a[download] 클릭은 happy-dom 주소를 blob: 으로 바꿔 뒤 테스트를 깨므로 끊는다 — 요청 여부만 본다.
vi.mock('@/lib/download', () => ({ downloadBlob: vi.fn() }))

// 지금 시각을 KST 낮 15시로 고정한다(WP-1759 — vitest 는 TZ=Asia/Seoul) — 「오늘/어제」 묶음은 달력 날짜로 가르므로, 자정 직후(00시대)에 돌면
// 「1시간 전」이 어제로 넘어가 「어제 23:09 내가 올림」이 나와 깨졌다(push 게이트가 이 시간대에 늘 실패). Date 만 가짜로 둔다 —
// 타이머는 진짜라 MSW·React Query·waitFor 는 그대로 돈다.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 5, 10, 15, 0, 0))
})
afterEach(() => {
  vi.useRealTimers()
})

/** 고정한 지금 기준 lastAt — 묶음·문구가 시각에 맞게 나오도록 상대값으로 만든다. */
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

function recent(id: number, patch: Partial<DriveRecentFile> = {}): DriveRecentFile {
  return {
    driveFileId: id, name: `파일${id}.txt`, mimeType: 'text/plain', sizeBytes: 1_258_291, spaceId: 7, spaceName: '기획팀',
    folderId: 42, folderPath: [{ id: 40, name: '위' }, { id: 42, name: '아래' }], lastAction: 'OPEN', lastAt: ago(5_000), ...patch,
  }
}

const recentHandler = (page: DriveRecentPage) => http.get('/api/v1/drive/recent', () => HttpResponse.json(page))

describe('최근 화면', () => {
  test('두 줄 응답 → 「오늘」 묶음에 이름·경로·크기·마지막 활동이 보인다', async () => {
    renderScreen(<DriveRecentView />, {
      path: '/drive/recent',
      handlers: [recentHandler({ items: [recent(1), recent(2, { lastAction: 'UPLOAD', lastAt: ago(3_600_000) })], nextCursor: null })],
    })
    const group = await screen.findByTestId('drive-recent-group-today')
    expect(group).toHaveTextContent('오늘')
    const row = await screen.findByTestId('drive-recent-row-1')
    expect(within(row).getByRole('button', { name: '파일1.txt' })).toBeInTheDocument()
    expect(row).toHaveTextContent('기획팀 › 위 › 아래 · 1.2 MB')
    expect(screen.getByTestId('drive-recent-activity-1')).toHaveTextContent('방금 내가 열었음')
    expect(screen.getByTestId('drive-recent-activity-2')).toHaveTextContent('1시간 전 내가 올림')
  })

  test('빈 응답 → 「최근 파일 없음」', async () => {
    renderScreen(<DriveRecentView />, { path: '/drive/recent', handlers: [recentHandler({ items: [], nextCursor: null })] })
    expect(await screen.findByTestId('drive-recent-empty')).toHaveTextContent('최근 파일 없음')
  })

  test('조회 실패 → 오류 안내', async () => {
    renderScreen(<DriveRecentView />, {
      path: '/drive/recent',
      handlers: [http.get('/api/v1/drive/recent', () => HttpResponse.json({ message: 'x' }, { status: 500 }))],
    })
    expect(await screen.findByTestId('drive-recent-error')).toBeInTheDocument()
  })

  test('nextCursor 가 있으면 센티널이 보일 때 cursor 로 다음 쪽을 받는다', async () => {
    const io = controlIntersection()
    const cursors: (string | null)[] = []
    renderScreen(<DriveRecentView />, {
      path: '/drive/recent',
      handlers: [
        http.get('/api/v1/drive/recent', ({ request }) => {
          const cursor = new URL(request.url).searchParams.get('cursor')
          cursors.push(cursor)
          return HttpResponse.json(cursor ? { items: [recent(2)], nextCursor: null } : { items: [recent(1)], nextCursor: 'c1' })
        }),
      ],
    })
    await screen.findByTestId('drive-recent-row-1')
    io.set(() => true)
    await screen.findByTestId('drive-recent-row-2')
    expect(cursors).toEqual([null, 'c1'])
  })

  test('이름을 누르면 ?preview 로 보기 창이 열리고, 닫으면 /drive/recent 목록 그대로이며 목록을 다시 받는다', async () => {
    let listCalls = 0
    const { user, location } = renderScreen(
      // 보기 창은 AI 진입점(useAssistant)을 쓰므로 앱 셸이 까는 Provider 로 감싼다(공간 화면 테스트와 같다).
      <AIAssistantProvider hotkeysEnabled={false}>
        <DriveRecentView />
      </AIAssistantProvider>,
      {
        path: '/drive/recent',
        handlers: [
          http.get('/api/v1/drive/recent', () => {
            listCalls += 1
            return HttpResponse.json({ items: [recent(1)], nextCursor: null })
          }),
          http.get('/api/v1/drive/files/1/content', () => new HttpResponse('본문', { headers: { 'Content-Type': 'text/plain' } })),
          ...fileSideHandlers(1),
        ],
      },
    )
    await user.click(await screen.findByRole('button', { name: '파일1.txt' }))
    await waitFor(() => expect(location()).toBe('/drive/recent?preview=1'))
    expect(await screen.findByTestId('attachment-viewer')).toBeInTheDocument()
    expect(listCalls).toBe(1)

    await user.keyboard('{Escape}')
    await waitFor(() => expect(location()).toBe('/drive/recent'))
    await waitFor(() => expect(screen.queryByTestId('attachment-viewer')).not.toBeInTheDocument())
    expect(screen.getByTestId('drive-recent-row-1')).toBeInTheDocument()
    // 닫을 때 목록을 무효화해 다시 받는다 — 연 파일이 서버에 「열기」로 기록돼 맨 위로 올라와야 한다.
    await waitFor(() => expect(listCalls).toBe(2))
  })

  test('별표 단추를 누르면 별표 API 를 부르고 켜진 모양이 된다', async () => {
    // 별표 API 핸들러는 WP-1698 「별표」 화면 테스트와 같은 모양(PUT·DELETE /drive/stars, 본문 {kind, id}, 204).
    const puts: DriveStarTarget[] = []
    const deletes: DriveStarTarget[] = []
    const { user } = renderScreen(<DriveRecentView />, {
      path: '/drive/recent',
      handlers: [
        recentHandler({ items: [recent(1, { starred: false })], nextCursor: null }),
        http.put('/api/v1/drive/stars', async ({ request }) => {
          puts.push((await request.json()) as DriveStarTarget)
          return new HttpResponse(null, { status: 204 })
        }),
        http.delete('/api/v1/drive/stars', async ({ request }) => {
          deletes.push((await request.json()) as DriveStarTarget)
          return new HttpResponse(null, { status: 204 })
        }),
      ],
    })
    const star = await screen.findByTestId('drive-recent-star-1')
    expect(star).toHaveAttribute('aria-pressed', 'false')
    expect(star).toHaveAccessibleName('파일1.txt 별표')
    await user.click(star)
    await waitFor(() => expect(puts).toEqual([{ kind: 'FILE', id: 1 }]))
    expect(screen.getByTestId('drive-recent-star-1')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('drive-recent-star-1')).toHaveAccessibleName('파일1.txt 별표 빼기')
    // 다시 누르면 뺀다 — 줄은 그대로 남는다(「최근」은 별표 목록이 아니다).
    await user.click(screen.getByTestId('drive-recent-star-1'))
    await waitFor(() => expect(deletes).toEqual([{ kind: 'FILE', id: 1 }]))
    expect(screen.getByTestId('drive-recent-star-1')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('drive-recent-row-1')).toBeInTheDocument()
  })

  test('이미 별표한 파일은 켜진 모양으로 보인다', async () => {
    renderScreen(<DriveRecentView />, {
      path: '/drive/recent',
      handlers: [recentHandler({ items: [recent(1, { starred: true }), recent(2)], nextCursor: null })],
    })
    const on = await screen.findByTestId('drive-recent-star-1')
    expect(on).toHaveAttribute('aria-pressed', 'true')
    expect(on).toHaveAccessibleName('파일1.txt 별표 빼기')
    expect(screen.getByTestId('drive-recent-star-2')).toHaveAttribute('aria-pressed', 'false')
  })

  test('별표 API 가 실패하면 꺼진 모양으로 되돌린다', async () => {
    const { user } = renderScreen(<DriveRecentView />, {
      path: '/drive/recent',
      handlers: [
        recentHandler({ items: [recent(1, { starred: false })], nextCursor: null }),
        http.put('/api/v1/drive/stars', async () => {
          // 응답을 늦춰 낙관적으로 켜진 모양을 먼저 본다.
          await delay(100)
          return new HttpResponse(null, { status: 500 })
        }),
      ],
    })
    await user.click(await screen.findByTestId('drive-recent-star-1'))
    expect(screen.getByTestId('drive-recent-star-1')).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(screen.getByTestId('drive-recent-star-1')).toHaveAttribute('aria-pressed', 'false'))
  })

  test('⋯ 「파일 위치 열기」 → 공간 폴더 주소 + highlight', async () => {
    const { user, location } = renderScreen(<DriveRecentView />, {
      path: '/drive/recent',
      handlers: [recentHandler({ items: [recent(1)], nextCursor: null })],
    })
    await user.click(await screen.findByTestId('drive-recent-menu-1'))
    await user.click(await screen.findByTestId('drive-recent-action-locate'))
    await waitFor(() => expect(location()).toBe('/drive/spaces/7?folderId=42&highlight=1'))
  })

  test('루트 파일은 폴더 없이 공간 주소 + highlight', async () => {
    const { user, location } = renderScreen(<DriveRecentView />, {
      path: '/drive/recent',
      handlers: [recentHandler({ items: [recent(1, { folderId: null, folderPath: [] })], nextCursor: null })],
    })
    await user.click(await screen.findByTestId('drive-recent-menu-1'))
    await user.click(await screen.findByTestId('drive-recent-action-locate'))
    await waitFor(() => expect(location()).toBe('/drive/spaces/7?highlight=1'))
  })

  test('⋯ 「다운로드」 → /download 요청', async () => {
    const downloaded = vi.fn()
    const { user } = renderScreen(<DriveRecentView />, {
      path: '/drive/recent',
      handlers: [
        recentHandler({ items: [recent(1)], nextCursor: null }),
        http.get('/api/v1/drive/files/1/download', () => {
          downloaded()
          return new HttpResponse('x', { headers: { 'Content-Type': 'text/plain' } })
        }),
      ],
    })
    await user.click(await screen.findByTestId('drive-recent-menu-1'))
    await user.click(await screen.findByTestId('drive-recent-action-download'))
    await waitFor(() => expect(downloaded).toHaveBeenCalled())
  })
})

describe('드라이브 사이드바 「최근」 입구', () => {
  test('「공유받은 항목」보다 앞에 있고 누르면 /drive/recent 로 간다', async () => {
    const { user, location } = renderScreen(<DriveSidebar />, {
      path: '/drive/spaces/1',
      handlers: [
        http.get('/api/v1/drive/quota', () => HttpResponse.json({ usedBytes: 0, quotaBytes: 1024 })),
        http.get('/api/v1/drive/spaces', () => HttpResponse.json([])),
        http.get('/api/v1/drive/shared-with-me', () => HttpResponse.json([])),
      ],
    })
    const entry = await screen.findByTestId('drive-nav-recent')
    expect(entry).toHaveTextContent('최근')
    const shared = screen.getByTestId('drive-nav-shared')
    expect(entry.compareDocumentPosition(shared) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await user.click(entry)
    await waitFor(() => expect(location()).toBe('/drive/recent'))
  })
})

describe('드라이브 사이드바 랜드마크', () => {
  /** 사이드바 공간 행 하나 — 팀 공간(이름만 본다). */
  const teamSpace: DriveSpace = {
    id: 4,
    type: 'TEAM',
    name: '팀 드라이브',
    ownerId: 1,
    role: 'OWNER',
    archived: false,
    createdAt: '2026-01-01T00:00:00Z',
  }

  /** 공간 목록 응답을 주고 사이드바를 그린다. 공간 조회가 끝났는지 볼 수 있게 queryClient 를 돌려준다. */
  function renderSidebar(spaces: DriveSpace[]) {
    return renderScreen(<DriveSidebar />, {
      path: '/drive/recent',
      handlers: [
        http.get('/api/v1/drive/quota', () => HttpResponse.json({ usedBytes: 0, quotaBytes: 1024 })),
        http.get('/api/v1/drive/spaces', () => HttpResponse.json(spaces)),
        http.get('/api/v1/drive/shared-with-me', () => HttpResponse.json([])),
      ],
    })
  }

  test('공간이 있으면 사이드바와 「드라이브 공간」 nav 에 이름이 있다 — 랜드마크 이름(WP-1774)', async () => {
    renderSidebar([teamSpace])
    const aside = await screen.findByRole('complementary', { name: '드라이브 사이드바' })
    const nav = await within(aside).findByRole('navigation', { name: '드라이브 공간' })
    expect(within(nav).getByText('팀 드라이브')).toBeInTheDocument()
  })

  test('공간이 0건이면 응답이 온 뒤에도 「드라이브 공간」 nav 를 내지 않는다 — 빈 랜드마크 방지(WP-1774)', async () => {
    const { queryClient } = renderSidebar([])
    const aside = await screen.findByRole('complementary', { name: '드라이브 사이드바' })
    // 공간 조회가 성공으로 끝난 뒤에 본다 — 응답 전 null 단언이 공허하게 통과하지 않도록(고정 대기 대신 쿼리 상태).
    await waitFor(() => expect(queryClient.getQueryState(driveKeys.spaces())?.status).toBe('success'))
    expect(within(aside).queryByRole('navigation', { name: '드라이브 공간' })).toBeNull()
  })
})

// WP-1788: 실패 뒤 다시 시도하면 TanStack Query 가 status 를 pending 으로 되돌린다 — 그 동안에도 오류 안내·초점이 남아야 한다.
describe('최근 화면 — 실패 뒤 다시 시도하는 동안 안내와 초점이 남는다(WP-1788)', () => {
  test('WP-1788 다시 시도 성공 — 응답 전에도 안내·초점 유지, 응답 뒤 목록', async () => {
    let calls = 0
    const { promise, release } = gate()
    const { user } = renderScreen(<DriveRecentView />, {
      path: '/drive/recent',
      handlers: [
        http.get('/api/v1/drive/recent', async () => {
          calls += 1
          if (calls === 1) return HttpResponse.json({ message: 'x' }, { status: 500 })
          await promise
          return HttpResponse.json({ items: [recent(1)], nextCursor: null })
        }),
      ],
    })
    await clickRetryAndExpectErrorKept(user, 'drive-recent-error', () => calls)
    await act(async () => { release() })
    expect(await screen.findByTestId('drive-recent-row-1')).toBeInTheDocument()
    expect(screen.queryByTestId('drive-recent-error')).toBeNull()
  })

  test('WP-1788 첫 진입 로딩 — 실패 전 첫 조회 중에는 「불러오는 중…」', async () => {
    const { promise, release } = gate()
    renderScreen(<DriveRecentView />, {
      path: '/drive/recent',
      handlers: [http.get('/api/v1/drive/recent', async () => { await promise; return HttpResponse.json({ items: [], nextCursor: null }) })],
    })
    expect(await screen.findByText('불러오는 중…')).toBeInTheDocument()
    await act(async () => { release() })
    expect(await screen.findByTestId('drive-recent-empty')).toBeInTheDocument()
  })
})
