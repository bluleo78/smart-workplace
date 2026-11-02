// 설정 › AI 실행 위치(WP-1256) — 화면 컴포넌트 테스트.
// 목록(기본 배지·연결 알약·자리 n/상한), 추가 폼 → POST payload·검증 문구, 토큰 1회 표시 + 설치 4단계(토큰 원문 미포함),
// ⋯ 메뉴(기본 지정·이름/자리 수 바꾸기·토큰 재발급·삭제)의 요청과 비활성 판정을 본다.
// 페이지 컴포넌트(AgentLocationsPage)를 renderScreen 으로 띄운다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { renderScreen, type ScreenUser } from '@/test/renderScreen'
import type { AgentLocation } from '@/types/agentRuntime'

import { createLocation, createLocations } from '../../test/kits/admin/agentRuntime'
import AgentLocationsPage from './AgentLocationsPage'

const API = '/api/v1/admin/agent-locations'
const NEW_TOKEN = 'rt_4b1e9c0d2f7a6e5b3c8d1f0a9e7b6c5d4a3f2e1d'

type Calls = {
  creates: unknown[]
  updates: { id: number; body: unknown }[]
  defaults: number[]
  rotates: number[]
  deletes: number[]
}

/** 위치 API — 추가·변경·삭제를 목록에 반영해 재조회에 보인다. 쓰기 요청은 calls 에 모은다. */
function locationApi(initial: AgentLocation[] = createLocations(), failDelete = false) {
  let list = [...initial]
  const calls: Calls = { creates: [], updates: [], defaults: [], rotates: [], deletes: [] }
  const handlers = [
    http.get(API, () => HttpResponse.json(list)),
    http.post(API, async ({ request }) => {
      const body = (await request.json()) as { name: string; description: string | null; capacity: number }
      calls.creates.push(body)
      const location = createLocation({ id: 4, ...body, isDefault: false, used: 0, connection: 'PENDING', lastSeenAt: null, tokenPrefix: 'rt_4b1e' })
      list = [...list, location]
      return HttpResponse.json({ location, plaintextToken: NEW_TOKEN })
    }),
    http.put(`${API}/:id`, async ({ params, request }) => {
      const body = (await request.json()) as { name: string; description: string | null; capacity: number }
      calls.updates.push({ id: Number(params.id), body })
      list = list.map((l) => (l.id === Number(params.id) ? { ...l, ...body } : l))
      return HttpResponse.json(list.find((l) => l.id === Number(params.id)))
    }),
    http.post(`${API}/:id/default`, ({ params }) => {
      calls.defaults.push(Number(params.id))
      list = list.map((l) => ({ ...l, isDefault: l.id === Number(params.id) }))
      return new HttpResponse(null, { status: 204 })
    }),
    http.post(`${API}/:id/token`, ({ params }) => {
      calls.rotates.push(Number(params.id))
      return HttpResponse.json({ location: list.find((l) => l.id === Number(params.id)), plaintextToken: 'rt_ROTATED0123456789' })
    }),
    http.delete(`${API}/:id`, ({ params }) => {
      calls.deletes.push(Number(params.id))
      if (failDelete) return HttpResponse.json({ message: '쓰는 AI 가 있어 지울 수 없습니다' }, { status: 409 })
      list = list.filter((l) => l.id !== Number(params.id))
      return new HttpResponse(null, { status: 204 })
    }),
  ]
  return { handlers, calls }
}

async function renderLocations(opts: { initial?: AgentLocation[]; failDelete?: boolean } = {}) {
  const api = locationApi(opts.initial, opts.failDelete)
  const view = renderScreen(<AgentLocationsPage />, { path: '/settings/agent-locations', handlers: api.handlers })
  await screen.findByTestId('agent-location-row-1')
  return { ...view, ...api }
}

/** 행의 ⋯ 메뉴를 열고 항목 이름으로 누른다. */
async function pickMenu(user: ScreenUser, id: number, item: string | RegExp) {
  await user.click(screen.getByTestId(`agent-location-menu-${id}`))
  await user.click(await screen.findByRole('menuitem', { name: item }))
}

