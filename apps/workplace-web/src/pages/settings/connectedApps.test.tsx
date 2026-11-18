// WP-1687 — 설정 › API 토큰 「연결된 앱」 절 화면 테스트, 390px 넘침만 E2E.
// 목록 읽기(앱·호스트·워크스페이스·연결일·마지막 사용)·절 보임 규칙(로딩·빈 목록 숨김, 오류 보임)·도움말/앵커 id·창 복귀 재조회는
// 브라우저 없이 판정되므로 여기서 본다. 끊기 확인 창(취소·404·끊는 중 비활성·다시 읽기 대기)과 #connected-apps 앵커 스크롤 시점도 여기서 본다.
import { focusManager } from '@tanstack/react-query'
import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { type ReactElement, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'

import { oauthConnectionKeys } from '@/hooks/queries/useOAuthConnections'
import { renderScreen } from '@/test/renderScreen'
import type { OAuthConnection } from '@/types/oauth'

import { oauthConnection } from '../../../e2e/factories/oauth.factory'
import { ConnectedAppsSection } from './components/ConnectedAppsSection'

afterEach(() => {
  // 창 포커스 테스트가 심은 값을 되돌린다.
  focusManager.setFocused(undefined)
  // scrollIntoView 스파이를 되돌린다.
  vi.restoreAllMocks()
})

type OpenOptions = {
  /** 절 대신 그릴 화면(절을 포함해야 한다) — 같은 화면에서 주소만 바뀌는 시나리오용. */
  ui?: ReactElement
  /** DELETE 응답 — remove() 를 부르면 그 줄이 목록에서 빠진다. 기본은 줄을 빼고 204. */
  onDelete?: (id: number, remove: () => void) => Response | Promise<Response>
}

/**
 * 절을 띄운다 — 목록 응답(또는 응답 함수)을 정하고 GET 횟수(gets.count)와 받은 DELETE 의 id(deletes)를 센다.
 * 목록이 배열이면 상태형이다: DELETE 가 줄을 빼면 다음 GET 에 그 줄이 없다(서버가 끊은 것을 목록이 반영).
 */
function open(
  list: OAuthConnection[] | (() => Response | Promise<Response>),
  path = '/settings/tokens',
  { ui, onDelete }: OpenOptions = {},
) {
  const gets = { count: 0 }
  const deletes: number[] = []
  let current = typeof list === 'function' ? [] : [...list]
  const view = renderScreen(ui ?? <ConnectedAppsSection scrollReady />, {
    path,
    handlers: [
      http.get('/api/v1/users/me/oauth-connections', () => {
        gets.count += 1
        return typeof list === 'function' ? list() : HttpResponse.json(current)
      }),
      http.delete('/api/v1/users/me/oauth-connections/:id', ({ params }) => {
        const id = Number(params.id)
        deletes.push(id)
        const remove = () => {
          current = current.filter((c) => c.id !== id)
        }
        if (onDelete) return onDelete(id, remove)
        remove()
        return new HttpResponse(null, { status: 204 })
      }),
    ],
  })
  return { ...view, gets, deletes }
}

/** 응답을 테스트가 풀 때까지 붙잡아 두는 문 — release() 를 부르면 기다리던 핸들러가 이어 간다. */
function holdResponse() {
  let release: () => void = () => {}
  const opened = new Promise<void>((resolve) => {
    release = resolve
  })
  return { opened, release }
}

/** 창이 포커스를 잃었다가 되찾은 것으로 한다 — 연결 목록이 창 복귀 때 다시 읽는지 보려고 쓴다. */
function refocusWindow() {
  act(() => {
    focusManager.setFocused(false)
    focusManager.setFocused(true)
  })
}

/** 같은 앱을 두 번째 워크스페이스에 연결한 줄 — 여러 테스트가 첫 줄(기본값)과 나란히 쓴다. */
const LAB_CONNECTION = oauthConnection({ id: 2, tenantName: 'Gen:iA Lab', tenantId: 2 })

/** 토큰 표의 처음 불러오기를 테스트가 쥐는 문 — 값이 false→true 로 바뀔 때 스크롤하는지 보려고 절 위에서 prop 을 단추로 바꾼다. */
function ScrollGate() {
  const [ready, setReady] = useState(false)
  return (
    <>
      <button onClick={() => setReady(true)}>토큰 표 불러옴</button>
      <ConnectedAppsSection scrollReady={ready} />
    </>
  )
}

/** 단추를 누르면 그제야 절을 마운트한다 — 캐시를 미리 심어 두고 「마운트 뒤 응답」을 가르는 시나리오용. */
function MountLater() {
  const [on, setOn] = useState(false)
  return on ? <ConnectedAppsSection scrollReady /> : <button onClick={() => setOn(true)}>열기</button>
}

/** 이동 단추 — 같은 화면에서 주소(해시)만 바꾸는 시나리오용. */
function NavTo({ to }: { to: string }) {
  const navigate = useNavigate()
  return <button onClick={() => navigate(to)}>이동</button>
}

test('연결마다 앱·redirect 호스트·워크스페이스·연결일·마지막 사용이 보인다', async () => {
  const threeHoursAgo = new Date(Date.now() - 3 * 3_600_000).toISOString()
  open([
    oauthConnection({ id: 1, lastUsedAt: threeHoursAgo }),
    oauthConnection({ id: 2, tenantId: 2, tenantName: 'Gen:iA Lab', clientName: 'Claude', createdAt: '2026-11-17T03:00:00Z' }),
    oauthConnection({ id: 3, clientName: 'My Tool', unverified: true, redirectHost: null }),
  ])
  const region = await screen.findByRole('region', { name: '연결된 앱' })
  expect(within(region).getByRole('table', { name: '연결된 앱 목록' })).toBeInTheDocument()
  for (const h of ['앱', '워크스페이스', '연결', '마지막 사용']) {
    expect(within(region).getByRole('columnheader', { name: h })).toBeInTheDocument()
  }
  const r1 = within(screen.getByTestId('oauth-connection-row-1'))
  expect(r1.getByText('Claude')).toBeInTheDocument()
  expect(r1.getByText('claude.ai')).toBeInTheDocument()
  expect(r1.getAllByText('Work Loop').length).toBeGreaterThan(0) // 데스크톱 칸 + 모바일 메타
  expect(r1.getAllByText('2026-11-12').length).toBeGreaterThan(0)
  expect(r1.getAllByText('3시간 전').length).toBeGreaterThan(0)
  const meta1 = within(screen.getByTestId('oauth-connection-meta-1')) // 모바일 메타: 스팬 셋
  for (const t of ['Work Loop', '연결 2026-11-12', '사용 3시간 전']) expect(meta1.getByText(t)).toBeInTheDocument()
  expect(within(screen.getByTestId('oauth-connection-meta-2')).getByText('사용 —')).toBeInTheDocument() // lastUsedAt null
  const r3 = within(screen.getByTestId('oauth-connection-row-3'))
  expect(r3.getByText('확인되지 않은 앱')).toBeInTheDocument()
  expect(r3.queryByText('claude.ai')).not.toBeInTheDocument() // redirectHost null → 둘째 줄 없음
  expect(within(screen.getByTestId('oauth-connection-row-2')).queryByText('확인되지 않은 앱')).not.toBeInTheDocument()
  // 같은 앱을 두 워크스페이스에 연결해도 줄마다 끊기 접근 이름이 다르다.
  expect(screen.getByRole('button', { name: 'Claude Work Loop 연결 끊기' })).toBe(screen.getByTestId('oauth-connection-revoke-1'))
  expect(screen.getByRole('button', { name: 'Claude Gen:iA Lab 연결 끊기' })).toBe(screen.getByTestId('oauth-connection-revoke-2'))
})

test('빈 목록이면 절이 없다', async () => {
  const { gets } = open([])
  await waitFor(() => expect(gets.count).toBe(1))
  expect(screen.queryByRole('region', { name: '연결된 앱' })).not.toBeInTheDocument()
})

test('불러오는 동안에는 절이 없다', async () => {
  // 핸들러가 테스트가 쥔 promise 를 기다린다 — 응답 전에는 뼈대도 절도 없어야 한다.
  const list = holdResponse()
  const { gets } = open(async () => {
    await list.opened
    return HttpResponse.json([oauthConnection()])
  })
  await waitFor(() => expect(gets.count).toBe(1))
  expect(screen.queryByRole('region', { name: '연결된 앱' })).not.toBeInTheDocument()
  list.release()
  expect(await screen.findByRole('region', { name: '연결된 앱' })).toBeInTheDocument()
})

test('불러오지 못하면 절과 오류 줄이 보인다', async () => {
  open(() => new HttpResponse(null, { status: 500 }))
  const region = await screen.findByRole('region', { name: '연결된 앱' })
  expect(within(region).getByText('연결된 앱을 불러오지 못했습니다')).toBeInTheDocument()
})

test('절에 도움말 id tokens.apps 와 앵커 id 가 있다', async () => {
  open([oauthConnection()])
  const section = await screen.findByTestId('connected-apps')
  expect(section).toHaveAttribute('data-help', 'tokens.apps')
  expect(section).toHaveAttribute('id', 'connected-apps')
})

test('창으로 돌아오면 목록을 다시 읽는다', async () => {
  // 첫 목록은 비어 절이 없다 — 연결은 이 탭 밖(동의 화면)에서 생기므로 돌아왔을 때 다시 읽어야 보인다.
  let call = 0
  const { gets } = open(() => {
    call += 1
    return HttpResponse.json(call === 1 ? [] : [oauthConnection()])
  })
  await waitFor(() => expect(gets.count).toBe(1))
  expect(screen.queryByTestId('oauth-connection-row-1')).not.toBeInTheDocument()
  refocusWindow()
  expect(await screen.findByTestId('oauth-connection-row-1')).toBeInTheDocument()
  expect(gets.count).toBe(2)
})

test('끊기 → 확인 창에 앱·워크스페이스 → 끊기 → 그 id 로 DELETE 한 번, 줄이 빠지고 토스트', async () => {
  const { user, deletes } = open([oauthConnection({ id: 1 }), LAB_CONNECTION])
  await user.click(await screen.findByTestId('oauth-connection-revoke-2'))
  const dialog = await screen.findByRole('alertdialog')
  expect(dialog).toHaveAttribute('data-testid', 'oauth-connection-confirm-dialog')
  expect(dialog).toHaveAttribute('data-help', 'tokens.apps')
  expect(within(dialog).getByRole('heading', { name: '앱 연결 끊기' })).toBeInTheDocument()
  expect(dialog).toHaveTextContent('Claude의 Gen:iA Lab 연결을 끊으시겠습니까? 이 앱은 바로 Gen:iA Works 에 접근할 수 없게 되고, 다시 쓰려면 앱에서 다시 연결해야 합니다.')
  await user.click(within(dialog).getByTestId('oauth-connection-confirm'))
  await waitFor(() => expect(screen.queryByTestId('oauth-connection-row-2')).not.toBeInTheDocument())
  expect(deletes).toEqual([2])
  expect(screen.getByTestId('oauth-connection-row-1')).toBeInTheDocument()
  expect(await screen.findByText('앱 연결을 끊었습니다')).toBeInTheDocument()
})

test('확인 창에서 취소하면 DELETE 가 없다', async () => {
  const { user, deletes } = open([oauthConnection({ id: 1 })])
  await user.click(await screen.findByTestId('oauth-connection-revoke-1'))
  await screen.findByRole('alertdialog')
  await user.click(screen.getByTestId('oauth-connection-cancel'))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  expect(deletes).toEqual([])
  expect(screen.getByTestId('oauth-connection-row-1')).toBeInTheDocument()
})

test('이미 끊긴 연결(404)이면 서버 메시지 토스트, 목록을 다시 읽어 줄이 빠진다', async () => {
  const { user, deletes } = open([oauthConnection({ id: 1 }), LAB_CONNECTION], '/settings/tokens', {
    onDelete: (_id, remove) => {
      remove() // 다른 곳에서 이미 끊긴 상태 — 목록에는 없다
      return HttpResponse.json({ message: '앱 연결을 찾을 수 없습니다' }, { status: 404 })
    },
  })
  await user.click(await screen.findByTestId('oauth-connection-revoke-2'))
  await user.click(await screen.findByTestId('oauth-connection-confirm'))
  expect(await screen.findByText('앱 연결을 찾을 수 없습니다')).toBeInTheDocument()
  await waitFor(() => expect(screen.queryByTestId('oauth-connection-row-2')).not.toBeInTheDocument())
  expect(deletes).toEqual([2])
  expect(screen.getByTestId('oauth-connection-row-1')).toBeInTheDocument()
})

test('마지막 연결을 끊으면 절이 사라진다', async () => {
  const { user } = open([oauthConnection({ id: 1 })])
  await user.click(await screen.findByTestId('oauth-connection-revoke-1'))
  await user.click(await screen.findByTestId('oauth-connection-confirm'))
  await waitFor(() => expect(screen.queryByRole('region', { name: '연결된 앱' })).not.toBeInTheDocument())
})

// Review Focus 2
test('끊는 중에는 그 줄의 끊기를 다시 누를 수 없다', async () => {
  // DELETE 가 테스트가 쥔 promise 를 기다린다 — 응답 전에는 그 줄만 비활성이어야 한다.
  const del = holdResponse()
  const { user } = open([oauthConnection({ id: 1 }), LAB_CONNECTION], '/settings/tokens', {
    onDelete: async (_id, remove) => {
      await del.opened
      remove()
      return new HttpResponse(null, { status: 204 })
    },
  })
  await user.click(await screen.findByTestId('oauth-connection-revoke-1'))
  await user.click(await screen.findByTestId('oauth-connection-confirm'))
  await waitFor(() => expect(screen.getByTestId('oauth-connection-revoke-1')).toBeDisabled())
  expect(screen.getByTestId('oauth-connection-revoke-2')).toBeEnabled()
  del.release()
  await waitFor(() => expect(screen.queryByTestId('oauth-connection-row-1')).not.toBeInTheDocument())
})

test('다시 읽기가 실패해도 이미 받은 목록은 그대로 보인다', async () => {
  // 첫 목록은 성공, 창으로 돌아와 다시 읽을 때 500 — 실패를 「연결 없음」으로 숨기지 않되 목록을 오류 줄로 바꾸지도 않는다.
  let call = 0
  const { gets, queryClient } = open(() => {
    call += 1
    return call === 1 ? HttpResponse.json([oauthConnection({ id: 1 })]) : new HttpResponse(null, { status: 500 })
  })
  expect(await screen.findByTestId('oauth-connection-row-1')).toBeInTheDocument()
  refocusWindow()
  await waitFor(() => expect(gets.count).toBe(2))
  // 실패가 쿼리 상태에 반영될 때까지 기다린 뒤에 본다 — 아니면 오류가 그려지기 전의 화면을 보고 거짓으로 통과한다.
  await waitFor(() => expect(queryClient.getQueryState(oauthConnectionKeys.mine)?.status).toBe('error'))
  expect(screen.getByTestId('oauth-connection-row-1')).toBeInTheDocument()
  expect(screen.queryByText('연결된 앱을 불러오지 못했습니다')).not.toBeInTheDocument()
})

test('#connected-apps 로 열면 목록이 그려진 뒤 절로 한 번 스크롤한다', async () => {
  const spy = vi.spyOn(Element.prototype, 'scrollIntoView')
  open([oauthConnection({ id: 1 })], '/settings/tokens#connected-apps')
  await screen.findByTestId('oauth-connection-row-1')
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
  expect(spy.mock.contexts[0]).toBe(screen.getByTestId('connected-apps'))
  expect(spy.mock.calls[0][0]).toEqual({ block: 'start' })
})

test('#connected-apps 로 열어도 연결이 없으면 스크롤하지 않는다', async () => {
  const spy = vi.spyOn(Element.prototype, 'scrollIntoView')
  const { queryClient } = open([], '/settings/tokens#connected-apps')
  // 요청 횟수만 보면 응답이 쿼리에 실리기 전(로딩 중이라 절이 없는 때)을 보고 거짓으로 통과한다 — 빈 목록으로 확정된 뒤에 본다.
  await waitFor(() => expect(queryClient.getQueryState(oauthConnectionKeys.mine)?.status).toBe('success'))
  expect(screen.queryByRole('region', { name: '연결된 앱' })).not.toBeInTheDocument()
  expect(spy).not.toHaveBeenCalled()
})

// Review Focus 5
test('해시로 연 뒤 목록을 다시 읽어도 다시 스크롤하지 않는다', async () => {
  const spy = vi.spyOn(Element.prototype, 'scrollIntoView')
  const { gets } = open([oauthConnection({ id: 1 })], '/settings/tokens#connected-apps')
  await screen.findByTestId('oauth-connection-row-1')
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
  refocusWindow()
  await waitFor(() => expect(gets.count).toBe(2))
  expect(screen.getByTestId('oauth-connection-row-1')).toBeInTheDocument()
  expect(spy).toHaveBeenCalledTimes(1)
})

// Review Focus 4
test('같은 화면에서 해시로 다시 오면 다시 스크롤한다', async () => {
  const spy = vi.spyOn(Element.prototype, 'scrollIntoView')
  const { user } = open([oauthConnection({ id: 1 })], '/settings/tokens', {
    ui: (
      <>
        <NavTo to="/settings/tokens#connected-apps" />
        <ConnectedAppsSection scrollReady />
      </>
    ),
  })
  await screen.findByTestId('oauth-connection-row-1')
  expect(spy).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: '이동' }))
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
})

