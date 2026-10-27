// 워커 안에서 문서를 이어 쓰는 E2E page(WP-1002) — E2E_REUSE_APP=1 일 때만 켠다.
// 왜: 테스트마다 새 컨텍스트에서 page.goto 로 앱을 처음 열면 번들 해석·실행·첫 렌더에 약 0.4초가 든다(전체의 약 20%).
// 같은 워커의 다음 테스트는 문서를 그대로 두고 앱(React 트리)만 처음부터 다시 띄운다(main.tsx 의 __e2eRemount) —
// 쿼리 캐시·인증·화면 상태·localStorage 는 테스트마다 처음 상태다.
//
// 문서 시작부터 손대야 하는 테스트는 알아서 예전처럼 연다: 테스트가 page.addInitScript·page.clock·exposeFunction·
// emulateMedia, 또는 context 의 시작 스크립트·권한·쿠키·라우트 등을 쓰면 그 테스트는 「더럽힘」으로 표시돼 goto 가 실제로
// 문서를 새로 열고, 끝나면 그 컨텍스트를 버려 다음 테스트에 남지 않는다.
import type { BrowserContext, BrowserContextOptions, Page, PlaywrightWorkerArgs, TestInfo } from '@playwright/test'

export const REUSE_APP = process.env.E2E_REUSE_APP === '1'

/** 다시 띄울 때 localStorage 로 줄 값을 쿠키로 넘기는 이름 — 문서를 새로 여는 첫 goto 에서 시작 스크립트가 읽는다. */
const STORAGE_COOKIE = '__e2e_ls'

type Slot = {
  context: BrowserContext
  page: Page
  /** 이 문서에 앱이 한 번이라도 떴는가 — 그 뒤 goto 는 다시 띄우기로 바뀐다. */
  booted: boolean
  /** 이번 테스트가 문서 시작부터 손댔는가 — goto 는 실제로 열고, 끝나면 컨텍스트를 버린다. */
  dirty: boolean
  /** 이번 테스트의 localStorage 시작 값(hasSession·동기화 네임스페이스 등). */
  storage: Record<string, string>
  /** 이번 테스트에서 이미 goto 했는가 — 두 번째부터는 새로고침처럼 저장소를 그대로 두고 앱만 다시 띄운다. */
  navigated: boolean
  /** 이번 테스트의 앱을 다시 띄우기로 열었는가 — 이 문서의 히스토리에는 앞 테스트들의 항목이 남아 있다. */
  remounted: boolean
  /** 이번 테스트가 단 page 이벤트 리스너 — 끝나면 뗀다. */
  listeners: Array<[string, (...args: unknown[]) => void]>
  viewport: { width: number; height: number } | null
  /** 터치 기기 컨텍스트인가(hasTouch) — 호버 자리 비우기를 건너뛰고 핀치 확대를 되돌린다. */
  hasTouch: boolean
  /** 서비스워커를 켠 컨텍스트인가 — 등록된 워커가 다음 테스트로 새므로 늘 새로 연다. */
  serviceWorkers: boolean
}

/** 워커 안 집계 — 앱만 다시 띄운 수·문서를 새로 연 수(워커가 끝날 때 한 줄 남겨 이어 쓰기가 실제로 먹는지 본다). */
const stats = { remount: 0, fresh: 0 }

const slotByPage = new WeakMap<Page, Slot>()
const slotByContext = new WeakMap<BrowserContext, Slot>()

/** 이 컨텍스트를 쓰는 이어 쓰기 칸. */
export function slotOfContext(context: BrowserContext): Slot | undefined {
  return slotByContext.get(context)
}

/** 이 page 가 이어 쓰는 page 인가. */
export function reusedSlot(page: Page): Slot | undefined {
  return slotByPage.get(page)
}

/** 이어 쓰는 page 의 이번 테스트 localStorage 시작 값을 정한다(문서를 다시 띄울 때 넣는다). */
export function setReusedStorage(page: Page, key: string, value: string) {
  const slot = slotByPage.get(page)
  if (slot) slot.storage[key] = value
}

