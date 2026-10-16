// 설정 가이드(WP-399) — 본문 폭이 넉넉하면 오른쪽 sticky 열, 모자라면 헤더 「가이드」 버튼 → 오른쪽 시트, 모바일은 하단 시트.
import type { BrowserContext, Locator, Page } from '@playwright/test'

import { setupAdminAuth, setupRoleDetailMocks, setupRoleListMocks, setupUserDetailMocks } from '../../fixtures/admin.fixture'
import { mockAiMemories } from '../../fixtures/ai-memory-mock'
import { createProject } from '../../factories/project.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { boxOf, expectStacked, settingsSection } from '../../fixtures/layout'
import { mockProjectSettings } from '../../fixtures/project-settings-mocks'
import { installPushManagerStub, mockPushApis } from '../../fixtures/push-mock'
import { settingsGuides } from '../../../src/components/settings-guide/settingsGuides'
import type { SettingsGuide } from '../../../src/components/settings-guide/types'

const profile = settingsGuides.profile

/** 열이 폼 오른쪽에 간격 32px(gap-8) 이상 떨어져 있다 — 열이 폼 위로 겹치지 않는다. */
async function expectAsideRightOfForm(page: Page) {
  const [a, content] = await Promise.all([boxOf(page.getByTestId('settings-guide-aside')), boxOf(page.getByTestId('page-body-content'))])
  expect(a.x).toBeGreaterThanOrEqual(content.x + content.width + 31)
  return a
}

/** 모바일: 헤더 ⓘ → 하단 시트에 lead → 첫 관련 화면 링크(44px 이상)로 이동하면 시트가 닫힌다. */
async function expectMobileRelatedLink(page: Page, guide: SettingsGuide, what: string) {
  await expect(page.getByTestId('settings-guide-aside')).toHaveCount(0)
  await page.getByTestId('page-header').getByTestId('settings-guide-button').click()
  const sheet = page.getByTestId('settings-guide-mobile-sheet')
  await expect(sheet.getByText(guide.lead)).toBeVisible()
  const link = guide.related?.[0]
  expect(link, `${what} 가이드에 관련 화면 링크가 있다`).toBeTruthy()
  const linkEl: Locator = sheet.getByRole('link', { name: link!.label })
  // 모바일 터치 영역 44px 이상(10-accessibility §I).
  expect((await boxOf(linkEl)).height).toBeGreaterThanOrEqual(44)
  await linkEl.click()
  await expect(page).toHaveURL(new RegExp(`${link!.to}$`))
  await expect(sheet).toHaveCount(0)
}

// 기본 화면 폭 1920(레일 접힘 기본) — 다른 폭이 필요한 테스트만 setViewportSize 로 바꾼다.
test.use({ viewport: { width: 1920, height: 1080 } })