// 코드 리뷰 #1 — 토큰 표가 아직 뼈대일 때 스크롤하면, 토큰 줄이 늦게 와 표가 길어지며 절이 화면 아래로 밀린다.
// 토큰 쿼리는 TokenSettingsPage 가 가지고 절에는 scrollReady 로 넘어온다 — false 인 동안은 스크롤하지 않고 true 가 되면 한 번 한다.
test('토큰 표가 늦게 불러와지면(scrollReady false→true) 그 뒤에 한 번 스크롤한다', async () => {
  const spy = vi.spyOn(Element.prototype, 'scrollIntoView')
  const { user, gets } = open([oauthConnection({ id: 1 })], '/settings/tokens#connected-apps', { ui: <ScrollGate /> })
  await screen.findByTestId('oauth-connection-row-1')
  await waitFor(() => expect(gets.count).toBe(1))
  expect(spy).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: '토큰 표 불러옴' }))
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
  expect(spy.mock.contexts[0]).toBe(screen.getByTestId('connected-apps'))
})

// 코드 리뷰 #2 — 연결 목록은 staleTime 0 이라 마운트하면 다시 읽는다. 캐시 줄로 먼저 스크롤하면 다시 읽은 결과로는 기회가 없다.
test('캐시가 있어도 마운트 뒤 연결 목록 응답을 받기 전에는 스크롤하지 않는다', async () => {
  const spy = vi.spyOn(Element.prototype, 'scrollIntoView')
  const list = holdResponse()
  const { user, gets, queryClient } = open(
    async () => {
      await list.opened
      return HttpResponse.json([oauthConnection({ id: 1 })])
    },
    '/settings/tokens#connected-apps',
    { ui: <MountLater /> },
  )
  // 앞 화면에서 받아 둔 캐시 — 연결 목록은 staleTime 0 이라 마운트하면 다시 읽는다.
  queryClient.setQueryData(oauthConnectionKeys.mine, [oauthConnection({ id: 1 })])
  await user.click(screen.getByRole('button', { name: '열기' }))
  expect(await screen.findByTestId('oauth-connection-row-1')).toBeInTheDocument()
  await waitFor(() => expect(gets.count).toBe(1))
  expect(spy).not.toHaveBeenCalled()
  list.release()
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
})

