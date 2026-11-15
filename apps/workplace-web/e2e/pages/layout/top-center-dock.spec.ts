// top-center-dock.spec.ts — 좁은 본문에서 상단 가운데 검색·「?」(·AI 칩)가 헤더 안으로 들어가는 마지막 밀도 단계(WP-1611)의 브라우저 판정.
// 도움말 패널을 연 채 1024~1280px 이슈 상세에서, 떠 있는 틀이 min() 항에 밀려 브레드크럼(이슈 키)을 덮던 회귀를 잡는다.
// jsdom 이 잴 수 없는 기하(실제 상자 교차)만 본다 — 단계 순서·이력은 headerDensity.test.ts 가 지킨다.
import type { Page } from '@playwright/test'

import { createChatThread } from '../../factories/chat.factory'
import { createUser } from '../../factories/auth.factory'
import { personalSpace } from '../../factories/drive.factory'
import { createIssue, createIssueDetail } from '../../factories/issue.factory'
import { createProject } from '../../factories/project.factory'
import { restoreAnimations } from '../../fixtures/animations'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { mockHelpBundle } from '../../fixtures/help-bundle-mock'

/** 이슈 상세(WP-7)에 필요한 조회를 모두 막는다 — page-frame.spec 의 이슈 상세 목과 같은 구성. 프로젝트 이름은 길게 둬 경로가 자리를 다툰다. */
async function gotoIssue(page: Page) {
  // 부모 크럼(WP-3)까지 둬 경로가 프로젝트 › 부모 › 현재 세 단계로 자리를 다투게 한다.
  const base0 = createIssue({ id: 1, number: 7, projectKey: 'WP', title: '헤더 겹침 확인' })
  const issue = { ...base0, parent: { number: 3, title: '상위 에픽', type: base0.type! } }
  const base = '/api/v1/projects/WP/issues/7'
  await mockApi(page, 'GET', '/api/v1/projects/WP', createProject({ key: 'WP', name: '스마트 워크플레이스' }))
  await mockApi(page, 'GET', base, createIssueDetail({ summary: issue }))
  for (const sub of ['watchers', 'labels', 'attachments', 'drive-links']) await mockApi(page, 'GET', `${base}/${sub}`, [])
  await mockApi(page, 'GET', `${base}/chat/thread`, createChatThread({ threadId: 999, recentMessages: [] }))
  for (const path of ['/api/v1/projects/WP/members', '/api/v1/projects/WP/labels', '/api/v1/drive/spaces']) await mockApi(page, 'GET', path, [])
  await mockApi(page, 'GET', '/api/v1/home/sessions', { items: [], nextCursor: null })
  await mockHelpBundle(page)
  await page.goto('/projects/WP/issues/7')
  await expect(page.getByTestId('breadcrumb-current')).toBeVisible()
  await expect(page.getByTestId('page-header').locator('[data-ai-actions]')).toBeVisible()
}

/**
 * 드라이브 개인 공간 루트(빈 목록) — 경로가 「내 드라이브」뿐이고 액션(🔗·새 폴더·업로드·휴지통)이 넓어, 패널을 열면 좌측 그룹이
 * useAiChipClamp 의 최소 폭(120px)보다 좁은 119px 로 줄어든다(WP-1612). 공간 조회(spaces/1)가 있어야 경로 이름과 🔗 가 실측과 같다.
 * 그러면 틀이 옮겨 가도 좌측 그룹 크기가 안 바뀌어, 틀 left 전환 종료에서 다시 재지 않으면 헤더 넣기에 못 들어간다.
 */
