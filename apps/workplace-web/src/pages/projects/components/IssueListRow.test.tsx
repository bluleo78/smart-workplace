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

  it.each(['DONE', 'CANCELED'] as const)('%s 상태에서 행 메뉴를 열면 제목이 배경과 구분된다', (status) => {
    const issue = createIssue({ status });
    renderWithProviders(
      <table>
        <tbody>
          <IssueRow
            issue={issue}
            projectKey="WP"
            selected={false}
            onToggleSelect={() => {}}
            onOpenMenu={() => {}}
            menuOpen
            columns={{ defs: [], left: [], right: [] }}
          />
        </tbody>
      </table>,
    );

    const title = screen.getByRole('link', { name: issue.title });
    expect(title).toHaveClass('text-foreground');
    expect(title).not.toHaveClass('text-muted-foreground');
    if (status === 'CANCELED') expect(title).toHaveClass('line-through');
    else expect(title).not.toHaveClass('line-through');
  });

  it.each(['DONE', 'CANCELED'] as const)('%s 상태에서 여러 행을 고르면 제목 대비를 보존한다', (status) => {
    const issue = createIssue({ status });
    renderWithProviders(
      <table>
        <tbody>
          <IssueRow
            issue={issue}
            projectKey="WP"
            selected
            onToggleSelect={() => {}}
            columns={{ defs: [], left: [], right: [] }}
          />
        </tbody>
      </table>,
    );

    const title = screen.getByRole('link', { name: issue.title });
    expect(title).toHaveClass('text-foreground');
    expect(title).not.toHaveClass('text-muted-foreground');
    expect(title.closest('tr')).toHaveClass('bg-primary/10');
    if (status === 'CANCELED') expect(title).toHaveClass('line-through');
    else expect(title).not.toHaveClass('line-through');
  });
});
