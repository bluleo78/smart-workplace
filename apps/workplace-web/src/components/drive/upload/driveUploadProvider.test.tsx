/**
 * 앱 전역 드라이브 업로드 Provider 테스트 (WP-1534).
 * 상태 노출·캐시 무효화·로그아웃/사용자 전환 정리·언마운트 정리·beforeunload 를 본다.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, renderHook, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ReactNode, useState } from 'react'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, test, vi } from 'vitest'

import { AuthContext } from '@/hooks/auth-context-value'
import { driveKeys } from '@/hooks/queries/driveKeys'
import { emitIdentityChange } from '@/lib/auth/identityChange'
import { files } from '@/pages/drive/uploadTestUtils'
import { testAuthValue } from '@/test/renderWithProviders'

import {
  type DriveUploadContextValue,
  type DriveUploadLayoutValue,
  useDriveUpload,
  useDriveUploadLayout,
  useDriveUploadLayoutActions,
  useDriveUploadPanelLift,
} from './driveUploadContext'
import { DriveUploadPanelHost } from './DriveUploadPanelHost'
import { DriveUploadProvider } from './DriveUploadProvider'

const ROOT = { sid: 1, folderId: 1 }

/** 렌더 중 읽은 값을 테스트 쪽 상자에 담는다 — 컴포넌트 안에서 바깥 객체를 직접 고치면 React Compiler lint 가 막는다. */
function capture<T>(box: { current: T | null }, value: T) {
  box.current = value
}
/** 렌더 횟수를 센다(capture 와 같은 이유로 함수로 뺀다). */
function countRender(counter: { count: number }) {
  counter.count += 1
}

function deferred<T = unknown>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}

type User = typeof testAuthValue.user

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  const gates: Array<ReturnType<typeof deferred>> = []
  const signals: AbortSignal[] = []
  const upload = vi.fn(async (_r: unknown, _f: number | null, _file: File, signal: AbortSignal) => {
    const d = deferred()
    gates.push(d)
    signals.push(signal)
    await d.promise
  })
  const resolveFolder = vi.fn(async () => 1)
  const ref: { current: DriveUploadContextValue | null } = { current: null }
  function Probe() {
    capture(ref, useDriveUpload())
    return null
  }
  function ui(user: User) {
    return (
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={{ ...testAuthValue, user }}>
          <DriveUploadProvider upload={upload as never} resolveFolder={resolveFolder}>
            <Probe />
          </DriveUploadProvider>
        </AuthContext.Provider>
      </QueryClientProvider>
    )
  }
  const view = render(ui(testAuthValue.user))
  return { ...view, ui, ref, upload, gates, signals, invalidate }
}

function beforeUnloadPrevented() {
  const e = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(e)
  return e.defaultPrevented
}