test.describe('설정 가이드 — 넓은 화면 열', () => {
  test('1920: 본문 오른쪽에 280px 가이드 열이 보이고 헤더 버튼은 없다', async ({ authenticatedPage: page }) => {
    await page.goto('/settings/profile')
    const aside = page.getByTestId('settings-guide-aside')
    await expect(aside).toBeVisible()
    await expect(page.getByTestId('settings-guide-button')).toHaveCount(0)
    await expect(aside.getByText(profile.lead)).toBeVisible()
    const a = await expectAsideRightOfForm(page)
    expect(Math.abs(a.width - 280)).toBeLessThanOrEqual(1)
    // 열 머리 「설정 가이드」 가 첫 섹션 제목과 같은 높이(중심 y ±2px)에 선다 — 경계선 없는 열의 소속 단서.
    const [title, first] = await Promise.all([
      boxOf(aside.getByRole('heading', { level: 2, name: '설정 가이드' })),
      boxOf(page.locator('[data-slot="settings-section-heading"] h2').first()),
    ])
    expect(Math.abs(title.y + title.height / 2 - (first.y + first.height / 2))).toBeLessThanOrEqual(2)
  })

  test('1920: 본문을 끝까지 내려도 열이 뷰포트 안에 남는다(sticky)', async ({ authenticatedPage: page }) => {
    // 높이를 줄여 프로필 본문이 스크롤되게 한다.
    await page.setViewportSize({ width: 1920, height: 500 })
    await page.goto('/settings/profile')
    const aside = page.getByTestId('settings-guide-aside')
    await expect(aside).toBeVisible()
    const scroller = page.getByTestId('page-body')
    // 스크롤이 실제로 생겼는지 먼저 확인 — 없으면 sticky 를 검증하지 못한다.
    expect(await scroller.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
    await scroller.evaluate((el) => { el.scrollTop = el.scrollHeight })
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
    const a = await boxOf(aside)
    expect(a.y).toBeGreaterThanOrEqual(0)
    expect(a.y).toBeLessThan(500)
    // WP-414: 열이 본문 보이는 높이보다 길어도 열 끝이 뷰포트 밖으로 나가지 않는다(최대 높이 = 본문 높이, 넘치면 열 안 스크롤).
    expect(a.y + a.height).toBeLessThanOrEqual(500)
  })

  test('짧은 데스크톱(1920×500): 폼을 내리지 않고 열 안에서 스크롤해 「AI에게 묻기」에 닿는다', async ({ authenticatedPage: page }) => {
    // WP-414: 1440 폭은 열이 아니라 헤더 버튼(시트)이라, 열이 보이는 1920 폭에서 높이를 줄여 「열 > 본문 높이」를 만든다.
    await page.setViewportSize({ width: 1920, height: 500 })
    await page.goto('/settings/profile')
    const aside = page.getByTestId('settings-guide-aside')
    await expect(aside).toBeVisible()
    const scroller = page.getByTestId('page-body')
    // 전제: 열 내용이 본문 보이는 높이보다 길어 열 자체가 스크롤된다 — 아니면 이 테스트가 아무것도 검증하지 않는다.
    expect(await aside.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
    const asideBox = await boxOf(aside)
    const bodyBox = await boxOf(scroller)
    expect(asideBox.y + asideBox.height).toBeLessThanOrEqual(bodyBox.y + bodyBox.height + 1)

    // 열만 끝까지 스크롤 — 폼(본문 스크롤)은 그대로 맨 위다.
    await aside.evaluate((el) => { el.scrollTop = el.scrollHeight })
    await expect.poll(() => aside.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
    expect(await scroller.evaluate((el) => el.scrollTop)).toBe(0)
    const ask = aside.getByTestId('settings-guide-ask-ai')
    await expect(ask).toBeInViewport()
    const b = await boxOf(ask)
    expect(b.y).toBeGreaterThanOrEqual(asideBox.y)
    expect(b.y + b.height).toBeLessThanOrEqual(asideBox.y + asideBox.height + 1)
  })

  test('1920: 숨기기 → 버튼, 새로고침 후 유지, 버튼은 시트가 아니라 열을 다시 편다', async ({ authenticatedPage: page }) => {
    await page.goto('/settings/profile')
    await page.getByTestId('settings-guide-hide').click()
    await expect(page.getByTestId('settings-guide-aside')).toHaveCount(0)
    const button = page.getByTestId('settings-guide-button')
    await expect(button).toBeVisible()
    // 접힘은 기기 전역 키 하나에 '1'(접힘)/'0'(펼침)으로 저장된다(usePersistentToggle).
    const stored = () => page.evaluate(() => localStorage.getItem('settings-guide:collapsed'))
    expect(await stored()).toBe('1')
    await page.reload()
    await expect(button).toBeVisible()
    await expect(page.getByTestId('settings-guide-aside')).toHaveCount(0)
    // 이 상태의 버튼은 접힌 열을 펴므로 시트를 가리키지 않는다.
    await expect(button).toHaveAttribute('aria-expanded', 'false')
    await expect(button).not.toHaveAttribute('aria-controls')
    await button.click()
    await expect(page.getByTestId('settings-guide-aside')).toBeVisible()
    await expect(page.getByTestId('settings-guide-sheet')).toHaveCount(0)
    await expect(button).toHaveCount(0)
    expect(await stored()).toBe('0')
  })

  test('localStorage 가 실패해도 열이 보이고 숨기기가 동작한다', async ({ authenticatedPage: page }) => {
    // 가이드 접힘 키(settings-guide:collapsed, '1'/'0') 접근만 throw — 읽기 실패면 펼침으로 시작하고 쓰기 실패는 이번 세션 상태만 유지. 다른 키까지 막으면 가이드와 무관한 앱 동작이 깨져 원인 판별이 흐려진다.
    await page.addInitScript(() => {
      const throwFor = (orig: (this: Storage, ...a: string[]) => unknown) =>
        function (this: Storage, ...args: string[]) {
          if (args[0]?.startsWith('settings-guide')) throw new Error('storage blocked')
          return orig.apply(this, args)
        }
      Storage.prototype.getItem = throwFor(Storage.prototype.getItem) as Storage['getItem']
      Storage.prototype.setItem = throwFor(Storage.prototype.setItem) as Storage['setItem']
      Storage.prototype.removeItem = throwFor(Storage.prototype.removeItem) as Storage['removeItem']
    })
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto('/settings/profile')
    await expect(page.getByTestId('settings-guide-aside')).toBeVisible()
    await page.getByTestId('settings-guide-hide').click()
    await expect(page.getByTestId('settings-guide-button')).toBeVisible()
    expect(errors).toEqual([])
  })
})

test.describe('설정 가이드 — 좁은 데스크톱 시트', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('1440: 열 없이 버튼 → 비모달 시트, 시트 연 채 폼 입력, ESC 로 닫고 버튼에 포커스', async ({ authenticatedPage: page }) => {
    await page.goto('/settings/profile')
    const button = page.getByTestId('settings-guide-button')
    await expect(button).toBeVisible()
    await expect(page.getByTestId('settings-guide-aside')).toHaveCount(0)
    await button.click()
    const sheet = page.getByTestId('settings-guide-sheet')
    await expect(sheet).toBeVisible()
    await expect(sheet.getByText(profile.lead)).toBeVisible()
    await expect(button).toHaveAttribute('aria-expanded', 'true')
    // 비모달 — 시트를 연 채 뒤 폼을 편집할 수 있다.
    const name = page.locator('#profile-name')
    await name.fill('가이드 보며 입력')
    await expect(name).toHaveValue('가이드 보며 입력')
    await expect(sheet).toBeVisible()
    await expect(button).toHaveAttribute('aria-controls', (await sheet.getAttribute('id'))!)
    // 폼 입력칸에서 누른 ESC 는 편집 동작(자동완성 닫기 등) — 시트를 닫지 않고 포커스도 입력칸에 남는다.
    await name.press('Escape')
    await expect(sheet).toBeVisible()
    await expect(name).toBeFocused()
    // 시트 안에서 누른 ESC 는 시트를 닫고 헤더 버튼으로 포커스를 돌린다.
    await sheet.getByRole('button', { name: '닫기' }).focus()
    await page.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)
    await expect(button).toBeFocused()
    await expect(button).toHaveAttribute('aria-expanded', 'false')
    // 닫힌 시트는 DOM 에 없으므로 aria-controls 도 뗀다.
    await expect(button).not.toHaveAttribute('aria-controls')
  })

  test('본문 폭 1336 경계: 이상이면 열, 1px 모자라면 버튼', async ({ authenticatedPage: page }) => {
    await page.goto('/settings/profile')
    const body = page.getByTestId('page-body')
    // 판정은 스크롤 요소 offsetWidth(스크롤바 포함) — 레일·사이드바를 뺀 본문 폭이 정확히 경계가 되도록 뷰포트 폭을 맞춘다.
    const offset = () => body.evaluate((el) => (el as HTMLElement).offsetWidth)
    const width = await offset()
    const vw = page.viewportSize()!.width
    await page.setViewportSize({ width: vw + (1336 - width), height: 900 })
    await expect.poll(offset).toBe(1336)
    await expect(page.getByTestId('settings-guide-aside')).toBeVisible()
    await expect(page.getByTestId('settings-guide-button')).toHaveCount(0)
    // 열이 생겨도 폼이 열 쪽으로 넘치지 않는다(폼 1024 + 간격 32 + 열 280 이 꼭 맞음).
    await expectAsideRightOfForm(page)
    await page.setViewportSize({ width: vw + (1335 - width), height: 900 })
    await expect.poll(offset).toBe(1335)
    await expect(page.getByTestId('settings-guide-aside')).toHaveCount(0)
    await expect(page.getByTestId('settings-guide-button')).toBeVisible()
  })

  test('시트를 연 채 넓어지면 시트가 닫히고 열이 보인다', async ({ authenticatedPage: page }) => {
    await page.goto('/settings/profile')
    await page.getByTestId('settings-guide-button').click()
    await expect(page.getByTestId('settings-guide-sheet')).toBeVisible()
    await page.setViewportSize({ width: 1920, height: 900 })
    await expect(page.getByTestId('settings-guide-aside')).toBeVisible()
    await expect(page.getByTestId('settings-guide-sheet')).toHaveCount(0)
  })

  test('회귀: 1024 에서 프로필 정보 섹션은 세로로 쌓인다', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 1024, height: 900 })
    await page.goto('/settings/profile')
    await expectStacked(settingsSection(page, '프로필 정보'))
  })
})