async function gotoDrive(page: Page) {
  await page.route((u) => u.pathname === '/api/v1/drive/quota', (r) => r.fulfill({ json: { usedBytes: 0, quotaBytes: 1024 ** 3 } }))
  await page.route((u) => u.pathname === '/api/v1/drive/spaces/1', (r) => r.fulfill({ json: personalSpace({ id: 1 }) }))
  await page.route((u) => u.pathname === '/api/v1/drive/spaces', (r) =>
    r.request().method() === 'GET' ? r.fulfill({ json: [personalSpace({ id: 1 })] }) : r.fallback())
  await page.route((u) => /\/api\/v1\/drive\/spaces\/\d+\/items$/.test(u.pathname), (r) => r.fulfill({ json: { folders: [], files: [] } }))
  await mockHelpBundle(page)
  await page.goto('/drive')
  await expect(page.getByTestId('drive-page')).toBeVisible()
  await expect(page.getByTestId('page-header').locator('[data-ai-actions]')).toBeVisible()
}

/** 상단 「?」로 도움말 패널을 연다 — 「?」가 헤더로 들어가 있어도 보이는 쪽 하나를 누른다. */
async function openHelpPanel(page: Page) {
  await page.getByTestId('help-toggle').click()
  await expect(page.getByTestId('help-panel')).toBeVisible()
}

interface Rect { left: number; right: number; top: number; bottom: number }

/**
 * 같은 프레임에서 보이는 상단 단추(칩·검색·「?」)와, 각 단추 자리에 실제로 그려진 헤더 좌측 그룹(← ·경로·이슈 키) 조각,
 * 액션·도움말 패널 상자를 잰다. 숨긴 틀(visibility:hidden)의 단추는 화면에 없으므로 「보이는」 것만 센다 — 같은 testid 가 둘 보이면 그것도 실패다.
 * 좌측 그룹은 상자 대신 단추 위 격자점의 elementsFromPoint 로 본다 — 그룹 밖으로 넘친 글자·구분자(이 이슈의 증상)는 상자로는 안 잡히고,
 * 잘린(clip) 부분은 점 판정에 걸리지 않아 「눈에 보이는 겹침」만 센다.
 */
async function measure(page: Page) {
  return page.evaluate(() => {
    const toRect = (el: Element): Rect => {
      const r = el.getBoundingClientRect()
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
    }
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'
    }
    const header = document.querySelector('[data-testid="page-header"]')!
    const leftGroup = header.querySelector('[data-ai-left-group]')
    const buttons: Record<string, { rect: Rect; under: string[] }[]> = {}
    for (const id of ['chat-launcher', 'global-search-toggle', 'help-toggle']) {
      buttons[id] = [...document.querySelectorAll(`[data-testid="${id}"]`)].filter(visible).map((el) => {
        const r = el.getBoundingClientRect()
        const under = new Set<string>()
        // 5×5 격자(가장자리 1px 안쪽) — 단추 아래·위 어디든 좌측 그룹 조각이 그려졌는지.
        for (let i = 0; i < 5; i++) {
          for (let j = 0; j < 5; j++) {
            const x = r.left + 1 + ((r.width - 2) * i) / 4
            const y = r.top + 1 + ((r.height - 2) * j) / 4
            for (const hit of document.elementsFromPoint(x, y)) {
              if (leftGroup && leftGroup.contains(hit)) under.add(hit.getAttribute('data-testid') ?? hit.tagName.toLowerCase())
            }
          }
        }
        return { rect: toRect(el), under: [...under] }
      })
    }
    const actions = header.querySelector('[data-ai-actions]')
    const panel = document.querySelector('[data-testid="help-panel"]')
    return {
      buttons,
      boxes: {
        '헤더 액션': actions ? toRect(actions) : null,
        '도움말 패널': panel && visible(panel) ? toRect(panel) : null,
      } as Record<string, Rect | null>,
    }
  })
}

/** 두 상자가 넓이를 가지고 겹치는지(맞닿음은 겹침이 아니다). */
function intersects(a: Rect, b: Rect) {
  return Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5
}

