import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/test/renderWithProviders';
import { mockViewport } from '@/test/viewport';

import { createIssue } from '../../../../e2e/factories/issue.factory';
import { IssueCard } from './IssueCard';
import { IssueCardMenuContext } from './issueCardMenuContext';

mockViewport({ width: 1440, height: 900, pointer: 'fine' });

describe('데스크톱 보드 카드 제목', () => {
  it.each(['DONE', 'CANCELED'] as const)('%s 상태에 맞는 제목 스타일을 적용한다', (status) => {
    const issue = createIssue({ status });

    renderWithProviders(<IssueCard projectKey="WP" issue={issue} />);

    const title = screen.getByTestId(`issue-card-${issue.number}-title`);
    expect(title).toHaveTextContent(issue.title);
    expect(title).toHaveClass('text-muted-foreground', 'group-hover:text-foreground');
    expect(screen.getByTestId(`issue-card-${issue.number}-key`)).toBeInTheDocument();
    if (status === 'CANCELED') {
      expect(title).toHaveClass('line-through');
    } else {
      expect(title).not.toHaveClass('line-through');
    }
  });
});

it('메뉴가 열린 종료 카드 제목의 전경색을 복원한다', () => {
  const issue = createIssue({ status: 'DONE' });

  renderWithProviders(
    <IssueCardMenuContext.Provider value={{ openMenu: () => {}, menuIssueNumber: issue.number }}>
      <IssueCard projectKey="WP" issue={issue} />
    </IssueCardMenuContext.Provider>,
  );

  expect(screen.getByTestId(`issue-card-${issue.number}-title`)).toHaveClass('text-foreground');
});
