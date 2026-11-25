// 홈 「이슈」 위젯 — 끝난 이슈 제목의 흐림·삭선 표시(WP-2101). previewData 로 그려 조회 없이 클래스만 본다.
import { screen } from '@testing-library/react'
import { expect, test } from 'vitest'

import { renderScreen } from '@/test/renderScreen'
import type { IssueSearchResponse } from '@/types/issue'

import IssueListWidget from './IssueListWidget'

const data = {
  items: [
    { id: 1, projectKey: 'WP', number: 1, title: '끝난 일', status: 'DONE', statusName: '완료' },
    { id: 2, projectKey: 'WP', number: 2, title: '접은 일', status: 'CANCELED', statusName: '취소' },
    { id: 3, projectKey: 'WP', number: 3, title: '할 일', status: 'TODO', statusName: '할 일' },
  ],
  nextCursor: null,
  hasMore: false,
} as unknown as IssueSearchResponse

test('DONE 제목은 흐리고 CANCELED 는 삭선, 열린 이슈는 그대로이며 키에는 삭선이 없다', () => {
  renderScreen(<IssueListWidget previewData={data} />)
  const titles = screen.getAllByTestId('issuelist-title')
  expect(titles[0]).toHaveTextContent('끝난 일')
  expect(titles[0]).toHaveClass('text-muted-foreground', 'group-hover:text-ai-accent')
  // 호버 색은 열린 행(Link 의 hover:text-ai-accent)과 같다 — 전경색 호버가 남지 않는다.
  expect(titles[0]).not.toHaveClass('group-hover:text-foreground')
  expect(titles[0]).not.toHaveClass('line-through')
  expect(titles[1]).toHaveClass('line-through')
  expect(titles[2].className).toBe('')
  // 키 텍스트 요소에는 삭선이 없다.
  expect(screen.getByText('WP-2')).not.toHaveClass('line-through')
  // 호버로 제목이 또렷해지려면 Link 가 group 이어야 한다.
  expect(titles[0].closest('a')).toHaveClass('group')
})
