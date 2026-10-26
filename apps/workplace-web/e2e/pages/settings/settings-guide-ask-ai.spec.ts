// 설정 가이드 「이 설정에 대해 AI에게 묻기」(WP-414) — 가이드 맨 아래 버튼이 입력창을 채운 채 AI 를 열고,
// 설정 화면이 등록한 화면 맥락(설정 · 제목 + 가이드 요약 + 화면 값)이 칩·전송 body 에 실린다.
// AI 를 못 쓰는 워크스페이스면 버튼이 없음은 src/pages/admin/ssoSettings.test.tsx, 사용자 상세·개인 프로젝트 설정의 화면 맥락(대상·ref·종류)은
// src/pages/settings/settingsGuideScreens.test.tsx, 「묻기」가 문구를 채워 옆 패널을 여는 상태 전환은 src/pages/settings/assistantSettings.test.tsx 로 옮겼다(WP-985).
// 남은 것: 프리필 포커스·커서(@input), 열 ↔ 버튼 전환·44px(@layout), 팀 프로젝트 설정 끝까지 배선(@wiring), 패널 초안과의 흐름(@flow).
import type { Page } from '@playwright/test'

import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { type HomeChatStartBody, mockHomeChatGeneration } from '../../fixtures/home-chat-mock'
import { mockProjectSettings } from '../../fixtures/project-settings-mocks'
import { createProject } from '../../factories/project.factory'
import { settingsGuides } from '../../../src/components/settings-guide/settingsGuides'

const PROMPT = '이 설정에 대해 알려줘 '
const ASK = '이 설정에 대해 AI에게 묻기'

/** 입력창이 문구로 채워지고 포커스·커서가 끝에 있다. */
async function expectPrefilled(page: Page, value = PROMPT) {
  const input = page.getByTestId('chat-input')
  await expect(input).toHaveValue(value)
  await expect(input).toBeFocused()
  const caret = await input.evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd])
  expect(caret).toEqual([value.length, value.length])
}

test.describe('설정 가이드 AI에게 묻기 — 넓은 화면 열', () => {
  test.use({ viewport: { width: 1920, height: 1080 } })

  test('1920 프로필: 열 버튼 → 옆 패널 + 프리필 + 「설정 · 프로필」 칩, 전송 body 에 가이드 요약·이름이 실린다', { tag: ['@input', '@smoke'] }, async ({ authenticatedPage: page }) => {
    const chat = await mockHomeChatGeneration(page, { frames: [{ event: 'done', data: { sessionId: 's-ask' } }] })
    await page.goto('/settings/profile')
    const aside = page.getByTestId('settings-guide-aside')
    await expect(aside).toBeVisible()
    // 버튼은 가이드 맨 아래(관련 화면 다음)에 있다.
    const ask = aside.getByRole('button', { name: ASK })
    const related = aside.getByRole('link', { name: settingsGuides.profile.related![0].label })
    expect((await ask.boundingBox())!.y).toBeGreaterThan((await related.boundingBox())!.y)
    await ask.click()

    await expect(page.getByTestId('ai-side-panel')).toBeVisible()
    await expectPrefilled(page)
    await expect(page.getByTestId('chat-context-chip')).toContainText('설정 · 프로필')
    // 패널이 열려 본문이 좁아지면 열은 헤더 버튼으로 바뀐다(WP-399 동작).
    await expect(aside).toHaveCount(0)
    await expect(page.getByTestId('settings-guide-button')).toBeVisible()

    await page.getByTestId('chat-input').press('End')
    await page.keyboard.type('비밀번호 규칙')
    await page.getByRole('button', { name: '보내기' }).click()
    await expect.poll(chat.count).toBe(1)
    const body = chat.bodies<HomeChatStartBody>()[0]
    expect(body.query).toBe('이 설정에 대해 알려줘 비밀번호 규칙')
    expect(body.screenContext).toMatchObject({ view: '설정 · 프로필', scope: { label: '설정 · 프로필' } })
    expect(body.screenContext!.focus).toBeUndefined()
    const facts = body.screenContext!.scope!.facts!
    expect(facts[0]).toEqual({ label: '이름', value: '테스트 사용자' })
    expect(facts).toContainEqual({ label: '소개', value: settingsGuides.profile.lead })
    expect(facts).toContainEqual({ label: '알아두기 1', value: settingsGuides.profile.tips[0] })
  })

  // 개인 프로젝트·사용자 상세의 맥락 값은 settingsGuideScreens.test.tsx 가 본다 — 여기는 실제 라우트(사이드바 화면 안)에서 설정 맥락이 이기고 전송까지 이어지는지 1건.
  for (const sc of [{ name: '팀 프로젝트', type: 'TEAM' as const, view: '설정 · 프로젝트 설정', kind: '팀' }]) {
    test(`${sc.name} 설정: 사이드바 화면 안에서도 설정 맥락(키·이름·종류)이 이긴다`, { tag: '@wiring' }, async ({ authenticatedPage: page }) => {
      const chat = await mockHomeChatGeneration(page, { frames: [{ event: 'done', data: { sessionId: 's-ask' } }] })
      await mockProjectSettings(page)
      await mockApi(page, 'GET', '/api/v1/projects/WP', createProject({ type: sc.type }))
      await page.goto('/projects/WP/settings')
      await page.getByTestId('settings-guide-aside').getByRole('button', { name: ASK }).click()
      await expectPrefilled(page)
      await expect(page.getByTestId('chat-context-chip')).toContainText('프로젝트 Workplace')
      await page.getByRole('button', { name: '보내기' }).click()
      await expect.poll(chat.count).toBe(1)
      const ctx = chat.bodies<HomeChatStartBody>()[0].screenContext!
      expect(ctx.view).toBe(sc.view)
      expect(ctx.focus).toMatchObject({ type: '프로젝트', label: 'Workplace', refs: { projectKey: 'WP' } })
      expect(ctx.focus!.facts).toContainEqual({ label: '종류', value: sc.kind })
    })
  }

  test('옆 패널에 쓰던 초안이 있으면 덮지 않고, 시트는 닫힌다', { tag: '@flow' }, async ({ authenticatedPage: page }) => {
    await page.goto('/settings/profile')
    await page.getByTestId('chat-launcher').click()
    const input = page.getByTestId('chat-input')
    await input.fill('쓰던 질문')
    // 패널이 열려 가이드는 헤더 버튼 → 시트.
    await page.getByTestId('settings-guide-button').click()
    const sheet = page.getByTestId('settings-guide-sheet')
    await sheet.getByRole('button', { name: ASK }).click()
    await expect(sheet).toHaveCount(0)
    await expect(input).toHaveValue('쓰던 질문')
    await expect(page.getByTestId('ai-side-panel')).toBeVisible()
    // 초안 때문에 채우지 않았어도 문구는 소비됐다 — 닫고 일반 AI 버튼으로 다시 열면 입력창이 비어 있다.
    await page.getByTestId('ai-panel-close').click()
    await expect(page.getByTestId('ai-side-panel')).toHaveCount(0)
    await page.getByTestId('chat-launcher').click()
    await expect(page.getByTestId('chat-input')).toHaveValue('')
  })
})