// 코드 리뷰 #3 — 실패를 숨기지 않는다는 절 원칙대로, 목록을 못 받아 오류 줄만 있어도 절로 데려간다.
test('#connected-apps 로 열었는데 목록을 불러오지 못하면 오류 줄이 있는 절로 스크롤한다', async () => {
  const spy = vi.spyOn(Element.prototype, 'scrollIntoView')
  open(() => new HttpResponse(null, { status: 500 }), '/settings/tokens#connected-apps')
  await screen.findByText('연결된 앱을 불러오지 못했습니다')
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
  expect(spy.mock.contexts[0]).toBe(screen.getByTestId('connected-apps'))
})

// 코드 리뷰 #8 — 끊기가 끝나도 목록을 다시 받기 전에는 그 줄이 남아 있다. 그동안 끊기를 다시 누르면 404 만 돌아온다.
test('끊은 뒤 목록을 다시 받을 때까지 그 줄의 끊기는 비활성이다', async () => {
  const refetch = holdResponse()
  let call = 0
  const { user, gets, deletes } = open(async () => {
    call += 1
    if (call === 1) return HttpResponse.json([oauthConnection({ id: 1 }), LAB_CONNECTION])
    await refetch.opened
    return HttpResponse.json([LAB_CONNECTION])
  })
  await user.click(await screen.findByTestId('oauth-connection-revoke-1'))
  await user.click(await screen.findByTestId('oauth-connection-confirm'))
  // DELETE 는 성공했다(토스트) — 다시 읽기 GET 은 붙잡혀 있다.
  expect(await screen.findByText('앱 연결을 끊었습니다')).toBeInTheDocument()
  expect(deletes).toEqual([1])
  await waitFor(() => expect(gets.count).toBe(2))
  // mutation 이 끝났다고 상태를 반영할 틈을 준다 — 다시 읽기를 기다리지 않으면 이 사이에 끊기가 다시 켜진다.
  // 고정 대기 대신 대기 중인 상태 갱신을 비운다(토스트·두 번째 GET 이 붙잡힌 것을 위에서 확인했다).
  await act(async () => {})
  expect(screen.getByTestId('oauth-connection-row-1')).toBeInTheDocument()
  expect(screen.getByTestId('oauth-connection-revoke-1')).toBeDisabled()
  expect(screen.getByTestId('oauth-connection-revoke-2')).toBeEnabled()
  refetch.release()
  await waitFor(() => expect(screen.queryByTestId('oauth-connection-row-1')).not.toBeInTheDocument())
})

// 확인 창을 연 채 목록이 비면 절(과 창)이 사라진다 — 그 대상이 남아 있으면 나중에 줄이 다시 생길 때 창이 저절로 다시 뜬다.
test('확인 창을 연 채 목록이 비었다가 다시 줄이 생겨도 확인 창이 다시 뜨지 않는다', async () => {
  let call = 0
  const { user, gets } = open(() => {
    call += 1
    return HttpResponse.json(call === 2 ? [] : [oauthConnection({ id: 1 })])
  })
  await user.click(await screen.findByTestId('oauth-connection-revoke-1'))
  expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
  // 창으로 돌아와 다시 읽으니 다른 곳에서 끊겨 목록이 비었다 → 절이 사라진다.
  refocusWindow()
  await waitFor(() => expect(gets.count).toBe(2))
  await waitFor(() => expect(screen.queryByRole('region', { name: '연결된 앱' })).not.toBeInTheDocument())
  // 다시 읽으니 줄이 있다 — 절은 돌아오지만 끊기 확인 창은 사용자가 다시 눌러야 뜬다.
  refocusWindow()
  expect(await screen.findByTestId('oauth-connection-row-1')).toBeInTheDocument()
  expect(gets.count).toBe(3)
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
})