/** 보이는 상단 단추가 testid 마다 하나씩이고, 어느 것도 경로·이슈 키·← ·액션·도움말 패널과 겹치지 않는다. */
async function expectNoCollision(page: Page, ai: boolean) {
  await expect(async () => {
    const { buttons, boxes } = await measure(page)
    expect(buttons['global-search-toggle'], '보이는 검색 단추 수').toHaveLength(1)
    expect(buttons['help-toggle'], '보이는 「?」 단추 수').toHaveLength(1)
    expect(buttons['chat-launcher'], '보이는 AI 칩 수').toHaveLength(ai ? 1 : 0)
    for (const [name, list] of Object.entries(buttons)) {
      for (const { rect, under } of list) {
        expect(under, `${name} 자리에 그려진 헤더 좌측 그룹(← ·경로·이슈 키) 조각`).toEqual([])
        for (const [obstacle, box] of Object.entries(boxes)) {
          if (box) expect(intersects(rect, box), `${name} 이(가) ${obstacle} 와 겹치지 않는다`).toBe(false)
        }
      }
    }
  }).toPass()
}

/** 넓은 폭에서는 가운데 떠 있는 틀로 보인다 — 숨김 표식이 없고, 단추가 헤더 밖(body 포털)에 있다. */
async function expectFloating(page: Page) {
  const frame = page.locator('[data-ai-chip]')
  await expect(frame).toBeVisible()
  await expect(frame).not.toHaveAttribute('data-ai-docked', /.*/)
  await expect(frame.getByTestId('global-search-toggle')).toBeVisible()
  await expect(page.getByTestId('page-header').getByTestId('global-search-toggle')).toHaveCount(0)
}

