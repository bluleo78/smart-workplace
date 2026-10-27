// 이슈 동시 편집 충돌 감지(#611) — 페이지 테스트(WP-980).
// 수정 요청에 읽은 version 을 싣는지, 409 면 안내 후 입력을 지킨 채 최신 이슈를 다시 불러오는지, 다시 저장하면 새 version 으로
// 성공하는지는 브라우저 없이 판정되므로 e2e/pages/projects/issue-concurrent-edit.spec.ts 에서 옮겼다(그 spec 은 지웠다).
// MSW 스텁 서버가 version 을 추적한다: PATCH 의 version 이 현재와 다르면 409, 같으면 반영하고 version+1.
// 이슈 상세 화면의 라우트 → API → 화면 배선은 다른 상세 E2E(@wiring)가 지킨다.
// 화면 테스트(WP-1002) — 이슈 상세 화면만 renderIssueDetailScreen 으로 띄운다(App·인증 부팅·앱 셸 없이). 속성 레일·본문·활동이 상세 재조회로 이어져 화면 단위로 둔다.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { DETAIL_API, DETAIL_PATH, detailRefOf, ISSUE_NUMBER, KEY } from '@/test/kits/projects/issueDetailRef'
import { renderIssueDetailScreen } from '@/test/kits/projects/issueDetailScreen'
import { issueDetailHandlers } from '@/test/kits/projects/issueDetailStubs'
import { appEventStream, SCREEN_LOAD_TIMEOUT } from '@/test/kits/projects/routeScreen'

import { createIssue, createIssueDetail } from '../../../e2e/factories/issue.factory'
import { createMember } from '../../../e2e/factories/project.factory'

const CONFLICT = '다른 사용자가 먼저 이 이슈를 수정했습니다'

type Server = { title: string; body: string; version: number; patches: Record<string, unknown>[]; gets: number }

/**
 * version 을 추적하는 상세 GET/PATCH 스텁. refetchDelayMs 로 첫 로드 이후의 상세 재조회를 늦춘다 — 저장 직후 리페치가
 * 끝나기 전에 다음 편집을 하는 상황(캐시에 옛 version 이 남아 거짓 409 가 나기 쉬운 구간)을 만든다.
 */
function versionedServer(refetchDelayMs = 0) {
  const server: Server = { title: '원본 제목', body: '원본 본문', version: 1, patches: [], gets: 0 }
  const detail = () =>
    createIssueDetail({
      summary: createIssue({ id: ISSUE_NUMBER, number: ISSUE_NUMBER, title: server.title, version: server.version }),
      body: server.body,
    })
  // 로그인 사용자를 멤버로 — 상태 같은 워크플로 필드도 편집할 수 있게.
  const base = issueDetailHandlers({ detail: detailRefOf().current, members: [createMember()] }).filter((h) => !h.info.header.endsWith(DETAIL_API))
  const handlers = [
    http.get(DETAIL_API, async () => {
      server.gets += 1
      if (server.gets > 1 && refetchDelayMs) await delay(refetchDelayMs)
      return HttpResponse.json(detail())
    }),
    http.patch(DETAIL_API, async ({ request }) => {
      const payload = (await request.json()) as Record<string, unknown>
      server.patches.push(payload)
      if (payload.version !== undefined && payload.version !== server.version) {
        return HttpResponse.json({ status: 409, message: `${CONFLICT}. 최신 내용을 확인한 뒤 다시 시도해 주세요: ${KEY}-${ISSUE_NUMBER}` }, { status: 409 })
      }
      if (typeof payload.title === 'string') server.title = payload.title
      if (typeof payload.body === 'string') server.body = payload.body
      server.version += 1
      return HttpResponse.json(detail())
    }),
    // 상태 변경은 하위 경로(/status)로 온다 — 서버처럼 version 을 올린다.
    http.patch(`${DETAIL_API}/status`, async ({ request }) => {
      server.patches.push((await request.json()) as Record<string, unknown>)
      server.version += 1
      return HttpResponse.json(detail())
    }),
    ...base,
  ]
  return { server, handlers }
}

