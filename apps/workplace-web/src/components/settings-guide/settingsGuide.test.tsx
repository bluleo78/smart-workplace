// 설정 가이드(WP-1281) 화면 컴포넌트 테스트 — 섹션별 가이드 그리기, 본문에서 보고 있는 섹션 따라가기.
// 섹션 판정 자체는 activeSection.test.ts(순수 함수)가 지키고, 여기서는 그 판정이 실제 스크롤 요소·섹션 id 와 이어지는지를 본다.
// jsdom 은 레이아웃이 없어 getBoundingClientRect·clientHeight 가 0 이라 섹션 머리 위치를 직접 정해 준다(본문 폭이 0 이라 가이드는 시트로 열린다).
import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { AIAssistantProvider } from '@/components/ai/AIAssistantContext'
import { SettingsPage } from '@/components/layout/SettingsPage'
import { SettingsSection } from '@/components/layout/SettingsSection'
import { renderScreen } from '@/test/renderScreen'

import type { SettingsGuide } from './types'

const GUIDE: SettingsGuide = {
  title: '시험 화면',
  lead: '시험용 가이드예요.',
  tips: [],
  sections: [
    { id: 'sec-a', title: '섹션 A', tips: ['A 팁이에요.'] },
    { id: 'sec-b', title: '섹션 B', tips: ['B 팁이에요.'] },
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

function Screen({ guide = GUIDE }: { guide?: SettingsGuide }) {
  return (
    <AIAssistantProvider hotkeysEnabled={false}>
      <SettingsPage title="시험 화면" width="form" guide={guide}>
        <SettingsSection id="sec-a" title="섹션 A">
          A 본문
        </SettingsSection>
        <SettingsSection id="sec-b" title="섹션 B">
          B 본문
        </SettingsSection>
        <SettingsSection id="sec-c" title="섹션 C">
          C 본문
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
  test('소개와 섹션마다 제목·팁·주의를 화면 섹션 순서대로 그린다', async () => {
    const { user } = renderScreen(<Screen />, { path: '/x' })
    const sheet = await openSheet(user)
    expect(sheet).toHaveTextContent('시험용 가이드예요.')
    const sections = [...sheet.querySelectorAll('[data-guide-section]')].map((el) => el.getAttribute('data-guide-section'))
    expect(sections).toEqual(['sec-a', 'sec-b', 'sec-c'])
    expect(guideSection(sheet, 'sec-a')).toHaveTextContent('A 팁이에요.')
    expect(guideSection(sheet, 'sec-b')).toHaveTextContent('B 팁이에요.')
    expect(guideSection(sheet, 'sec-c')).toHaveTextContent('C 주의예요.')
    // 섹션이 없는 상위 알아두기·주의 블록은 비어 있으면 그리지 않는다.
    expect(within(sheet).queryByText('알아두기')).not.toBeInTheDocument()
  })

  test('가이드가 없는 화면에는 단추가 없다', async () => {
    renderScreen(<SettingsPage title="가이드 없음" width="form">본문</SettingsPage>, { path: '/x' })
    expect(await screen.findByText('가이드 없음')).toBeInTheDocument()
    expect(screen.queryByTestId('settings-guide-button')).not.toBeInTheDocument()
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

  // WP-1298: 도움말 없는 화면 섹션(기본 정보·상태·위험 구역 등)을 읽는 동안 위쪽 섹션의 도움말·주의를 강조하지 않는다.
  test('지금 보는 화면 섹션에 도움말이 없으면 아무 섹션도 강조하지 않고, 도움말 있는 섹션에 닿으면 다시 강조한다', async () => {
    const guide: SettingsGuide = { ...GUIDE, sections: GUIDE.sections!.filter((sec) => sec.id !== 'sec-b') }
    const { user } = renderScreen(<Screen guide={guide} />, { path: '/x' })
    const sheet = await openSheet(user)
    await waitFor(() => expect(guideSection(sheet, 'sec-a')).toHaveAttribute('data-active', 'true'))
    // B(도움말 없음) 머리가 기준선 위 — A 는 이미 지나갔다.
    tops = { 'sec-a': -650, 'sec-b': 250, 'sec-c': 1150 }
    await scrollBody()
    await waitFor(() => expect(guideSection(sheet, 'sec-a')).not.toHaveAttribute('data-active'))
    expect(guideSection(sheet, 'sec-c')).not.toHaveAttribute('data-active')
    tops = { 'sec-a': -1550, 'sec-b': -650, 'sec-c': 250 }
    await scrollBody()
    await waitFor(() => expect(guideSection(sheet, 'sec-c')).toHaveAttribute('data-active', 'true'))
  })
})