describe('DriveUploadProvider', () => {
  test('start 하면 컨텍스트에 배치가 생기고 busy 가 된다', () => {
    const t = setup()
    let ok = false
    act(() => {
      ok = t.ref.current!.start(files(1), ROOT)
    })
    expect(ok).toBe(true)
    expect(t.ref.current!.batch!.items.length).toBe(1)
    expect(t.ref.current!.busy).toBe(true)
  })

  test('업로드가 끝나면 그 공간의 목록·용량 쿼리를 무효화한다', async () => {
    const t = setup()
    act(() => {
      t.ref.current!.start(files(1), ROOT)
    })
    await flush()
    t.gates[0].resolve(undefined)
    await flush()
    expect(t.invalidate).toHaveBeenCalledWith({ queryKey: driveKeys.itemsAll(1) })
    expect(t.invalidate).toHaveBeenCalledWith({ queryKey: driveKeys.quota })
  })

  test('upload prop 으로 받은 함수로 보낸다(WP-1520 자리)', async () => {
    const t = setup()
    const list = files(1)
    act(() => {
      t.ref.current!.start(list, ROOT)
    })
    await flush()
    expect(t.upload).toHaveBeenCalledTimes(1)
    expect(t.upload).toHaveBeenCalledWith(ROOT, 1, list[0].file, expect.any(AbortSignal), expect.any(Function))
  })

  test('로그아웃(user → null)하면 진행 중 요청을 끊고 큐를 비운다', async () => {
    const t = setup()
    act(() => {
      t.ref.current!.start(files(1), ROOT)
    })
    await flush()
    t.rerender(t.ui(null as never))
    expect(t.signals[0].aborted).toBe(true)
    expect(t.ref.current!.batch).toBeNull()
    expect(t.ref.current!.busy).toBe(false)
  })

  test('사용자가 바뀌면 큐를 비운다', async () => {
    const t = setup()
    act(() => {
      t.ref.current!.start(files(1), ROOT)
    })
    await flush()
    t.rerender(t.ui({ ...testAuthValue.user!, id: 2 }))
    expect(t.signals[0].aborted).toBe(true)
    expect(t.ref.current!.batch).toBeNull()
    t.gates[0].resolve(undefined)
    await flush()
    expect(t.ref.current!.batch).toBeNull()
  })

  test('같은 사용자의 다시 그리기는 큐를 건드리지 않는다', async () => {
    const t = setup()
    act(() => {
      t.ref.current!.start(files(1), ROOT)
    })
    await flush()
    t.rerender(t.ui({ ...testAuthValue.user! }))
    expect(t.ref.current!.batch).not.toBeNull()
    expect(t.signals[0].aborted).toBe(false)
  })

  test('Provider 가 내려가면 진행 중 요청을 끊는다', async () => {
    const t = setup()
    act(() => {
      t.ref.current!.start(files(1), ROOT)
    })
    await flush()
    t.unmount()
    expect(t.signals[0].aborted).toBe(true)
  })

  test('진행 중이면 beforeunload 를 막고, 끝나면 뗀다', async () => {
    const t = setup()
    act(() => {
      t.ref.current!.start(files(1), ROOT)
    })
    await flush()
    expect(beforeUnloadPrevented()).toBe(true)
    t.gates[0].resolve(undefined)
    await flush()
    expect(beforeUnloadPrevented()).toBe(false)
  })

  test('대기 중 파일만 남아도 beforeunload 를 막는다', async () => {
    const t = setup()
    act(() => {
      t.ref.current!.start(files(2), ROOT)
    })
    await flush()
    expect(beforeUnloadPrevented()).toBe(true)
  })

  test('취소하면 beforeunload 를 뗀다', async () => {
    const t = setup()
    act(() => {
      t.ref.current!.start(files(1), ROOT)
    })
    await flush()
    act(() => t.ref.current!.cancel())
    expect(beforeUnloadPrevented()).toBe(false)
    expect(t.ref.current!.batch).not.toBeNull()
  })

  test('업로드가 없으면 beforeunload 를 막지 않는다', () => {
    setup()
    expect(beforeUnloadPrevented()).toBe(false)
  })

  test('Provider 밖에서 useDriveUpload 를 부르면 오류', () => {
    const wrapper = ({ children }: { children: ReactNode }) => <>{children}</>
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => useDriveUpload(), { wrapper })).toThrow('DriveUploadProvider')
  })
})

/** 호스트 테스트 장치 — 라우트 둘(/drive·/projects)과 링크 둘, Provider 안의 패널 호스트를 띄운다. */
function setupHost() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const gates: Array<ReturnType<typeof deferred> & { reject: (e: unknown) => void }> = []
  const signals: AbortSignal[] = []
  const progress: Array<(p: number) => void> = []
  const upload = vi.fn(async (_r: unknown, _f: number | null, _file: File, signal: AbortSignal, onProgress: (p: number) => void) => {
    let resolve!: (v?: unknown) => void
    let reject!: (e: unknown) => void
    const promise = new Promise((res, rej) => {
      resolve = res
      reject = rej
    })
    gates.push({ promise, resolve, reject })
    signals.push(signal)
    progress.push(onProgress)
    await promise
  })
  const ref: { current: DriveUploadContextValue | null } = { current: null }
  function Probe() {
    capture(ref, useDriveUpload())
    return null
  }
  function ui(user: User) {
    return (
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={{ ...testAuthValue, user }}>
          <MemoryRouter initialEntries={['/drive']}>
            <DriveUploadProvider upload={upload as never} resolveFolder={async () => 1}>
              <Probe />
              <Link to="/projects">이슈로</Link>
              <Routes>
                <Route path="/drive" element={<p>드라이브 화면</p>} />
                <Route path="/projects" element={<p>이슈 화면</p>} />
              </Routes>
              <DriveUploadPanelHost />
            </DriveUploadProvider>
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>
    )
  }
  const view = render(ui(testAuthValue.user))
  const startAndMove = async () => {
    act(() => {
      ref.current!.start(files(1), ROOT)
    })
    await flush()
    await userEvent.click(screen.getByText('이슈로'))
    expect(screen.getByText('이슈 화면')).toBeTruthy()
  }
  return { ...view, ui, ref, gates, signals, progress, startAndMove }
}

