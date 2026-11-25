import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/test/renderWithProviders';

import { createIssue } from '../../../../e2e/factories/issue.factory';
import { IssueRow } from './IssueListRow';

describe('데스크톱 목록 제목', () => {
  it.each(['IN_PROGRESS', 'DONE', 'CANCELED'] as const)('%s 상태에 맞는 제목 스타일을 적용한다', (status) => {
    const issue = createIssue({ status });
    renderWithProviders(
      <table>
        <tbody>
          <IssueRow
            issue={issue}
            projectKey="WP"
            selected={false}
            onToggleSelect={() => {}}
            columns={{ defs: [], left: [], right: [] }}
          />
        </tbody>
      </table>,
    );

    const title = screen.getByRole('link', { name: issue.title });
    if (status === 'IN_PROGRESS') {
      expect(title).not.toHaveClass('text-muted-foreground');
      expect(title).not.toHaveClass('group-hover:text-foreground');
    } else {
      expect(title).toHaveClass('text-muted-foreground', 'group-hover:text-foreground');
    }
    if (status === 'CANCELED') {
      expect(title).toHaveClass('line-through');
    } else {
      expect(title).not.toHaveClass('line-through');
    }
  });
});
