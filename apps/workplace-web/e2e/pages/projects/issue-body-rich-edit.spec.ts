// 이슈 본문 편집칸(본문 모드 RichInput, WP-1656) E2E — 브라우저가 있어야 판정되는 것만 둔다.
// 실제 클립보드 붙여넣기·복사 줄 간격·한글 조합 Enter·이미지 붙여넣기 자리표시 → 그림(@input), 390px 폭 안에 편집칸·넓은 이미지(@layout),
// 긴 본문(줄 1,000개·약 4만 9천 자)에서 타이핑 반응 시간 측정(@input).
// 원문 보존(열고 저장 = PATCH 없음, 한 글자 고침 = 그 글자만), 업로드 중 저장·단축키·Esc 막힘, 초안 불러오기, 5만 자 안내는
// 페이지 테스트(src/pages/projects/issueDetailEdit.test.tsx·issueBodyImages.test.tsx)가 지킨다.
import type { Locator, Page } from '@playwright/test'

import { expect, test } from '../../fixtures/auth.fixture'
import { commitImeThenEnterInSameTask } from '../../fixtures/ime'
import { solidPng } from '../../fixtures/png'
import { trackRequests } from '../../fixtures/requests'
import { createIssue, createIssueDetail } from '../../factories/issue.factory'
import { createProject } from '../../factories/project.factory'

const KEY = 'WP'
const DETAIL = `/api/v1/projects/${KEY}/issues/1`
const IMG_URL = `/api/v1/projects/${KEY}/issue-images/77`
const json = (b: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(b) })

/**
 * 이슈 1 상세 스텁 — 본문은 가변(PATCH 가 바꾸고 다시 불러오면 새 본문). 돌려주는 patches 는 보낸 PATCH 본문 기록이다.
 * 상세가 부르는 부속 조회(구성원·구독·라벨·첨부·드라이브)는 빈 목록.
 */
async function setupDetail(page: Page, body: string) {
  const state = { body }
  const patches = trackRequests(page, 'PATCH', DETAIL)
  await page.route(`**/api/v1/projects/${KEY}`, (r) => r.fulfill(json(createProject())))
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/members`, (r) => r.fulfill(json([])))
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/labels`, (r) => r.fulfill(json([])))
  await page.route((u) => u.pathname === '/api/v1/drive/spaces', (r) => r.fulfill(json([])))
  await page.route(
    (u) => ['watchers', 'labels', 'attachments', 'drive-links'].some((s) => u.pathname === `${DETAIL}/${s}`),
    (r) => r.fulfill(json([])),
  )
  await page.route(
    (u) => u.pathname === DETAIL,
    (r) => {
      if (r.request().method() === 'PATCH') {
        const p = r.request().postDataJSON() as { body?: string }
        if (typeof p.body === 'string') state.body = p.body
        return r.fulfill(json(createIssue({ id: 1, number: 1, title: '본문 편집 대상' })))
      }
      return r.fulfill(
        json(createIssueDetail({ summary: createIssue({ id: 1, number: 1, title: '본문 편집 대상' }), body: state.body, comments: [], history: [], attachments: [] })),
      )
    },
  )
  return { patches, state }
}

/** 상세를 열고 본문 편집칸을 연다 — 본문 왼쪽 위 끝을 누른다(가운데의 이미지를 누르면 편집이 아니라 미리보기가 열린다). */
async function openEditor(page: Page): Promise<Locator> {
  await page.goto(`/projects/${KEY}/issues/1`)
  await page.getByRole('button', { name: '본문 편집' }).click({ position: { x: 4, y: 4 } })
  const editor = page.getByTestId('issue-body-textarea')
  await expect(editor).toBeFocused()
  return editor
}

/** 편집칸에 클립보드 붙여넣기 — 실제 ClipboardEvent 를 편집칸에 보낸다(text/plain, 있으면 text/html 함께). */
async function pasteText(editor: Locator, plain: string, html?: string) {
  await editor.evaluate(
    (el, { plain, html }) => {
      const dt = new DataTransfer()
      if (html) dt.setData('text/html', html)
      dt.setData('text/plain', plain)
      el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }))
    },
    { plain, html },
  )
}

/**
 * 편집기 선택 — 첫 줄 끝 위치(firstEnd)와 지금 선택 양 끝. 편집기는 selectionchange 를 받아 선택을 반영하므로,
 * 키·클릭 뒤 다음 동작(붙여넣기·복사) 전에 반영됐는지 이것으로 기다린다(사람 손 속도에선 늘 반영돼 있다).
 */