test.describe('설정 가이드 AI에게 묻기 — 좁은 데스크톱 시트', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('1440: 시트 버튼 → 시트가 닫히고, 닫힌 뒤에도 입력창 포커스가 헤더 버튼으로 돌아가지 않는다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    await page.goto('/settings/profile')
    await page.getByTestId('settings-guide-button').click()
    const sheet = page.getByTestId('settings-guide-sheet')
    await sheet.getByRole('button', { name: ASK }).click()
    await expect(sheet).toHaveCount(0)
    await expect(page.getByTestId('ai-side-panel')).toBeVisible()
    // 시트 닫힘 애니메이션이 끝나 DOM 에서 빠진 뒤 판정 — 닫힘 포커스 복귀가 입력창 포커스를 빼앗지 않는다.
    await expectPrefilled(page)
    await expect(page.getByTestId('chat-context-chip')).toContainText('설정 · 프로필')
    // 한 번만 소비 — 닫고 일반 AI 버튼으로 다시 열면 문구가 다시 채워지지 않는다.
    await page.getByTestId('ai-panel-close').click()
    await expect(page.getByTestId('ai-side-panel')).toHaveCount(0)
    await page.getByTestId('chat-launcher').click()
    await expect(page.getByTestId('ai-side-panel')).toBeVisible()
    await expect(page.getByTestId('chat-input')).toHaveValue('')
  })
})

test.describe('설정 가이드 AI에게 묻기 — 모바일', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('390: 하단 시트 버튼 → 시트 닫히고 AI 전체화면 + 프리필', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await page.goto('/settings/profile')
    await page.getByTestId('page-header').getByTestId('settings-guide-button').click()
    const sheet = page.getByTestId('settings-guide-mobile-sheet')
    const ask = sheet.getByRole('button', { name: ASK })
    // 모바일 터치 영역 44px 이상.
    expect((await ask.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await ask.click()
    await expect(sheet).toHaveCount(0)
    await expect(page.getByTestId('ai-sheet')).toBeVisible()
    // 하단 시트(Radix modal) 닫힘 뒤에도 입력창 포커스·커서 끝이 유지된다.
    await expectPrefilled(page)
    await expect(page.getByTestId('chat-context-chip')).toContainText('설정 · 프로필')
    // 시트가 닫힌 뒤에도 AI 가 열린 채로 남는다(시트 닫기가 AI 히스토리를 되돌리지 않음).
    await expect(page.getByTestId('ai-sheet')).toBeVisible()
  })
})
