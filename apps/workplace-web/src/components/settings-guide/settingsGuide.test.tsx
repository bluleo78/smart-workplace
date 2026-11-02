// 설정 가이드(WP-1281) 화면 컴포넌트 테스트 — 섹션별 가이드 그리기, 본문에서 보고 있는 섹션 따라가기, 본문 단추의 open(sectionId).
// 섹션 판정 자체는 activeSection.test.ts(순수 함수)가 지키고, 여기서는 그 판정이 실제 스크롤 요소·섹션 id 와 이어지는지를 본다.
// jsdom 은 레이아웃이 없어 getBoundingClientRect·clientHeight 가 0 이라 섹션 머리 위치를 직접 정해 준다(본문 폭이 0 이라 가이드는 시트로 열린다).
import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { AIAssistantProvider } from '@/components/ai/AIAssistantContext'
import { SettingsPage } from '@/components/layout/SettingsPage'
import { SettingsSection } from '@/components/layout/SettingsSection'
import { renderScreen } from '@/test/renderScreen'

import { useOpenSettingsGuide } from './openSettingsGuide'
import type { SettingsGuide } from './types'

const GUIDE: SettingsGuide = {
  title: '시험 화면',
  lead: '시험용 가이드예요.',
  tips: [],
  sections: [
    { id: 'sec-a', title: '섹션 A', tips: ['A 팁이에요.'] },
    { id: 'sec-b', title: '섹션 B', tips: ['B 팁이에요.'], steps: [{ title: '① 첫 단계', body: '먼저 해요.', commands: [{ command: 'echo hi', testId: 'cmd-b' }] }] },
    { id: 'sec-c', title: '섹션 C', caution: 'C 주의예요.' },
  ],
}

/** 섹션 머리 위치(본문 스크롤 요소 위쪽이 0) — 테스트가 바꿔 가며 「스크롤」을 흉내 낸다. */
let tops: Record<string, number>
const restore: Array<() => void> = []

/** 프로토타입에 측정값을 덮어쓴다 — 테스트가 끝나면 되돌린다. */
function stubProto(name: 'getBoundingClientRect' | 'clientHeight' | 'scrollHeight', value: unknown) {
  const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name) ?? Object.getOwnPropertyDescriptor(Element.prototype, name)
  const target = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name) ? HTMLElement.prototype : Element.prototype
  if (name === 'getBoundingClientRect') Object.defineProperty(target, name, { configurable: true, value })
  else Object.defineProperty(target, name, { configurable: true, get: () => value })
  restore.push(() => (desc ? Object.defineProperty(target, name, desc) : Reflect.deleteProperty(target, name)))
}

beforeEach(() => {
  tops = { 'sec-a': 0, 'sec-b': 900, 'sec-c': 1800 }
  stubProto('getBoundingClientRect', function (this: HTMLElement) {
    const top = this.id in tops ? tops[this.id] : 0
    return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) }
  })
  // 보이는 높이 1000, 전체 5000 — 맨 아래가 아니므로 기준선은 위 30%(300px).
  stubProto('clientHeight', 1000)
  stubProto('scrollHeight', 5000)
})
afterEach(() => {
  while (restore.length) restore.pop()!()
})

/** 본문의 「가이드 열기」 단추 — 섹션 id 를 주면 그 섹션 도움말로 연다. */
function OpenButton({ sectionId }: { sectionId?: string }) {
  const open = useOpenSettingsGuide()
  return open ? (
    <button type="button" data-testid={`open-${sectionId ?? 'plain'}`} onClick={() => open(sectionId)}>
      가이드 열기
    </button>
  ) : null
}

function Screen({ guide = GUIDE }: { guide?: SettingsGuide }) {
  return (
    <AIAssistantProvider hotkeysEnabled={false}>
      <SettingsPage title="시험 화면" width="form" guide={guide}>
        <SettingsSection id="sec-a" title="섹션 A">
          <OpenButton sectionId="sec-a" />
          <OpenButton />
        </SettingsSection>
        <SettingsSection id="sec-b" title="섹션 B">
          <OpenButton sectionId="sec-b" />
        </SettingsSection>
        <SettingsSection id="sec-c" title="섹션 C">
          <OpenButton sectionId="sec-c" />
        </SettingsSection>
      </SettingsPage>
    </AIAssistantProvider>
  )
}

/** 시트를 열고 가이드 본문 안의 섹션 묶음을 돌려준다. */
async function openSheet(user: ReturnType<typeof renderScreen>['user']) {
  await user.click(await screen.findByTestId('settings-guide-button'))
  return screen.findByTestId('settings-guide-sheet')
}

const guideSection = (sheet: HTMLElement, id: string) => sheet.querySelector<HTMLElement>(`[data-guide-section="${id}"]`)!

/** 본문 스크롤 요소에 scroll 을 알리고 rAF 한 번이 지나기를 기다린다. */
async function scrollBody() {
  const scrollEl = document.querySelector<HTMLElement>('[data-testid="settings-page"]')!.querySelector<HTMLElement>('div.overflow-y-auto, [class*="overflow-y"]')
  await act(async () => {
    scrollEl?.dispatchEvent(new Event('scroll'))
    await new Promise((r) => requestAnimationFrame(() => r(null)))
  })
}