function selectionOf(editor: Locator) {
  return editor.evaluate((el) => {
    type PM = { state: { doc: { firstChild: { nodeSize: number } }; selection: { from: number; to: number } } }
    const { state } = (el as HTMLElement & { editor: PM }).editor
    return { firstEnd: state.doc.firstChild.nodeSize - 1, from: state.selection.from, to: state.selection.to }
  })
}

/** 편집칸 첫 줄 끝에 커서를 둔다(첫 줄을 누르고 End) — 편집기 선택에 반영될 때까지 기다린다. */
async function caretToFirstLineEnd(editor: Locator) {
  await editor.locator('p').first().click()
  await editor.page().keyboard.press('End')
  await expect.poll(async () => {
    const s = await selectionOf(editor)
    return s.from === s.firstEnd && s.to === s.firstEnd
  }).toBe(true)
}

test.describe('이슈 본문 편집칸 — 클립보드(WP-1656)', { tag: '@input' }, () => {
  // 붙여넣은 글자는 줄 단위 그대로(빈 줄·앞 공백·탭·꺾쇠, \r\n 은 \n) — 저장한 원문에서 붙여넣은 부분이 클립보드 글자와 같다.
  test('일반 글자 붙여넣기 — 저장한 본문의 붙여넣은 부분이 클립보드 글자와 같다', async ({ authenticatedPage: page }) => {
    const { patches } = await setupDetail(page, '첫 줄\n끝 줄')
    const editor = await openEditor(page)
    await caretToFirstLineEnd(editor)
    await pasteText(editor, 'A\r\n\r\n  B\tC <div>x</div>\r\n| 1 | 2 |\r\n')
    await page.keyboard.press('ControlOrMeta+Enter')
    await expect.poll(() => patches.lastBody<{ body: string }>()?.body).toBe('첫 줄A\n\n  B\tC <div>x</div>\n| 1 | 2 |\n\n끝 줄')
  })

  // 웹 페이지·문서에서 복사하면 HTML 이 함께 온다 — 서식으로 읽지 않고 일반 글자만 그대로 넣는다.
  test('일반 글자+HTML 붙여넣기 — HTML 이 아니라 일반 글자가 그대로 들어간다', async ({ authenticatedPage: page }) => {
    const { patches } = await setupDetail(page, '첫 줄\n끝 줄')
    const editor = await openEditor(page)
    await caretToFirstLineEnd(editor)
    const plain = '**굵게** 아님\n\n- 목록 아님\n    들여쓴 줄'
    await pasteText(editor, plain, '<p><b>굵게</b> 아님</p><ul><li>목록 아님</li></ul><pre>    들여쓴 줄</pre>')
    await page.getByTestId('issue-body-save').click()
    await expect.poll(() => patches.lastBody<{ body: string }>()?.body).toBe(`첫 줄${plain}\n끝 줄`)
  })

  // 복사는 문단 사이 줄바꿈 하나 — 기본(\n\n)이면 메모장에 붙였을 때 줄 간격이 두 배가 된다.
  test('여러 줄을 골라 복사하면 원문과 같은 줄 간격의 글자가 클립보드에 실린다', async ({ authenticatedPage: page }) => {
    const body = '첫 줄\n\n  셋째 줄 <꺾쇠>\n넷째 줄'
    await setupDetail(page, body)
    const editor = await openEditor(page)
    // 편집기가 copy 이벤트에 실은 글자를 문서 단계에서 읽어 둔다(편집기 처리 뒤).
    await page.evaluate(() => {
      document.addEventListener('copy', (e) => {
        ;(window as unknown as { __copied?: string }).__copied = e.clipboardData?.getData('text/plain')
      })
    })
    await page.keyboard.press('ControlOrMeta+a')
    await expect.poll(async () => (await selectionOf(editor)).to - (await selectionOf(editor)).from).toBeGreaterThan(body.length)
    await page.keyboard.press('ControlOrMeta+c')
    await expect.poll(() => page.evaluate(() => (window as unknown as { __copied?: string }).__copied)).toBe(body)
    // 첫 줄 끝에서 셋째 줄까지(빈 줄 포함) 골라도 같은 규칙이다.
    await caretToFirstLineEnd(editor)
    await page.keyboard.press('Shift+ArrowDown')
    await page.keyboard.press('Shift+ArrowDown')
    // 편집기가 고른 범위(첫 줄 끝 ~ 셋째 줄)를 반영한 뒤 복사한다.
    await expect.poll(async () => {
      const s = await selectionOf(editor)
      return s.from === s.firstEnd && s.to > s.firstEnd + 4
    }).toBe(true)
    await page.keyboard.press('ControlOrMeta+c')
    await expect.poll(() => page.evaluate(() => (window as unknown as { __copied?: string }).__copied)).toMatch(/^\n\n {2}셋째/)
  })
})