/** 상세를 열고 제목이 뜰 때까지 기다린다. */
async function open(refetchDelayMs = 0, extra: Parameters<typeof renderIssueDetailScreen>[1] = {}) {
  const { server, handlers } = versionedServer(refetchDelayMs)
  const view = renderIssueDetailScreen(DETAIL_PATH, { ...extra, handlers: [...(extra.handlers ?? []), ...handlers] })
  await within(await screen.findByTestId('issue-title-heading', {}, { timeout: SCREEN_LOAD_TIMEOUT })).findByText('원본 제목')
  return { ...view, server }
}

/** 제목을 인라인 편집해 Enter 로 저장한다. */
async function editTitle(user: ReturnType<typeof renderIssueDetailScreen>['user'], title: string) {
  await user.click(screen.getByRole('button', { name: '제목 편집' }))
  const input = await screen.findByTestId('issue-title-input')
  fireEvent.change(input, { target: { value: title } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

describe('이슈 동시 편집 충돌 감지 (#611) — 제목', () => {
  test('저장 직후 재조회가 끝나기 전에 다시 편집해도 새 version 을 실어 성공한다', async () => {
    const { user, server } = await open(1000)
    await editTitle(user, '첫 번째')
    // 첫 저장 응답만 받고(재조회는 1초 지연 중) 바로 다음 편집을 한다.
    await waitFor(() => expect(server.patches).toHaveLength(1))
    await editTitle(user, '두 번째')
    await waitFor(() => expect(server.patches).toHaveLength(2))
    expect(server.patches.map((p) => p.version)).toEqual([1, 2])
    expect(await within(screen.getByTestId('issue-title-heading')).findByText('두 번째')).toBeInTheDocument()
    expect(screen.queryByText(CONFLICT, { exact: false })).not.toBeInTheDocument()
  })

  test('다른 곳에서 먼저 수정됐으면 409 안내 후 입력을 유지한 채 최신 이슈를 다시 불러오고, 다시 저장하면 성공한다', async () => {
    const { user, server } = await open()
    // 다른 탭이 먼저 저장한 상황 — 서버만 앞서간다.
    server.title = '다른 탭 제목'
    server.version = 2
    const getsBefore = server.gets

    await editTitle(user, '내 제목')
    expect(await screen.findByText(CONFLICT, { exact: false })).toBeInTheDocument()
    expect(server.patches[0].version).toBe(1)
    // 입력한 제목은 버리지 않고 편집을 다시 열어 두고, 최신 이슈를 다시 불러온다.
    expect(await screen.findByTestId('issue-title-input')).toHaveValue('내 제목')
    await waitFor(() => expect(server.gets).toBeGreaterThan(getsBefore))

    fireEvent.keyDown(screen.getByTestId('issue-title-input'), { key: 'Enter' })
    await waitFor(() => expect(server.patches).toHaveLength(2))
    expect(server.patches[1].version).toBe(2)
    expect(await within(screen.getByTestId('issue-title-heading')).findByText('내 제목')).toBeInTheDocument()
  })

  test('편집하는 사이 SSE 로 캐시가 새로 받아져도 편집 시작 시점의 version 으로 저장해 충돌을 놓치지 않는다', async () => {
    // 통합 SSE 스트림 — push 로 코멘트 이벤트를 흘려 이 화면의 상세 캐시 무효화를 일으킨다.
    let push: (chunk: string) => void = () => {}
    const events = http.get('/api/v1/events', ({ request }) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const enc = new TextEncoder()
          push = (chunk) => controller.enqueue(enc.encode(chunk))
          controller.enqueue(enc.encode(': connected\n\n'))
          request.signal.addEventListener('abort', () => {
            try {
              controller.close()
            } catch {
              // 이미 닫혔으면 무시
            }
          })
        },
      })
      return new HttpResponse(stream, { headers: { 'Content-Type': 'text/event-stream' } })
    })
    const { user, server } = await open(0, { handlers: [events], extra: appEventStream() })

    await user.click(screen.getByRole('button', { name: '제목 편집' }))
    await screen.findByTestId('issue-title-input')
    server.title = '다른 탭 제목'
    server.version = 2
    const getsBefore = server.gets
    act(() => push(`event: issue.commented\ndata: ${JSON.stringify({ projectKey: KEY, issueNumber: ISSUE_NUMBER })}\n\n`))
    await waitFor(() => expect(server.gets).toBeGreaterThan(getsBefore))

    // 편집 시작 때 본 version(1)으로 저장 → 다른 탭의 변경을 모른 채 덮어쓰지 않고 409.
    fireEvent.change(screen.getByTestId('issue-title-input'), { target: { value: '내 제목' } })
    fireEvent.keyDown(screen.getByTestId('issue-title-input'), { key: 'Enter' })
    await waitFor(() => expect(server.patches).toHaveLength(1))
    expect(server.patches[0].version).toBe(1)
    expect(await screen.findByText(CONFLICT, { exact: false })).toBeInTheDocument()
    expect(server.title).toBe('다른 탭 제목')
  })
})