test('목록 — 기본 배지·설명·연결 알약·자리 사용 수가 행마다 보인다', async () => {
  await renderLocations()
  const r1 = screen.getByTestId('agent-location-row-1')
  expect(r1).toHaveTextContent('운영')
  expect(r1).toHaveTextContent('기본')
  expect(r1).toHaveTextContent('iacloud-prod · genia-agents 네임스페이스')
  expect(screen.getByTestId('agent-location-connection-1')).toHaveTextContent('연결됨')
  expect(screen.getByTestId('agent-location-seats-1')).toHaveTextContent('3 / 4')

  const r2 = screen.getByTestId('agent-location-row-2')
  expect(r2).not.toHaveTextContent('기본')
  expect(screen.getByTestId('agent-location-connection-2')).toHaveTextContent('끊김')
  expect(r2).toHaveTextContent('42분 전 보고')
  expect(screen.getByTestId('agent-location-seats-2')).toHaveTextContent('1 / 2')

  expect(screen.getByTestId('agent-location-connection-3')).toHaveTextContent('설치 대기')
  expect(screen.getByTestId('agent-location-row-3')).not.toHaveTextContent('보고')
  expect(screen.getByTestId('agent-location-seats-3')).toHaveTextContent('0 / 2')
})

test('위치가 없으면 빈 안내', async () => {
  const api = locationApi([])
  renderScreen(<AgentLocationsPage />, { path: '/settings/agent-locations', handlers: api.handlers })
  expect(await screen.findByText(/아직 실행 위치가 없어요/)).toBeInTheDocument()
})

test('추가 — 이름·설명·자리 수가 POST payload 로 가고 토큰이 한 번 보이며 설치 4단계가 따라온다', async () => {
  const { user, calls } = await renderLocations()
  await user.click(screen.getByTestId('agent-location-new'))
  const form = await screen.findByTestId('agent-location-form')
  await user.type(within(form).getByLabelText('이름'), '  개발 클러스터 ')
  await user.type(within(form).getByLabelText('설명 (선택)'), 'dev 네임스페이스')
  const cap = within(form).getByLabelText('자리 수')
  await user.clear(cap)
  await user.type(cap, '5')
  await user.click(screen.getByTestId('agent-location-submit'))

  await waitFor(() => expect(calls.creates).toEqual([{ name: '개발 클러스터', description: 'dev 네임스페이스', capacity: 5 }]))
  const dialog = await screen.findByTestId('agent-location-token-dialog')
  expect(within(dialog).getByTestId('agent-location-token-plaintext')).toHaveTextContent(NEW_TOKEN)
  expect(dialog).toHaveTextContent('이 토큰은 다시 표시되지 않습니다')
  expect(within(dialog).getByTestId('agent-location-token-connection')).toHaveTextContent('설치 대기')
  // 설치 순서 4단계 — 토큰 원문은 명령에 들어가지 않고 파일(--set-file)로 넘긴다.
  const steps = within(dialog).getByTestId('agent-location-install-steps')
  expect(within(steps).getAllByRole('listitem')).toHaveLength(4)
  expect(steps).toHaveTextContent('--set-file runnerToken=./runner-token.txt')
  expect(steps).toHaveTextContent(`--set works.url=${window.location.origin}`)
  expect(steps.textContent).not.toContain(NEW_TOKEN)
  // 폼은 닫혔다.
  expect(screen.queryByTestId('agent-location-form')).not.toBeInTheDocument()
  // 목록에도 새 위치가 보인다.
  expect(await screen.findByTestId('agent-location-row-4')).toHaveTextContent('개발 클러스터')
})

test('설치 대화상자 — 내부 IP 를 넣으면 설치 명령에 hostAliases 가 들어가고, 잘못된 값이면 안내만 하고 명령은 그대로다', async () => {
  const { user } = await renderLocations()
  await user.click(screen.getByTestId('agent-location-new'))
  await user.type(await screen.findByLabelText('이름'), 'PoC')
  await user.click(screen.getByTestId('agent-location-submit'))
  const dialog = await screen.findByTestId('agent-location-token-dialog')
  const steps = within(dialog).getByTestId('agent-location-install-steps')
  // 비우면 지금 명령 그대로
  expect(steps.textContent).not.toContain('hostAliases')
  // 연결이 안 될 때 볼 로그 명령
  expect(within(dialog).getByTestId('agent-location-install-troubleshoot')).toHaveTextContent('logs deploy/agent-runner')

  const ipInput = within(dialog).getByLabelText('Works 에 내부 IP 로 접속하는 경우 (선택)')
  await user.type(ipInput, '192.168.100')
  expect(dialog).toHaveTextContent('IPv4 주소(예 192.168.100.72)를 넣으세요.')
  expect(steps.textContent).not.toContain('hostAliases')

  await user.type(ipInput, '.72')
  expect(steps).toHaveTextContent("--set 'hostAliases[0].ip=192.168.100.72'")
  expect(steps).toHaveTextContent(`--set 'hostAliases[0].hostnames[0]=${window.location.hostname}'`)

  // 닫고 다른 위치를 만들면 앞 위치의 내부 IP 가 남지 않는다.
  await user.click(within(dialog).getAllByRole('button', { name: '닫기' }).at(-1)!)
  await waitFor(() => expect(screen.queryByTestId('agent-location-token-dialog')).not.toBeInTheDocument())
  await user.click(screen.getByTestId('agent-location-new'))
  await user.type(await screen.findByLabelText('이름'), 'Other')
  await user.click(screen.getByTestId('agent-location-submit'))
  const next = await screen.findByTestId('agent-location-token-dialog')
  expect(within(next).getByLabelText('Works 에 내부 IP 로 접속하는 경우 (선택)')).toHaveValue('')
  expect(within(next).getByTestId('agent-location-install-steps').textContent).not.toContain('hostAliases')
})