describe('DriveUploadPanelHost', () => {
  test('다른 메뉴로 옮겨도 패널이 남아 진행률이 올라간다', async () => {
    const t = setupHost()
    await t.startAndMove()
    const panel = screen.getByTestId('drive-upload-panel')
    act(() => t.progress[0](40))
    expect(screen.getByTestId('drive-upload-panel')).toBe(panel)
    expect(screen.getByTestId('drive-upload-row').textContent).toContain('40%')
    const bars = within(panel).getAllByRole('progressbar')
    expect(bars.some((b) => b.getAttribute('aria-valuenow') === '40')).toBe(true)
  })

  test('다른 메뉴에서 취소할 수 있다', async () => {
    const t = setupHost()
    await t.startAndMove()
    await userEvent.click(screen.getByTestId('drive-upload-panel-cancel'))
    expect(t.signals[0].aborted).toBe(true)
    expect(screen.getByText('업로드를 취소했어요 · 0개 완료')).toBeTruthy()
  })

  test('다른 메뉴에 있는 동안 끝나면 완료가 보인다(파일 하나)', async () => {
    const t = setupHost()
    await t.startAndMove()
    t.gates[0].resolve(undefined)
    await flush()
    expect(screen.getByText('1개 업로드 완료')).toBeTruthy()
  })

  test('다른 메뉴에 있는 동안 실패하면 실패가 보인다', async () => {
    const t = setupHost()
    await t.startAndMove()
    t.gates[0].reject(new Error('서버 오류'))
    await flush()
    expect(screen.getByText('0개 완료 · 1개 실패')).toBeTruthy()
  })

  test('로그아웃하면 패널이 사라진다', async () => {
    const t = setupHost()
    await t.startAndMove()
    expect(screen.getByTestId('drive-upload-panel')).toBeTruthy()
    t.rerender(t.ui(null as never))
    expect(screen.queryByTestId('drive-upload-panel')).toBeNull()
  })
})

describe('신원 바뀜·memo (WP-1534)', () => {
  test('신원 바뀜 알림을 받으면 user 가 다시 그려지기 전에 그 자리에서 끊고 비운다', async () => {
    const t = setup()
    act(() => {
      t.ref.current!.start(files(1), ROOT)
    })
    await flush()
    // 다시 그리기 없이 알림만 — 동기로 끊겼는지 바로 본다(토큰을 비우기 전 시점).
    emitIdentityChange()
    expect(t.signals[0].aborted).toBe(true)
    await flush()
    expect(t.ref.current!.batch).toBeNull()
    // 늦게 끝난 응답이 배치를 되살리지 않는다
    t.gates[0].resolve(undefined)
    await flush()
    expect(t.ref.current!.batch).toBeNull()
  })

  test('Provider 가 내려간 뒤의 알림은 아무것도 하지 않는다(구독을 뗀다)', () => {
    const t = setup()
    t.unmount()
    expect(() => emitIdentityChange()).not.toThrow()
  })

  test('큐가 그대로면 다시 그려져도 컨텍스트 값이 같은 객체다', async () => {
    const t = setup()
    act(() => {
      t.ref.current!.start(files(1), ROOT)
    })
    await flush()
    const before = t.ref.current
    t.rerender(t.ui({ ...testAuthValue.user! }))
    expect(t.ref.current).toBe(before)
  })
})

/** 배치 컨텍스트 장치 — 큐 구독자의 렌더 수, 배치 값, 배치 동작을 함께 본다. */
function setupLayout(children: ReactNode) {
  const queueRenders = { count: 0 }
  const layoutRef: { current: DriveUploadLayoutValue | null } = { current: null }
  const actionsRef: { current: ReturnType<typeof useDriveUploadLayoutActions> | null } = { current: null }
  function QueueProbe() {
    useDriveUpload()
    countRender(queueRenders)
    return null
  }
  function LayoutProbe() {
    capture(layoutRef, useDriveUploadLayout())
    capture(actionsRef, useDriveUploadLayoutActions())
    return null
  }
  const queryClient = new QueryClient()
  const view = render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={testAuthValue}>
        <DriveUploadProvider upload={(async () => {}) as never} resolveFolder={async () => 1}>
          <QueueProbe />
          <LayoutProbe />
          {children}
        </DriveUploadProvider>
      </AuthContext.Provider>
    </QueryClientProvider>,
  )
  return { ...view, queueRenders, layoutRef, actionsRef }
}

/** 비킴 등록자 — 단추로 스스로 내려간다. */
function LiftRegistrant({ lift, label }: { lift: string | undefined; label: string }) {
  const [on, setOn] = useState(true)
  return (
    <>
      <button type="button" onClick={() => setOn(false)}>
        {label} 내리기
      </button>
      {on && <LiftHook lift={lift} />}
    </>
  )
}
function LiftHook({ lift }: { lift: string | undefined }) {
  useDriveUploadPanelLift(lift)
  return null
}