describe('이슈 동시 편집 충돌 감지 (#611) — 본문', () => {
  /** 본문 편집을 열고 textarea 에 값을 넣는다. */
  async function editBody(user: ReturnType<typeof renderIssueDetailScreen>['user'], text: string) {
    await user.click(await screen.findByRole('button', { name: '본문 편집' }))
    const textarea = await screen.findByTestId('issue-body-textarea')
    fireEvent.change(textarea, { target: { value: text } })
    return textarea
  }
  const saveShortcut = () => fireEvent.keyDown(screen.getByTestId('issue-body-textarea'), { key: 'Enter', ctrlKey: true, metaKey: true })

  test('본문을 쓰는 중에 같은 화면에서 상태를 바꿔도 본문 저장은 스스로와 충돌하지 않는다', async () => {
    const { user, server } = await open()
    await editBody(user, '새 본문')
    // 본문 편집을 연 채로 상태 변경(내 저장 → version 1→2).
    // Radix Select 는 jsdom 에서 포인터로 열리지 않아(hasPointerCapture 없음) 키보드로 열고 고른다.
    screen.getByRole('combobox', { name: '상태' }).focus()
    await user.keyboard('{Enter}')
    ;(await screen.findByRole('option', { name: '진행 중' })).focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(server.patches).toHaveLength(1))

    saveShortcut()
    await waitFor(() => expect(server.patches).toHaveLength(2))
    expect(server.patches[1]).toMatchObject({ body: '새 본문', version: 2 })
    expect(server.body).toBe('새 본문')
    expect(screen.queryByText(CONFLICT, { exact: false })).not.toBeInTheDocument()
  })

  test('본문 저장이 409 로 실패하면 입력을 잃지 않고 편집을 다시 열며, 다시 저장하면 최신 version 으로 성공한다', async () => {
    const { user, server } = await open()
    await editBody(user, '공들여 쓴 본문')
    server.title = '다른 탭 제목'
    server.version = 2
    saveShortcut()

    expect(await screen.findByText(CONFLICT, { exact: false })).toBeInTheDocument()
    expect(screen.getByTestId('issue-body-textarea')).toHaveValue('공들여 쓴 본문')
    // 최신 이슈가 다시 불러와진 뒤 다시 저장 → 최신 version 으로 성공.
    expect(await within(screen.getByTestId('issue-title-heading')).findByText('다른 탭 제목')).toBeInTheDocument()
    saveShortcut()
    await waitFor(() => expect(server.patches).toHaveLength(2))
    expect(server.patches[1]).toMatchObject({ body: '공들여 쓴 본문', version: 2 })
    expect(server.body).toBe('공들여 쓴 본문')
  })
})