// 문서 시작부터 손대는 API — 부르면 이번 테스트는 더럽힘.
const DIRTY_PAGE_METHODS = ['addInitScript', 'exposeFunction', 'exposeBinding', 'emulateMedia', 'setExtraHTTPHeaders', 'routeWebSocket'] as const
const DIRTY_CLOCK_METHODS = ['install', 'setFixedTime', 'setSystemTime', 'fastForward', 'runFor', 'pauseAt', 'resume'] as const
const DIRTY_CONTEXT_METHODS = [
  'addInitScript',
  'addCookies',
  'clearCookies',
  'grantPermissions',
  'clearPermissions',
  'route',
  'routeFromHAR',
  'routeWebSocket',
  'setOffline',
  'setGeolocation',
  'setExtraHTTPHeaders',
  'exposeFunction',
  'exposeBinding',
  'newPage',
] as const

/**
 * 워커당 컨텍스트·page 하나를 만들고 API 를 감싼다. installInit 은 fixture 가 늘 까는 시작 스크립트(애니메이션 끄기·SSE 래퍼)를
 * 감싸기 전 원래 addInitScript 로 한 번 등록한다.
 */
async function createSlot(
  browser: PlaywrightWorkerArgs['browser'],
  options: BrowserContextOptions,
  installInit: (page: Page) => Promise<void>,
): Promise<Slot> {
  const use = options
  const context = await browser.newContext(options)
  const page = await context.newPage()
  const slot: Slot = { context, page, booted: false, dirty: false, storage: {}, navigated: false, remounted: false, listeners: [], viewport: page.viewportSize(), hasTouch: !!options.hasTouch, serviceWorkers: options.serviceWorkers === 'allow' }
  slotByPage.set(page, slot)
  slotByContext.set(context, slot)

  // 다시 띄우기 장치를 켜고, 문서를 새로 열 때는 쿠키로 받은 localStorage 시작 값을 넣는다(쿠키는 바로 지운다).
  await page.addInitScript((cookieName) => {
    ;(window as unknown as { __E2E_REUSE_APP__: boolean }).__E2E_REUSE_APP__ = true
    const raw = document.cookie.split('; ').find((c) => c.startsWith(cookieName + '='))
    if (!raw) return
    document.cookie = `${cookieName}=; path=/; max-age=0`
    // 비우지는 않는다 — 시작 스크립트끼리의 순서는 정해져 있지 않아, 여기서 비우면 테스트가 단 시작 스크립트의 값까지 지울 수 있다.
    // 앞 테스트의 저장소는 goto 가 이동 전에 비운다.
    const values = JSON.parse(decodeURIComponent(raw.slice(cookieName.length + 1))) as Record<string, string>
    for (const [key, value] of Object.entries(values)) window.localStorage.setItem(key, value)
  }, STORAGE_COOKIE)
  await installInit(page)

  // 이 fixture 가 직접 부르는 쿠키 넣기는 감싸기 전 원래 함수를 쓴다(더럽힘으로 치지 않게).
  const addCookies = context.addCookies.bind(context)
  const markDirty = <T extends object>(target: T, names: readonly string[]) => {
    for (const name of names) {
      const original = (target as Record<string, unknown>)[name]
      if (typeof original !== 'function') continue
      ;(target as Record<string, unknown>)[name] = (...args: unknown[]) => {
        if (process.env.E2E_REUSE_DEBUG && !slot.dirty) console.log(`[e2e reuse] dirty by ${name}`)
        slot.dirty = true
        return (original as (...a: unknown[]) => unknown).apply(target, args)
      }
    }
  }
  markDirty(page, DIRTY_PAGE_METHODS)
  markDirty(page.clock, DIRTY_CLOCK_METHODS)
  markDirty(context, DIRTY_CONTEXT_METHODS)

  // 이벤트 리스너는 이번 테스트 것만 모아 두었다가 끝에 뗀다(다음 테스트의 요청·대화상자를 엿듣지 않게).
  for (const name of ['on', 'once', 'addListener'] as const) {
    const original = page[name].bind(page) as (event: string, fn: (...args: unknown[]) => void) => Page
    ;(page as unknown as Record<string, unknown>)[name] = (event: string, fn: (...args: unknown[]) => void) => {
      slot.listeners.push([event, fn])
      return original(event, fn)
    }
  }

  // goto — 앱이 이미 뜬 문서면 다시 띄우기, 아니면(첫 테스트·더럽힘) 실제로 연다.
  const originalGoto = page.goto.bind(page)
  page.goto = async (url, options) => {
    const target = new URL(url, use.baseURL)
    const sameOrigin = target.origin === new URL(use.baseURL ?? target.origin).origin
    if (slot.booted && !slot.dirty && sameOrigin && !page.url().startsWith('about:')) {
      await page.evaluate(
        ([path, storage]) =>
          (window as unknown as { __e2eRemount: (p: string, s: Record<string, string> | null) => Promise<void> }).__e2eRemount(path, storage),
        [target.pathname + target.search + target.hash, slot.navigated ? null : slot.storage] as const,
      )
      slot.navigated = true
      slot.remounted = true
      stats.remount++
      return null
    }
    // 테스트의 첫 이동일 때만 저장소 시작 값을 넘긴다 — 두 번째부터는 새로고침처럼 저장소를 그대로 둔다.
    // 앞 테스트가 이 출처에 남긴 저장소는 이동 전에 비운다(새 탭이면 비어 있다).
    if (!slot.navigated && slot.booted && page.url().startsWith(target.origin)) {
      await page.evaluate(() => {
        window.localStorage.clear()
        window.sessionStorage.clear()
      })
    }
    if (!slot.navigated) await addCookies([{ name: STORAGE_COOKIE, value: encodeURIComponent(JSON.stringify(slot.storage)), url: target.origin }])
    stats.fresh++
    const response = await originalGoto(url, options)
    if (sameOrigin) slot.booted = true
    slot.navigated = true
    return response
  }

  // goBack — 다시 띄운 앱의 첫 항목(라우터 idx 0)에서 뒤로 가면 새 탭은 about:blank 로 나가지만, 이어 쓰는 문서는
  // 앞 테스트의 마지막 주소로 간다. 새 탭과 같게 about:blank 로 보내고, 문서가 바뀌었으니 끝나면 컨텍스트를 버린다.
  const originalGoBack = page.goBack.bind(page)
  page.goBack = async (options) => {
    if (slot.remounted && (await page.evaluate(() => (history.state as { idx?: number } | null)?.idx === 0))) {
      slot.dirty = true
      await originalGoto('about:blank')
      return null
    }
    return originalGoBack(options)
  }
  return slot
}