describe('패널 배치 컨텍스트 (WP-1534)', () => {
  test('패널 높이가 바뀌어도 큐 구독자는 다시 그려지지 않는다', () => {
    const t = setupLayout(null)
    const before = t.queueRenders.count
    act(() => t.actionsRef.current!.setPanelHeight(120))
    expect(t.layoutRef.current!.panelHeight).toBe(120)
    act(() => t.actionsRef.current!.setPanelHeight(240))
    expect(t.layoutRef.current!.panelHeight).toBe(240)
    expect(t.queueRenders.count).toBe(before)
  })

  test('비킴 등록자가 둘이면 한쪽이 내려가도 다른 쪽 값이 남는다', async () => {
    const t = setupLayout(
      <>
        <LiftRegistrant lift="3rem" label="첫째" />
        <LiftRegistrant lift="5rem" label="둘째" />
      </>,
    )
    // 마지막에 건 값이 이긴다
    expect(t.layoutRef.current!.mobileLift).toBe('5rem')
    await userEvent.click(screen.getByText('둘째 내리기'))
    expect(t.layoutRef.current!.mobileLift).toBe('3rem')
    await userEvent.click(screen.getByText('첫째 내리기'))
    expect(t.layoutRef.current!.mobileLift).toBeUndefined()
  })

  test('먼저 건 등록자가 내려가도 나중 등록자의 값은 지워지지 않는다', async () => {
    const t = setupLayout(
      <>
        <LiftRegistrant lift="3rem" label="첫째" />
        <LiftRegistrant lift="5rem" label="둘째" />
      </>,
    )
    await userEvent.click(screen.getByText('첫째 내리기'))
    expect(t.layoutRef.current!.mobileLift).toBe('5rem')
  })

  test('값이 없는(undefined) 등록자는 다른 등록자의 값을 가리지 않는다', () => {
    const t = setupLayout(
      <>
        <LiftRegistrant lift="3rem" label="첫째" />
        <LiftRegistrant lift={undefined} label="둘째" />
      </>,
    )
    expect(t.layoutRef.current!.mobileLift).toBe('3rem')
  })
})

describe('안쪽(inline) 호스트 (WP-1534)', () => {
  function setupInline() {
    const ref: { current: DriveUploadContextValue | null } = { current: null }
    function Probe() {
      capture(ref, useDriveUpload())
      return null
    }
    function Drawer() {
      const [open, setOpen] = useState(true)
      return (
        <>
          <button type="button" onClick={() => setOpen(false)}>
            드로워 닫기
          </button>
          {open && (
            <div data-testid="drawer">
              <DriveUploadPanelHost placement="inline" />
            </div>
          )}
        </>
      )
    }
    const queryClient = new QueryClient()
    const cancelled: AbortSignal[] = []
    render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={testAuthValue}>
          <DriveUploadProvider
            upload={((_r: unknown, _f: unknown, _file: File, signal: AbortSignal) => {
              cancelled.push(signal)
              return new Promise(() => {})
            }) as never}
            resolveFolder={async () => 1}
          >
            <Probe />
            <Drawer />
            <DriveUploadPanelHost />
          </DriveUploadProvider>
        </AuthContext.Provider>
      </QueryClientProvider>,
    )
    return { ref, cancelled }
  }

  test('안쪽 호스트가 있는 동안 패널은 그 안에만 하나 그려지고 거기서 취소할 수 있다', async () => {
    const t = setupInline()
    act(() => {
      t.ref.current!.start(files(1), ROOT)
    })
    await flush()
    const panels = screen.getAllByTestId('drive-upload-panel')
    expect(panels).toHaveLength(1)
    expect(within(screen.getByTestId('drawer')).getByTestId('drive-upload-panel')).toBe(panels[0])
    expect(panels[0]).toHaveAttribute('data-placement', 'inline')
    await userEvent.click(within(panels[0]).getByTestId('drive-upload-panel-cancel'))
    expect(t.cancelled[0].aborted).toBe(true)
  })

  test('안쪽 호스트가 내려가면 떠 있는 패널이 다시 보인다', async () => {
    const t = setupInline()
    act(() => {
      t.ref.current!.start(files(1), ROOT)
    })
    await flush()
    await userEvent.click(screen.getByText('드로워 닫기'))
    const panel = screen.getByTestId('drive-upload-panel')
    expect(panel).toHaveAttribute('data-placement', 'floating')
    expect(within(panel).getByText('업로드 0/1')).toBeTruthy()
  })
})