test.describe('이슈 본문 편집칸 — 한글 조합(WP-1656)', { tag: '@input' }, () => {
  // macOS Chrome 은 마지막 글자 조합 중 Enter 를 확정(DOM 변경) → compositionend → Enter 를 한 태스크로 보낸다 — 글자가 남고 줄이 바뀐다.
  test('마지막 글자 조합 중 Enter — 글자가 남고 다음 줄로 넘어가며, 저장하지 않는다', async ({ authenticatedPage: page }) => {
    const { patches } = await setupDetail(page, '첫 줄')
    const editor = await openEditor(page)
    await page.keyboard.insertText(' 가나')
    await commitImeThenEnterInSameTask(editor, { composing: '닥', committed: '다' })
    await page.keyboard.insertText('둘째')
    await expect(editor.locator('p')).toHaveText(['첫 줄 가나다', '둘째'])
    expect(patches.count()).toBe(0)
    await page.keyboard.press('ControlOrMeta+Enter')
    await expect.poll(() => patches.lastBody<{ body: string }>()?.body).toBe('첫 줄 가나다\n둘째')
  })
})

test.describe('이슈 본문 편집칸 — 멤버가 아닌 @단어(WP-1656)', { tag: '@input' }, () => {
  // @Override·@media 처럼 맞는 멤버가 없는 @단어 뒤에서도 Enter 는 줄바꿈, Ctrl/⌘+Enter 는 저장이다(빈 자동완성이 키를 먹지 않는다).
  test('맞는 멤버가 없는 @단어 뒤 Enter 는 줄을 바꾸고 Ctrl/⌘+Enter 는 저장한다', async ({ authenticatedPage: page }) => {
    const { patches } = await setupDetail(page, '코드')
    const editor = await openEditor(page)
    await page.keyboard.type(' @Override')
    await page.keyboard.press('Enter')
    await page.keyboard.type('void run()')
    await expect(editor.locator('p')).toHaveText(['코드 @Override', 'void run()'])
    await page.keyboard.press('ControlOrMeta+Enter')
    await expect.poll(() => patches.lastBody<{ body: string }>()?.body).toBe('코드 @Override\nvoid run()')
  })
})