/**
 * 워커 fixture 본체 — 브라우저 설정(뷰포트·터치·로캘 등) 조합마다 컨텍스트 하나를 이어 쓴다. 파일이 test.use 로 설정을 바꾸면
 * 그 조합의 컨텍스트를 따로 만들어 쓰므로 설정이 섞이지 않는다. 워커가 끝날 때 모두 닫는다.
 */
export function reuseSlotFixture(installInit: (page: Page) => Promise<void>) {
  return async (
    { browser }: PlaywrightWorkerArgs,
    use: (holder: ReuseHolder) => Promise<void>,
  ) => {
    const slots = new Map<string, Slot>()
    const holder: ReuseHolder = {
      get: async (options) => {
        const key = JSON.stringify(options)
        let slot = slots.get(key)
        if (!slot || slot.page.isClosed()) {
          slot = await createSlot(browser, options, installInit)
          slots.set(key, slot)
        }
        return slot
      },
      discard: async (slot) => {
        for (const [key, value] of slots) if (value === slot) slots.delete(key)
        await slot.context.close().catch(() => {})
      },
    }
    await use(holder)
    for (const slot of slots.values()) await slot.context.close().catch(() => {})
    console.log(`[e2e reuse] remount=${stats.remount} fresh=${stats.fresh}`)
  }
}