test('토큰 대화상자를 닫으면 토큰이 화면에서 사라진다', async () => {
  const { user } = await renderLocations()
  await user.click(screen.getByTestId('agent-location-new'))
  await user.type(await screen.findByLabelText('이름'), 'X')
  await user.click(screen.getByTestId('agent-location-submit'))
  const dialog = await screen.findByTestId('agent-location-token-dialog')
  // 닫기 단추가 둘(모서리 X·하단) — 하단 단추를 누른다.
  await user.click(within(dialog).getAllByRole('button', { name: '닫기' }).at(-1)!)
  await waitFor(() => expect(screen.queryByTestId('agent-location-token-dialog')).not.toBeInTheDocument())
  expect(screen.queryByText(NEW_TOKEN)).not.toBeInTheDocument()
})

test('추가 폼 검증 — 이름이 비면 추가가 막히고, 자리 수는 1~100 정수만 허용한다', async () => {
  const { user, calls } = await renderLocations()
  await user.click(screen.getByTestId('agent-location-new'))
  const form = await screen.findByTestId('agent-location-form')
  const submit = screen.getByTestId('agent-location-submit')
  const name = within(form).getByLabelText('이름')
  const cap = within(form).getByLabelText('자리 수')

  // 처음엔 이름이 비어 막혀 있고 자리 수 안내는 기본 문구.
  expect(submit).toBeDisabled()
  expect(form).toHaveTextContent('이 위치에서 동시에 켤 수 있는 AI 수입니다')
  await user.type(name, '   ')
  expect(submit).toBeDisabled()
  await user.clear(name)
  await user.type(name, '운영2')
  expect(submit).toBeEnabled()

  for (const bad of ['0', '101', '1.5', '']) {
    await user.clear(cap)
    if (bad) await user.type(cap, bad)
    expect(form).toHaveTextContent('자리 수는 1~100 사이 정수로 넣어 주세요')
    expect(cap).toHaveAttribute('aria-invalid', 'true')
    expect(submit).toBeDisabled()
  }
  // 경계값은 통과한다.
  for (const ok of ['1', '100']) {
    await user.clear(cap)
    await user.type(cap, ok)
    expect(form).not.toHaveTextContent('자리 수는 1~100')
    expect(submit).toBeEnabled()
  }
  expect(calls.creates).toEqual([])
})

test('이름은 64자까지만 들어간다', async () => {
  const { user } = await renderLocations()
  await user.click(screen.getByTestId('agent-location-new'))
  const name = await screen.findByLabelText('이름')
  expect(name).toHaveAttribute('maxLength', '64')
  await user.click(name)
  await user.paste('가'.repeat(70))
  expect((name as HTMLInputElement).value).toHaveLength(64)
})

test('⋯ › 기본으로 지정 — POST default 를 보내고 기본 배지가 옮겨 간다 (기본 행에는 항목이 없다)', async () => {
  const { user, calls } = await renderLocations()
  await user.click(screen.getByTestId('agent-location-menu-1'))
  expect(screen.queryByRole('menuitem', { name: '기본으로 지정' })).not.toBeInTheDocument()
  await user.keyboard('{Escape}')

  await pickMenu(user, 2, '기본으로 지정')
  await waitFor(() => expect(calls.defaults).toEqual([2]))
  await waitFor(() => expect(screen.getByTestId('agent-location-row-2')).toHaveTextContent('기본'))
  expect(screen.getByTestId('agent-location-row-1')).not.toHaveTextContent('기본')
})

