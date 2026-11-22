// ResultStatus 컴포넌트 테스트(WP-1943) — 키가 바뀐 뒤에만, 준비되면 한 번 채우는 live region.
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { nextFrames } from '@/test/nextFrames'

import { ResultStatus } from './ResultStatus'

type Props = { conditionKey: string; ready: boolean; text: string }

/** 테스트 id `rs` 로 렌더하고 props 를 바꾸는 rerender 도우미를 돌려준다. */
function setup(initial: Props) {
  const view = render(<ResultStatus {...initial} testId="rs" />)
  return { update: (p: Props) => view.rerender(<ResultStatus {...p} testId="rs" />) }
}
const el = () => screen.getByTestId('rs')

describe('ResultStatus', () => {
  it('첫 키는 ready 여도 읽지 않는다', async () => {
    setup({ conditionKey: 'a', ready: true, text: '연락처 3명' })
    await nextFrames()
    expect(el().textContent).toBe('')
    expect(el().getAttribute('role')).toBe('status')
    expect(el().getAttribute('aria-live')).toBe('polite')
    expect(el().getAttribute('aria-atomic')).toBe('true')
    expect(el().className).toContain('sr-only')
    // WP-1862 관례 — 스크롤·레이아웃에 영향 주지 않게 고정 위치(WP-1943 리뷰 후속).
    expect(el().className).toContain('fixed')
    expect(el().className).toContain('top-0')
    expect(el().className).toContain('left-0')
  })

  it('announceInitial 이면 첫 키에서도 준비되면 채운다(모드 갈림)', async () => {
    render(<ResultStatus conditionKey="group|10|kim" ready text="하위 조직 포함 검색 결과 2명" testId="rs" announceInitial />)
    await waitFor(() => expect(el().textContent).toBe('하위 조직 포함 검색 결과 2명'))
  })

  it('announceInitial 이 없으면 준비돼 있어도 첫 키는 비워 둔다', async () => {
    render(<ResultStatus conditionKey="group|10|kim" ready text="하위 조직 포함 검색 결과 2명" testId="rs" />)
    await nextFrames()
    expect(el().textContent).toBe('')
  })

  it('키가 바뀌고 준비되면 채운다', async () => {
    const { update } = setup({ conditionKey: 'a', ready: true, text: '연락처 3명' })
    update({ conditionKey: 'b', ready: true, text: '연락처 1명' })
    await waitFor(() => expect(el().textContent).toBe('연락처 1명'))
  })

  it('같은 문구라도 키가 바뀌면 비웠다가 다시 채운다', async () => {
    const { update } = setup({ conditionKey: 'a', ready: true, text: '연락처 3명' })
    update({ conditionKey: 'b', ready: true, text: '연락처 1명' })
    await waitFor(() => expect(el().textContent).toBe('연락처 1명'))
    update({ conditionKey: 'c', ready: true, text: '연락처 1명' })
    expect(el().textContent).toBe('')
    await waitFor(() => expect(el().textContent).toBe('연락처 1명'))
  })

  it('ready 가 거짓이면 채우지 않는다', async () => {
    const { update } = setup({ conditionKey: 'a', ready: true, text: '연락처 3명' })
    update({ conditionKey: 'b', ready: false, text: '연락처 9명' })
    await nextFrames()
    expect(el().textContent).toBe('')
    update({ conditionKey: 'b', ready: true, text: '연락처 2명' })
    await waitFor(() => expect(el().textContent).toBe('연락처 2명'))
  })

  it('같은 키의 재조회로는 바꾸지 않는다', async () => {
    const { update } = setup({ conditionKey: 'a', ready: true, text: '연락처 3명' })
    update({ conditionKey: 'b', ready: true, text: '연락처 1명' })
    await waitFor(() => expect(el().textContent).toBe('연락처 1명'))
    update({ conditionKey: 'b', ready: true, text: '연락처 5명' })
    await nextFrames()
    expect(el().textContent).toBe('연락처 1명')
  })

  it('앞서 알린 키로 돌아와도 새로 채운다', async () => {
    const { update } = setup({ conditionKey: 'a', ready: true, text: '연락처 3명' })
    update({ conditionKey: 'b', ready: true, text: '연락처 1명' })
    await waitFor(() => expect(el().textContent).toBe('연락처 1명'))
    update({ conditionKey: 'c', ready: false, text: '연락처 9명' })
    update({ conditionKey: 'b', ready: false, text: '연락처 1명' })
    expect(el().textContent).toBe('')
    await nextFrames()
    expect(el().textContent).toBe('')
    update({ conditionKey: 'b', ready: true, text: '연락처 4명' })
    await waitFor(() => expect(el().textContent).toBe('연락처 4명'))
  })
})