describe('섹션별 가이드 그리기', () => {
  test('소개와 섹션마다 제목·팁·할 일 순서·주의를 화면 섹션 순서대로 그린다', async () => {
    const { user } = renderScreen(<Screen />, { path: '/x' })
    const sheet = await openSheet(user)
    expect(sheet).toHaveTextContent('시험용 가이드예요.')
    const sections = [...sheet.querySelectorAll('[data-guide-section]')].map((el) => el.getAttribute('data-guide-section'))
    expect(sections).toEqual(['sec-a', 'sec-b', 'sec-c'])
    expect(guideSection(sheet, 'sec-a')).toHaveTextContent('A 팁이에요.')
    // 섹션 B 의 할 일 순서는 제목과 복사 가능한 명령을 가진다.
    expect(within(guideSection(sheet, 'sec-b')).getByRole('heading', { name: '① 첫 단계' })).toBeInTheDocument()
    expect(within(guideSection(sheet, 'sec-b')).getByTestId('cmd-b')).toHaveTextContent('echo hi')
    expect(guideSection(sheet, 'sec-c')).toHaveTextContent('C 주의예요.')
    // 섹션이 없는 상위 알아두기·주의 블록은 비어 있으면 그리지 않는다.
    expect(within(sheet).queryByText('알아두기')).not.toBeInTheDocument()
  })

  test('가이드가 없는 화면에는 단추도 열기 통로도 없다', async () => {
    renderScreen(
      <SettingsPage title="가이드 없음" width="form">
        <OpenButton />
      </SettingsPage>,
      { path: '/x' },
    )
    expect(await screen.findByText('가이드 없음')).toBeInTheDocument()
    expect(screen.queryByTestId('settings-guide-button')).not.toBeInTheDocument()
    expect(screen.queryByTestId('open-plain')).not.toBeInTheDocument()
  })
})

describe('본문에서 보고 있는 섹션 따라가기', () => {
  test('처음에는 기준선(위 30%)에 닿은 섹션을 강조한다 — 머리가 가장 위에 있는 첫 섹션', async () => {
    const { user } = renderScreen(<Screen />, { path: '/x' })
    const sheet = await openSheet(user)
    await waitFor(() => expect(guideSection(sheet, 'sec-a')).toHaveAttribute('data-active', 'true'))
    expect(guideSection(sheet, 'sec-b')).not.toHaveAttribute('data-active')
    expect(guideSection(sheet, 'sec-c')).not.toHaveAttribute('data-active')
  })

  test('스크롤해서 섹션 머리가 기준선(300px)을 넘으면 그 섹션으로 강조가 옮겨 가고, 되돌리면 앞 섹션으로 돌아온다', async () => {
    const { user } = renderScreen(<Screen />, { path: '/x' })
    const sheet = await openSheet(user)
    // B 머리가 기준선 위(250px), C 는 아직 아래
    tops = { 'sec-a': -650, 'sec-b': 250, 'sec-c': 1150 }
    await scrollBody()
    await waitFor(() => expect(guideSection(sheet, 'sec-b')).toHaveAttribute('data-active', 'true'))
    expect(guideSection(sheet, 'sec-a')).not.toHaveAttribute('data-active')
    // C 까지 올라옴
    tops = { 'sec-a': -1550, 'sec-b': -650, 'sec-c': 250 }
    await scrollBody()
    await waitFor(() => expect(guideSection(sheet, 'sec-c')).toHaveAttribute('data-active', 'true'))
    // 다시 위로
    tops = { 'sec-a': 0, 'sec-b': 900, 'sec-c': 1800 }
    await scrollBody()
    await waitFor(() => expect(guideSection(sheet, 'sec-a')).toHaveAttribute('data-active', 'true'))
  })
})

describe('본문 「가이드 열기」 — open(sectionId)', () => {
  test('섹션 id 를 주면 스크롤 위치와 상관없이 그 섹션 도움말로 시트가 열린다', async () => {
    // 지금 스크롤은 섹션 A 에 있다 — 그래도 C 단추를 누르면 C 가 강조된다.
    const { user } = renderScreen(<Screen />, { path: '/x' })
    await user.click(await screen.findByTestId('open-sec-c'))
    const sheet = await screen.findByTestId('settings-guide-sheet')
    await waitFor(() => expect(guideSection(sheet, 'sec-c')).toHaveAttribute('data-active', 'true'))
    expect(guideSection(sheet, 'sec-a')).not.toHaveAttribute('data-active')
  })

  test('열어 둔 섹션은 본문을 다시 스크롤하면 풀려 지금 섹션을 따라간다', async () => {
    const { user } = renderScreen(<Screen />, { path: '/x' })
    await user.click(await screen.findByTestId('open-sec-c'))
    const sheet = await screen.findByTestId('settings-guide-sheet')
    await waitFor(() => expect(guideSection(sheet, 'sec-c')).toHaveAttribute('data-active', 'true'))
    tops = { 'sec-a': -650, 'sec-b': 250, 'sec-c': 1150 }
    await scrollBody()
    await waitFor(() => expect(guideSection(sheet, 'sec-b')).toHaveAttribute('data-active', 'true'))
    expect(guideSection(sheet, 'sec-c')).not.toHaveAttribute('data-active')
  })

  test('섹션 id 없이 열면 지금 보고 있는 섹션을 그대로 따른다', async () => {
    const { user } = renderScreen(<Screen />, { path: '/x' })
    // 스크롤이 섹션 B 에 있는 상태에서 id 없는 단추로 연다
    tops = { 'sec-a': -650, 'sec-b': 250, 'sec-c': 1150 }
    await scrollBody()
    await user.click(await screen.findByTestId('open-plain'))
    const sheet = await screen.findByTestId('settings-guide-sheet')
    await waitFor(() => expect(guideSection(sheet, 'sec-b')).toHaveAttribute('data-active', 'true'))
    expect(guideSection(sheet, 'sec-a')).not.toHaveAttribute('data-active')
  })
})