test.describe('설정 가이드 — 모바일', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('390: 헤더 ⓘ → 하단 시트, 관련 화면 링크로 이동하면 시트가 닫힌다', async ({ authenticatedPage: page }) => {
    await page.goto('/settings/profile')
    await expectMobileRelatedLink(page, profile, '프로필')
  })
})

// ── 화면별 가이드 연결(Task 2) — 틀 동작은 위에서 프로필로 검증했으니 여기선 화면마다 자기 내용이 붙는지만 본다. ──

/** 화면별 가이드 연결 표 — 화면마다 자기 lead 가 열에 붙는지(absent 는 붙으면 안 되는 다른 가이드). */
const screens: {
  name: string
  admin?: boolean
  serviceWorkers?: boolean
  setup: (page: Page, context: BrowserContext) => Promise<unknown>
  url: string
  guide: SettingsGuide
  /** 열을 보기 전에 화면이 다 그려졌는지 확인할 요소. */
  ready?: (page: Page) => Locator
  absent?: SettingsGuide
}[] = [
  { name: 'AI 비서', setup: (page) => mockAiMemories(page, []), url: '/settings/assistant', guide: settingsGuides.assistant },
  { name: '프로젝트 설정(사이드바가 있어도)', setup: (page) => mockProjectSettings(page), url: '/projects/WP/settings', guide: settingsGuides.projectSettings },
  {
    name: '개인 프로젝트 설정(팀 가이드 아님)',
    setup: async (page) => {
      await mockProjectSettings(page)
      // 나중에 등록한 목이 먼저 받는다 — 같은 WP 를 개인 프로젝트로 바꿔 응답한다.
      await mockApi(page, 'GET', '/api/v1/projects/WP', createProject({ type: 'PERSONAL' }))
    },
    url: '/projects/WP/settings',
    guide: settingsGuides.personalProjectSettings,
    absent: settingsGuides.projectSettings,
  },
  {
    name: 'SSO',
    admin: true,
    setup: async (page) => {
      await setupAdminAuth(page)
      await mockApi(page, 'GET', '/api/v1/admin/sso', { enabled: true, available: true, passwordlessMemberCount: 0, adminConsentUrl: null })
    },
    url: '/settings/sso',
    guide: settingsGuides.sso,
  },
  {
    name: '역할 상세',
    admin: true,
    setup: async (page) => { await setupAdminAuth(page); await setupRoleDetailMocks(page, 1, false) },
    url: '/settings/roles/1',
    guide: settingsGuides.roleDetail,
    ready: (page) => page.getByRole('textbox', { name: '역할 이름' }),
  },
  {
    name: '사용자 상세',
    admin: true,
    setup: async (page) => { await setupAdminAuth(page); await setupUserDetailMocks(page, 1) },
    url: '/settings/users/1',
    guide: settingsGuides.userDetail,
    ready: (page) => settingsSection(page, '역할 할당'),
  },
  {
    name: '알림',
    serviceWorkers: true,
    setup: async (page, context) => {
      await context.grantPermissions(['notifications'])
      await installPushManagerStub(page)
      await mockPushApis(page)
    },
    url: '/settings/notifications',
    guide: settingsGuides.notifications,
  },
]

