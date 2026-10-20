// useMailAiDraft(WP-576) — 중지·닫기·작성창 교체(reset) 뒤 늦게 도착한 응답·실패는 반영하지 않는다. 제목은 응답 때의 값으로 판정.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { AxiosError, AxiosHeaders } from 'axios'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComposeDraftRequest, ComposeDraftResult } from '../../types/mailMessage'

/** 요청마다 손으로 풀어 주는 응답 — 신호(abort)를 무시해 "끊었는데 늦게 도착"을 흉내 낸다(훅은 signal.aborted 로 버려야 한다). */
interface Pending {
  req: ComposeDraftRequest
  resolve: (r: ComposeDraftResult) => void
  reject: (e: unknown) => void
}
const pending: Pending[] = []
vi.mock('../../api/mailMessages', () => ({
  generateComposeDraft: (_accountId: number, req: ComposeDraftRequest) =>
    new Promise<ComposeDraftResult>((resolve, reject) => pending.push({ req, resolve, reject })),
}))

import { useMailAiDraft } from './useMailAiDraft'

const ctx = { to: ['a@x.com'], cc: [], subject: '', html: '<p></p>' }
const RESULT: ComposeDraftResult = { subject: 'AI 제목', body: '본문' }

function setup() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  const invalidate = vi.spyOn(qc, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  const hook = renderHook(() => useMailAiDraft(1), { wrapper })
  act(() => hook.result.current.setInstruction('회의 연기 요청'))
  return { ...hook, invalidate }
}

/**
 * 생성 시작 — 요청(generateComposeDraft 직접 호출)이 나간 것을 확인하고, 결과 Promise 를 { out } 으로 감싸 돌려준다
 * (async 함수가 Promise 를 그대로 돌려주면 그 응답까지 기다려 버린다).
 */
async function start(
  result: { current: ReturnType<typeof useMailAiDraft> },
  readSubject = () => '',
  typingElsewhere = () => false,
) {
  let out!: Promise<unknown>
  const before = pending.length
  act(() => {
    out = result.current.generate(ctx, () => ({ subject: readSubject(), typingElsewhere: typingElsewhere() }))
  })
  await vi.waitFor(() => expect(pending.length).toBe(before + 1))
  return { out }
}

function axiosError(status: number, data: object) {
  return new AxiosError('fail', String(status), undefined, undefined, {
    status,
    statusText: '',
    headers: {},
    config: { headers: new AxiosHeaders() },
    data,
  })
}

beforeEach(() => {
  pending.length = 0
})

describe('useMailAiDraft — 늦게 온 응답 무시', () => {
  it.each([
    ['stop', 'input'],
    ['close', 'closed'],
    ['reset', 'closed'],
  ] as const)('%s 뒤 도착한 응답은 null 이고 상태를 바꾸지 않는다', async (action, phase) => {
    const { result } = setup()
    const out = (await start(result)).out
    expect(result.current.phase).toBe('generating')
    act(() => result.current[action]())
    await act(async () => {
      pending[0].resolve(RESULT)
      expect(await out).toBeNull()
    })
    expect(result.current.phase).toBe(phase)
    expect(result.current.filled).toBe(false)
  })

  it('stop 뒤 도착한 실패도 오류로 보이지 않는다', async () => {
    const { result } = setup()
    const out = (await start(result)).out
    act(() => result.current.stop())
    await act(async () => {
      pending[0].reject(axiosError(502, { message: '실패' }))
      expect(await out).toBeNull()
    })
    expect(result.current.phase).toBe('input')
    expect(result.current.error).toBeNull()
  })

  it('다시 생성하면 앞 요청의 늦은 응답은 버리고 마지막 응답만 반영한다', async () => {
    const { result } = setup()
    const first = (await start(result)).out
    const second = (await start(result)).out
    await act(async () => {
      pending[0].resolve({ subject: '옛', body: '옛 본문' })
      expect(await first).toBeNull()
      pending[1].resolve(RESULT)
      expect(await second).toEqual({ html: '<p>본문</p>', subject: 'AI 제목', focusBody: true })
    })
    expect(result.current.filled).toBe(true)
  })
})

describe('useMailAiDraft — 제목·오류', () => {
  it('응답 때 제목이 요청 때와 다르면(생성 중 사용자가 씀) 그 제목을 지킨다', async () => {
    const { result } = setup()
    let now = ''
    const out = (await start(result, () => now)).out
    now = '생성 중 쓴 제목'
    await act(async () => {
      pending[0].resolve(RESULT)
      expect(await out).toEqual({ html: '<p>본문</p>', subject: '생성 중 쓴 제목', focusBody: true })
    })
  })

  it('응답이 도착한 순간 다른 칸에 쓰고 있었으면 focusBody=false(초점을 빼앗지 않음)', async () => {
    const { result } = setup()
    let typing = false
    const out = (await start(result, () => '', () => typing)).out
    typing = true
    await act(async () => {
      pending[0].resolve(RESULT)
      expect(await out).toEqual({ html: '<p>본문</p>', subject: 'AI 제목', focusBody: false })
    })
  })

  it('되돌리기 — AI 제목 그대로면 생성 직전 제목, 사용자가 고쳤으면 고친 제목', async () => {
    const { result } = setup()
    const out = (await start(result)).out
    await act(async () => {
      pending[0].resolve(RESULT)
      await out
    })
    let undone: unknown
    act(() => {
      undone = result.current.undo('AI 제목')
    })
    expect(undone).toEqual({ html: '<p></p>', subject: '' })

    const again = (await start(result)).out
    await act(async () => {
      pending[1].resolve(RESULT)
      await again
    })
    act(() => {
      undone = result.current.undo('내가 고친 제목')
    })
    expect(undone).toEqual({ html: '<p></p>', subject: '내가 고친 제목' })
  })

  it('영구 사유(AI_DISABLED)면 permanent 오류 + 계정 목록 무효화, 코드 없는 503 은 재시도 가능', async () => {
    const { result, invalidate } = setup()
    let out = (await start(result)).out
    await act(async () => {
      pending[0].reject(axiosError(503, { message: 'AI 비서가 꺼져 있어요', errors: { code: 'AI_DISABLED' } }))
      await out
    })
    expect(result.current.error).toEqual({ message: 'AI 비서가 꺼져 있어요', permanent: true })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['mail-accounts'] })

    invalidate.mockClear()
    out = (await start(result)).out
    await act(async () => {
      pending[1].reject(axiosError(503, { message: '잠시 후 다시 시도해주세요' }))
      await out
    })
    expect(result.current.error).toEqual({ message: '잠시 후 다시 시도해주세요', permanent: false })
    expect(invalidate).not.toHaveBeenCalled()

    // 실패는 오류 단계에서만 보인다 — 패널을 다시 열거나 닫으면 따로 비우지 않아도 사라진다.
    act(() => result.current.open())
    expect(result.current.phase).toBe('input')
    expect(result.current.error).toBeNull()
  })
})
