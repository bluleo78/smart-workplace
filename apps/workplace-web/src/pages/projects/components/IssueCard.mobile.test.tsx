import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/test/renderWithProviders';
import { MOBILE_VIEWPORT, mockViewport } from '@/test/viewport';

import { createIssue } from '../../../../e2e/factories/issue.factory';
import { IssueCard } from './IssueCard';

mockViewport(MOBILE_VIEWPORT);

describe('모바일 보드 카드 본문', () => {
  it.each(['DONE', 'CANCELED'] as const)('%s 종료 제목 표시를 유지하고 모바일 메타를 렌더링한다', (status) => {
    const issue = createIssue({ status });

    renderWithProviders(<IssueCard projectKey="WP" issue={issue} />);

    const title = screen.getByTestId(`issue-card-${issue.number}-title`);
    expect(title).toHaveTextContent(issue.title);
    expect(title).toHaveClass('text-muted-foreground', 'group-hover:text-foreground');
    expect(screen.getByTestId(`issue-card-${issue.number}-meta`)).toBeInTheDocument();
    expect(screen.queryByTestId(`issue-card-${issue.number}-key`)).not.toBeInTheDocument();
    if (status === 'CANCELED') {
      expect(title).toHaveClass('line-through');
    } else {
      expect(title).not.toHaveClass('line-through');
    }
  });
});