test.describe('설정 가이드 — 화면별 내용(1920)', () => {
  for (const sc of screens) {
    test.describe(sc.name, () => {
      if (sc.serviceWorkers) test.use({ serviceWorkers: 'allow' })
      const run = async (page: Page, context: BrowserContext) => {
        await sc.setup(page, context)
        await page.goto(sc.url)
        if (sc.ready) await expect(sc.ready(page)).toBeVisible()
        const aside = page.getByTestId('settings-guide-aside')
        await expect(aside.getByText(sc.guide.lead)).toBeVisible()
        if (sc.absent) await expect(aside.getByText(sc.absent.lead)).toHaveCount(0)
      }
      if (sc.admin) test(`${sc.name}: 열에 자기 가이드가 보인다`, ({ adminPage, context }) => run(adminPage, context))
      else test(`${sc.name}: 열에 자기 가이드가 보인다`, ({ authenticatedPage, context }) => run(authenticatedPage, context))
    })
  }
})

test.describe('설정 가이드 — 로딩 중에도 가이드', () => {
  /** 해당 GET 응답을 gate 가 열릴 때까지 붙잡는다 — 먼저 등록한 목(mockApi)으로 넘기므로 응답 본문은 그대로다. */
  async function holdGet(page: Page, path: string) {
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    await page.route(
      (url) => url.pathname === path,
      async (route) => {
        if (route.request().method() === 'GET') await gate
        await route.fallback()
      },
    )
    return release
  }

  test('역할 상세: 데이터가 오기 전(스켈레톤)에도 가이드 열이 보이고, 온 뒤에도 남는다', async ({ adminPage: page }) => {
    await setupAdminAuth(page)
    await setupRoleDetailMocks(page, 1, false)
    const release = await holdGet(page, '/api/v1/roles/1')
    await page.goto('/settings/roles/1')
    const lead = page.getByTestId('settings-guide-aside').getByText(settingsGuides.roleDetail.lead)
    await expect(lead).toBeVisible()
    await expect(page.getByRole('textbox', { name: '역할 이름' })).toHaveCount(0)
    release()
    await expect(page.getByRole('textbox', { name: '역할 이름' })).toBeVisible()
    await expect(lead).toBeVisible()
  })

  test('사용자 상세: 데이터가 오기 전(스켈레톤)에도 가이드 열이 보이고, 온 뒤에도 남는다', async ({ adminPage: page }) => {
    await setupAdminAuth(page)
    await setupUserDetailMocks(page, 1)
    const release = await holdGet(page, '/api/v1/users/1')
    await page.goto('/settings/users/1')
    const lead = page.getByTestId('settings-guide-aside').getByText(settingsGuides.userDetail.lead)
    await expect(lead).toBeVisible()
    await expect(settingsSection(page, '역할 할당')).toHaveCount(0)
    release()
    await expect(settingsSection(page, '역할 할당')).toBeVisible()
    await expect(lead).toBeVisible()
  })
})

