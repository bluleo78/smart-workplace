import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/test/renderWithProviders';
import { MOBILE_VIEWPORT, mockResizableViewport } from '@/test/viewport';

import { createIssue } from '../../../e2e/factories/issue.factory';
import { IssueListTable } from './IssueListTable';

const viewport = mockResizableViewport(MOBILE_VIEWPORT);

describe.each([
  { device: '데스크톱', width: 1440, titleTestId: undefined },
  { device: '모바일', width: MOBILE_VIEWPORT.width, titleTestId: 'assigned-row-410-title' },
])('$device 공용 이슈 표 종료 제목', ({ width, titleTestId }) => {
  it.each(['DONE', 'CANCELED'] as const)('%s 범주의 제목을 프로젝트 목록과 같은 방식으로 표시한다', (status) => {
    viewport.setWidth(width);
    const issue = createIssue({ id: 410, number: 410, status });

    renderWithProviders(<IssueListTable items={[issue]} rowTestIdPrefix="assigned-row" showAssignee />);

    const title = titleTestId
      ? screen.getByTestId(titleTestId)
      : screen.getByRole('link', { name: issue.title });
    expect(title).toHaveTextContent(issue.title);
    expect(title).toHaveClass('text-muted-foreground', 'group-hover:text-foreground');
    expect(screen.getByTestId('assigned-row-410')).toHaveClass('group');
    if (status === 'CANCELED') {
      expect(title).toHaveClass('line-through');
    } else {
      expect(title).not.toHaveClass('line-through');
    }
  });
});