test('⋯ › 이름·자리 수 바꾸기 — 기존 값이 채워지고 PUT payload 가 간다', async () => {
  const { user, calls } = await renderLocations()
  await pickMenu(user, 2, '이름·자리 수 바꾸기')
  const form = await screen.findByTestId('agent-location-form')
  expect(within(form).getByLabelText('이름')).toHaveValue('PoC')
  expect(within(form).getByLabelText('자리 수')).toHaveValue(2)
  expect(screen.getByTestId('agent-location-submit')).toHaveTextContent('저장')
  const name = within(form).getByLabelText('이름')
  await user.clear(name)
  await user.type(name, 'PoC 2')
  const cap = within(form).getByLabelText('자리 수')
  await user.clear(cap)
  await user.type(cap, '6')
  await user.click(screen.getByTestId('agent-location-submit'))

  await waitFor(() =>
    expect(calls.updates).toEqual([{ id: 2, body: { name: 'PoC 2', description: 'iacloud-poc-smart · agent-runner', capacity: 6 } }]),
  )
  await waitFor(() => expect(screen.queryByTestId('agent-location-form')).not.toBeInTheDocument())
  expect(await screen.findByText('실행 위치를 바꿨습니다')).toBeInTheDocument()
  expect(screen.getByTestId('agent-location-seats-2')).toHaveTextContent('1 / 6')
  // 토큰 대화상자는 뜨지 않는다.
  expect(screen.queryByTestId('agent-location-token-dialog')).not.toBeInTheDocument()
})

test('자리 수는 지금 켜진 AI 수보다 적게 줄일 수 없다', async () => {
  const { user, calls } = await renderLocations()
  await pickMenu(user, 1, '이름·자리 수 바꾸기') // 운영: 3 / 4 사용 중
  const form = await screen.findByTestId('agent-location-form')
  const cap = within(form).getByLabelText('자리 수')
  await user.clear(cap)
  await user.type(cap, '2')
  expect(form).toHaveTextContent('지금 켜진 AI(3)보다 적게 줄일 수 없어요')
  expect(screen.getByTestId('agent-location-submit')).toBeDisabled()
  await user.clear(cap)
  await user.type(cap, '3')
  expect(screen.getByTestId('agent-location-submit')).toBeEnabled()
  expect(calls.updates).toEqual([])
})

test('⋯ › 토큰 재발급 — 확인 뒤 POST token, 새 토큰만 보이고 설치 순서는 없다', async () => {
  const { user, calls } = await renderLocations()
  await pickMenu(user, 1, '토큰 재발급')
  const confirm = await screen.findByRole('alertdialog')
  expect(confirm).toHaveTextContent('「운영」의 runner 토큰을 새로 만듭니다')
  // 확인 전에는 요청이 없다.
  expect(calls.rotates).toEqual([])
  await user.click(within(confirm).getByRole('button', { name: '재발급' }))

  await waitFor(() => expect(calls.rotates).toEqual([1]))
  const dialog = await screen.findByTestId('agent-location-token-dialog')
  expect(within(dialog).getByTestId('agent-location-token-plaintext')).toHaveTextContent('rt_ROTATED0123456789')
  expect(within(dialog).queryByTestId('agent-location-install-steps')).not.toBeInTheDocument()
  expect(dialog).toHaveTextContent('옛 토큰은 이미 끊겼습니다')
})

test('토큰 재발급 확인창에서 취소하면 요청이 없다', async () => {
  const { user, calls } = await renderLocations()
  await pickMenu(user, 1, '토큰 재발급')
  await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '취소' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  expect(calls.rotates).toEqual([])
  expect(screen.queryByTestId('agent-location-token-dialog')).not.toBeInTheDocument()
})

test('⋯ › 삭제 — 쓰는 AI 가 있으면 비활성이라 확인창이 열리지 않는다', async () => {
  const { user, calls } = await renderLocations()
  await user.click(screen.getByTestId('agent-location-menu-1'))
  const item = await screen.findByRole('menuitem', { name: '삭제 (쓰는 AI 가 있어 불가)' })
  expect(item).toHaveAttribute('aria-disabled', 'true')
  await user.click(item)
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  expect(calls.deletes).toEqual([])
})

test('⋯ › 삭제 — 쓰는 AI 가 없으면 확인 뒤 DELETE 하고 행이 사라진다', async () => {
  const { user, calls } = await renderLocations()
  await pickMenu(user, 3, '삭제')
  const confirm = await screen.findByRole('alertdialog')
  expect(confirm).toHaveTextContent('「사내 GPU」 위치를 삭제합니다')
  expect(calls.deletes).toEqual([])
  await user.click(within(confirm).getByRole('button', { name: '삭제' }))

  await waitFor(() => expect(calls.deletes).toEqual([3]))
  await waitFor(() => expect(screen.queryByTestId('agent-location-row-3')).not.toBeInTheDocument())
  expect(await screen.findByText('실행 위치를 삭제했습니다')).toBeInTheDocument()
})

test('삭제가 409 로 실패하면 서버 메시지 토스트가 뜨고 행은 남는다', async () => {
  const { user } = await renderLocations({ failDelete: true })
  await pickMenu(user, 3, '삭제')
  await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '삭제' }))
  expect(await screen.findByText('쓰는 AI 가 있어 지울 수 없습니다')).toBeInTheDocument()
  expect(screen.getByTestId('agent-location-row-3')).toBeInTheDocument()
})