test.describe('설정 가이드 — AI 옆 패널', () => {
  test('1920: AI 옆 패널을 열면 열이 버튼으로 바뀌고, 그때 시트는 패널 왼쪽(본문 영역 안)에 뜨며, 닫으면 열이 돌아온다', async ({ authenticatedPage: page }) => {
    await page.goto('/settings/profile')
    const aside = page.getByTestId('settings-guide-aside')
    await expect(aside).toBeVisible()
    await page.getByTestId('chat-launcher').click()
    const panel = page.getByTestId('ai-side-panel')
    await expect(panel).toBeVisible()
    await expect(aside).toHaveCount(0)
    const button = page.getByTestId('settings-guide-button')
    await expect(button).toBeVisible()
    await button.click()
    const sheet = page.getByTestId('settings-guide-sheet')
    await expect(sheet.getByText(settingsGuides.profile.lead)).toBeVisible()
    const [sb, pb, header] = await Promise.all([boxOf(sheet), boxOf(panel), boxOf(page.getByTestId('page-header'))])
    // 시트가 AI 패널을 덮지 않고, 헤더 아래 본문 영역에서 시작한다.
    expect(sb.x + sb.width, `시트 오른쪽 ${sb.x + sb.width} vs 패널 왼쪽 ${pb.x}`).toBeLessThanOrEqual(pb.x + 1)
    expect(sb.y).toBeGreaterThanOrEqual(header.y + header.height - 1)
    await page.getByTestId('ai-panel-close').click()
    await expect(panel).toHaveCount(0)
    await expect(aside).toBeVisible()
    await expect(button).toHaveCount(0)
  })

  test('1920: 열↔버튼이 바뀌어도(AI 패널 열기·숨기기) 폼이 다시 마운트되지 않는다', async ({ authenticatedPage: page }) => {
    await page.goto('/settings/profile')
    await expect(page.getByTestId('settings-guide-aside')).toBeVisible()
    const name = page.locator('#profile-name')
    await name.fill('입력 중인 이름')
    // 값 유지만으론 리마운트를 못 잡는다 — react-hook-form 이 다시 등록된 input 에 값을 되써 준다.
    // 그래서 DOM 노드에 표식을 달고, 전환 뒤에도 같은 노드(표식 유지)인지 본다.
    await name.evaluate((el) => { el.dataset.guideMark = '1' })
    const sameNode = async () => expect(await name.evaluate((el) => el.dataset.guideMark)).toBe('1')
    await page.getByTestId('chat-launcher').click()
    await expect(page.getByTestId('settings-guide-aside')).toHaveCount(0)
    await sameNode()
    await page.getByTestId('ai-panel-close').click()
    await expect(page.getByTestId('settings-guide-aside')).toBeVisible()
    await sameNode()
    await page.getByTestId('settings-guide-hide').click()
    await expect(page.getByTestId('settings-guide-button')).toBeVisible()
    await sameNode()
    await expect(name).toHaveValue('입력 중인 이름')
  })
})

test.describe('설정 가이드 — 모바일 관리 화면', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('390: 사용자 상세 가이드의 관련 화면 링크로 이동하면 시트가 닫힌다', async ({ adminPage: page }) => {
    await setupAdminAuth(page)
    await setupUserDetailMocks(page, 1)
    await setupRoleListMocks(page)
    await page.goto('/settings/users/1')
    await expectMobileRelatedLink(page, settingsGuides.userDetail, '사용자 상세')
  })
})