export type ReuseHolder = {
  get: (options: BrowserContextOptions) => Promise<Slot>
  discard: (slot: Slot) => Promise<void>
}

/** 테스트 시작 — 앞 테스트의 라우트를 걷고 뷰포트·상태를 되돌린다. */
export async function beginReusedTest(slot: Slot) {
  slot.dirty = false
  slot.navigated = false
  slot.remounted = false
  slot.storage = {}
  slot.listeners = []
  await slot.page.unrouteAll({ behavior: 'ignoreErrors' })
  // 앞 테스트가 마우스를 올려 둔 자리를 비운다 — 앱을 다시 띄워도 마우스가 이미 그 요소 위에 있으면 브라우저가 호버 이벤트를
  // 새로 내지 않아, 「올리면 나타난다」류 단언이 새 문서에서 어긋난다.
  // 터치 기기에는 호버가 없고, 새로 만든 탭은 비울 자리가 없다 — 이때 마우스를 움직이면 오히려 포인터 이벤트가 생긴다.
  if (slot.booted && !slot.hasTouch) await slot.page.mouse.move(0, 0)
  // 브라우저는 마지막 입력이 마우스였는지 키보드였는지를 문서가 바뀌어도 기억해, 스크립트로 준 초점의 :focus-visible 이 달라진다.
  // 새 탭은 키보드 쪽으로 본다 — 아무 동작에도 묶이지 않은 키를 한 번 눌러 같은 상태로 돌린다.
  if (slot.booted) await slot.page.keyboard.press('F9')
  // 앞 테스트가 핀치·두 번 탭으로 확대한 배율은 문서를 다시 그려도 남는다 — 새 탭처럼 1배로 되돌린다.
  if (slot.booted && slot.hasTouch) {
    const cdp = await slot.page.context().newCDPSession(slot.page)
    await cdp.send('Emulation.resetPageScaleFactor').finally(() => cdp.detach())
  }
  // 서비스워커를 켠 테스트는 등록이 남아 다음 테스트의 요청을 가로채므로 늘 새로 열고 끝나면 버린다.
  if (slot.serviceWorkers) slot.dirty = true
  if (slot.viewport) {
    const now = slot.page.viewportSize()
    if (!now || now.width !== slot.viewport.width || now.height !== slot.viewport.height) await slot.page.setViewportSize(slot.viewport)
  }
}

/** 테스트 끝 — 리스너·라우트를 걷고, 더럽혔거나 실패했으면 컨텍스트를 버린다(다음 테스트·재시도는 새로 연다). */
export async function endReusedTest(slot: Slot, testInfo: TestInfo, discard: (slot: Slot) => Promise<void>) {
  for (const [event, fn] of slot.listeners) slot.page.off(event as 'request', fn)
  slot.listeners = []
  const failed = testInfo.status !== testInfo.expectedStatus
  if (slot.dirty || failed || slot.page.isClosed()) {
    await discard(slot)
    return
  }
  // 라우트를 걷기 전에 앱을 내린다 — 언마운트 정리가 보내는 요청(채팅 읽음 처리 등)이 이 테스트의 목에서 끝나고,
  // 다음 테스트의 요청 추적에 섞이지 않는다. 짧은 지연은 정리가 건 0초 타이머까지 돌게 한다.
  if (slot.booted) {
    await slot.page.evaluate(async () => {
      ;(window as { __e2eUnmount?: () => void }).__e2eUnmount?.()
      await new Promise((r) => setTimeout(r, 50))
    }).catch(() => {}) // 앱 밖 주소(about:blank 등)면 내릴 앱이 없다
  }
  await slot.page.unrouteAll({ behavior: 'ignoreErrors' })
}