test.describe('이슈 본문 편집칸 — 이미지(WP-1656)', () => {
  // 붙여넣은 이미지는 업로드 중 자리표시 → 다 올리면 칸 안 그림. 그 크기는 저장한 뒤 보기 화면의 그림과 같다.
  test('이미지 붙여넣기 — 자리표시 뒤 칸 안 그림이 되고, 저장 뒤 보기 화면과 같은 크기다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    const { patches } = await setupDetail(page, '재현 화면')
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    await page.route(`**/api/v1/projects/${KEY}/issue-images`, async (route) => {
      await gate
      await route.fulfill({ ...json({ fileId: 77, url: IMG_URL, name: 'shot.png', mimeType: 'image/png', size: 70 }), status: 201 })
    })
    await page.route(`**${IMG_URL}`, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: solidPng(240, 120) }))
    const editor = await openEditor(page)
    await editor.evaluate((el) => {
      const dt = new DataTransfer()
      dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'shot.png', { type: 'image/png' }))
      el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }))
    })
    const node = editor.getByTestId('rich-image')
    await expect(node).toHaveAttribute('data-pending', 'true')
    await expect(node).toHaveText('업로드 중…')
    await expect(page.getByTestId('issue-body-save')).toBeDisabled()

    release()
    const img = node.locator('img')
    await expect(img).toHaveAttribute('src', /^blob:/)
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(240)
    const inEditor = await img.boundingBox()
    // 작은 이미지는 늘리지도 줄이지도 않는다(썸네일 아님) — 본래 크기 + 테두리 1px 씩.
    expect(Math.round(inEditor!.width)).toBe(242)
    expect(Math.round(inEditor!.height)).toBe(122)

    await page.getByTestId('issue-body-save').click()
    await expect.poll(() => patches.lastBody<{ body: string }>()?.body).toBe(`재현 화면\n![shot.png](${IMG_URL})\n`)
    const viewImg = page.getByRole('button', { name: '본문 편집' }).getByRole('img', { name: 'shot.png' })
    await expect.poll(() => viewImg.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(240)
    const inView = await viewImg.boundingBox()
    expect(Math.round(inView!.width)).toBe(Math.round(inEditor!.width))
    expect(Math.round(inView!.height)).toBe(Math.round(inEditor!.height))
  })

  // 모바일 폭에서 편집칸과 넓은 이미지가 화면 폭 안에 들어온다(이미지는 칸 폭까지 비율대로 줄어든다).
  test.describe('390px', () => {
    test.use({ viewport: { width: 390, height: 844 } })
    test('편집칸과 넓은 이미지가 화면 폭 안에 있다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
      await setupDetail(page, `넓은 그림\n![wide.png](${IMG_URL})\n끝`)
      await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/issues/1/chat/thread`, (r) => r.fulfill(json(null)))
      await page.route(`**${IMG_URL}`, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: solidPng(1600, 400) }))
      const editor = await openEditor(page)
      const img = editor.getByTestId('rich-image').locator('img')
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1600)
      const e = await editor.boundingBox()
      const i = await img.boundingBox()
      expect(e!.x).toBeGreaterThanOrEqual(0)
      expect(e!.x + e!.width).toBeLessThanOrEqual(390)
      expect(i!.x).toBeGreaterThanOrEqual(e!.x)
      expect(i!.x + i!.width).toBeLessThanOrEqual(e!.x + e!.width)
      // 비율을 지켜 줄었다(1600×400 → 폭에 맞춘 4:1).
      expect(Math.abs((i!.width - 2) / (i!.height - 2) - 4)).toBeLessThan(0.1)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    })
  })
})

test.describe('이슈 본문 편집칸 — 긴 본문 타이핑(WP-1656)', () => {
  // 줄 1,000개·약 4만 9천 자 본문 끝에 20자를 친다 — 키마다 keydown → 다음 requestAnimationFrame 까지 시간을 재 기록한다.
  // 기계 부하에 흔들리므로 단언은 느슨하게(중앙값) 두고 수치는 콘솔·주석으로 남긴다.
  test('줄 1,000개 본문 끝에서 타이핑해도 키 입력이 바로 반영된다', { tag: '@input' }, async ({ authenticatedPage: page }, testInfo) => {
    const body = Array.from({ length: 1000 }, (_, i) => `${String(i + 1).padStart(4, '0')} 번째 줄 — 긴 본문 측정용 문장입니다 `.padEnd(48, 'abcdefghij')).join('\n')
    expect(body.length).toBeGreaterThan(48_000)
    expect(body.length).toBeLessThan(50_000)
    await setupDetail(page, body)
    const editor = await openEditor(page)
    await expect(editor.locator('p')).toHaveCount(1000)
    // 커서를 끝으로 옮긴 뒤부터 잰다(이 키는 세지 않는다).
    await page.keyboard.press('ControlOrMeta+End')
    // 키마다 keydown 시각 → 다음 rAF(반영 직전 프레임)·그다음 rAF(그린 뒤) 까지.
    await page.evaluate(() => {
      const w = window as unknown as { __keyLag: number[]; __keyPaint: number[] }
      w.__keyLag = []
      w.__keyPaint = []
      document.addEventListener(
        'keydown',
        () => {
          const t0 = performance.now()
          requestAnimationFrame(() => {
            w.__keyLag.push(performance.now() - t0)
            requestAnimationFrame(() => w.__keyPaint.push(performance.now() - t0))
          })
        },
        true,
      )
    })
    const typed = 'abcdefghijklmnopqrst'
    await page.keyboard.type(typed, { delay: 80 })
    await expect(editor.locator('p').last()).toHaveText(`1000 번째 줄 — 긴 본문 측정용 문장입니다 `.padEnd(48, 'abcdefghij') + typed)
    const { lag, paint } = await page.evaluate(() => {
      const w = window as unknown as { __keyLag: number[]; __keyPaint: number[] }
      return { lag: w.__keyLag, paint: w.__keyPaint }
    })
    const stats = (xs: number[]) => {
      const s = [...xs].sort((a, b) => a - b)
      return { median: Math.round(s[Math.floor(s.length / 2)] * 10) / 10, max: Math.round(s[s.length - 1] * 10) / 10 }
    }
    const rafStats = stats(lag)
    const paintStats = stats(paint)
    const line = `긴 본문(${body.length}자, 1000줄) 키 입력 → rAF: 중앙값 ${rafStats.median}ms · 최댓값 ${rafStats.max}ms / → 다음 프레임: 중앙값 ${paintStats.median}ms · 최댓값 ${paintStats.max}ms (n=${lag.length})`
    console.log(line)
    testInfo.annotations.push({ type: 'perf', description: line })
    expect(lag).toHaveLength(typed.length)
    expect(rafStats.median).toBeLessThan(200)
  })
})