for (const ai of [true, false]) {
  test.describe(`상단 가운데 단추 헤더 넣기 — 비서 ${ai ? '있음' : '없음'}`, { tag: '@layout' }, () => {
    test.beforeEach(async ({ authenticatedPage: page }) => {
      // 기본 fixture 는 비서 있음 — 없음은 사용자 조회를 덮어쓴다(나중 등록이 이긴다).
      if (!ai) {
        await mockApi(page, 'GET', '/api/v1/users/me', { ...createUser({ aiAvailable: false }), roles: [{ id: 2, name: 'USER', description: '일반 사용자', isSystem: true }] })
      }
    })

    for (const width of [1024, 1100, 1280]) {
      test(`${width}px + 도움말 패널 — 검색·「?」가 이슈 키·경로·액션과 겹치지 않는다`, async ({ authenticatedPage: page }) => {
        await page.setViewportSize({ width, height: 900 })
        await gotoIssue(page)
        await openHelpPanel(page)
        await expectNoCollision(page, ai)
      })
    }

    // 이슈 상세는 경로가 길어 clamp 변화가 좌측 그룹 크기를 바꿔 다시 재게 됐지만, 짧은 경로는 그 신호가 없었다(WP-1612).
    // 고치기 전 코드에서 실패하는 것은 비서 없음 쪽이다 — 비서 있음은 넓은 칩이 첫 측정에서 단계를 바꿔 250ms 안정 재측정이 우연히 최종 자리를 잡는다(지킴용).
    test('1024px 드라이브 + 도움말 패널 — 짧은 경로도 검색·「?」가 덮지 않는다', async ({ authenticatedPage: page }) => {
      await page.setViewportSize({ width: 1024, height: 900 })
      await gotoDrive(page)
      // 공통 fixture 의 전환 끄기 style 을 걷어 실제 화면처럼 틀의 left 전환(200ms)을 돌린다 — 전환이 0s 면 헤더가 줄어드는 순간
      // 틀도 이미 새 자리에 있어 첫 측정이 맞게 나오고, 전환이 끝난 뒤 다시 재지 않던 결함이 드러나지 않는다.
      await restoreAnimations(page)
      await openHelpPanel(page)
      await expectNoCollision(page, ai)
      await expect(page.getByTestId('page-header').getByTestId('global-search-toggle')).toBeVisible()
    })

    test('1440px 패널 닫힘 — 가운데 떠 있는 틀로 보인다', async ({ authenticatedPage: page }) => {
      await page.setViewportSize({ width: 1440, height: 900 })
      await gotoIssue(page)
      await expectFloating(page)
      await expectNoCollision(page, ai)
    })

    test('도움말 패널을 열어 헤더로 들어갔다가 닫으면 가운데로 돌아온다', async ({ authenticatedPage: page }) => {
      await page.setViewportSize({ width: 1024, height: 900 })
      await gotoIssue(page)
      await openHelpPanel(page)
      await expectNoCollision(page, ai)
      // 자리가 모자라면 떠 있는 틀 대신 헤더 안(오른쪽 액션 앞)에 같은 단추가 선다.
      await expect(page.getByTestId('page-header').getByTestId('global-search-toggle')).toBeVisible()
      // 헤더 안의 「?」(또는 떠 있는 「?」) 어느 쪽이든 같은 도움말 상태를 여닫는다.
      await page.getByTestId('help-toggle').click()
      await expect(page.getByTestId('help-panel')).toBeHidden()
      await expectFloating(page)
    })

    // 헤더 넣기 ↔ 가운데 복귀 때 단추가 다시 마운트되면 포커스가 body 로 떨어졌다(WP-1505 포커스 복귀 회귀, WP-1611 리뷰).
    test('도움말 패널을 ✕ 로 닫아 가운데로 돌아와도 포커스가 「?」에 남는다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
      await page.setViewportSize({ width: 1024, height: 900 })
      await gotoIssue(page)
      await openHelpPanel(page)
      await expect(page.getByTestId('page-header').getByTestId('help-toggle')).toBeVisible()
      await page.getByTestId('help-close').click()
      await expect(page.getByTestId('help-panel')).toBeHidden()
      await expectFloating(page)
      // 패널이 「?」로 돌려준 포커스가 헤더 → 가운데 이동 뒤에도 같은 단추에 있다.
      await expect(page.getByTestId('help-toggle')).toBeFocused()
    })

    test('키보드로 「?」를 눌러 헤더로 들어가도 포커스가 「?」에 남는다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
      await page.setViewportSize({ width: 1024, height: 900 })
      await gotoIssue(page)
      await expectFloating(page)
      await page.getByTestId('help-toggle').focus()
      await page.keyboard.press('Enter')
      await expect(page.getByTestId('help-panel')).toBeVisible()
      await expect(page.getByTestId('page-header').getByTestId('help-toggle')).toBeVisible()
      await expect(page.getByTestId('help-toggle')).toBeFocused()
    })

    // 트리거가 다시 마운트되면 팔레트가 닫히고(useSearchPaletteSession 정리) 입력한 검색어도 사라졌다(WP-1611 리뷰).
    test('검색 팔레트가 열린 채 헤더 넣기가 바뀌어도 팔레트와 검색어가 남는다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
      await page.setViewportSize({ width: 1600, height: 900 })
      await gotoIssue(page)
      await openHelpPanel(page)
      await expectFloating(page)
      await page.getByTestId('global-search-toggle').click()
      const input = page.getByTestId('global-search-input')
      await expect(input).toBeVisible()
      await input.fill('헤더')
      // 좁히면 헤더로 들어간다 — 팔레트는 그대로 열려 있고 검색어도 남는다.
      await page.setViewportSize({ width: 1024, height: 900 })
      await expect(page.getByTestId('page-header').getByTestId('global-search-toggle')).toBeAttached()
      await expect(page.getByTestId('global-search')).toBeVisible()
      await expect(input).toHaveValue('헤더')
      // 다시 넓히면 가운데로 돌아온다 — 마찬가지로 남는다.
      await page.setViewportSize({ width: 1600, height: 900 })
      await expect(page.locator('[data-ai-chip]').getByTestId('global-search-toggle')).toBeAttached()
      await expect(page.getByTestId('global-search')).toBeVisible()
      await expect(input).toHaveValue('헤더')
    })
  })
}
