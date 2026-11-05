// 통합 검색 결과 한 줄(WP-1358) — 메시지 줄(보낸 사람 · 본문 | # 채널 · 시각)과 기존 줄(meta·시각)이 각자 모양을 지키는지 본다.
import { render, screen, within } from '@testing-library/react'
import { expect, test, vi } from 'vitest'

import type { SearchHit } from './searchProviders'
import { SearchResultRow } from './SearchResultRow'

function row(hit: SearchHit) {
  render(<SearchResultRow hit={hit} q="보고" active={false} id="r" onPick={vi.fn()} onHover={vi.fn()} />)
  return screen.getByTestId(`global-search-hit-${hit.key}`)
}

test('메시지 줄 — 보낸 사람, 강조된 본문, 「# 채널 · 시각」', () => {
  const el = row({
    key: 'chat:message:8',
    app: 'chat',
    title: '주간 보고 완료',
    href: '/chat/channels/1?message=8',
    meta: '# 주간-보고',
    time: '어제',
    sender: '김보고',
    group: '메시지',
  })
  expect(within(el).getByTestId('global-search-hit-sender')).toHaveTextContent('김보고')
  expect(within(el).getByText('보고', { selector: 'mark' })).toBeInTheDocument()
  expect(el).toHaveTextContent('김보고주간 보고 완료# 주간-보고·어제')
})

test('보낸 사람이 없는 줄(AI 대화)은 meta·시각 사이 점 없이 그대로', () => {
  const el = row({ key: 'ai:x', app: 'ai', title: '보고서 정리', href: '/?aiChat=x', meta: '메타', time: '어제' })
  expect(within(el).queryByTestId('global-search-hit-sender')).toBeNull()
  expect(el).toHaveTextContent('보고서 정리메타어제')
  expect(el).not.toHaveTextContent('·')
})
