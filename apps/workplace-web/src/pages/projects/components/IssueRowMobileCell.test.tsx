import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/test/renderWithProviders';

import { createIssue } from '../../../../e2e/factories/issue.factory';
import { IssueRowMobileCell } from './IssueRowMobileCell';

describe('모바일 목록 제목', () => {
  it.each(['DONE', 'CANCELED'] as const)('%s 상태에 맞는 제목 스타일을 적용한다', (status) => {
    const issue = createIssue({ status });
    renderWithProviders(
      <table>
        <tbody>
          <tr>
            <IssueRowMobileCell
              issue={issue}
              projectKey="WP"
              to="/projects/WP/issues/1"
              selected={false}
              menuOpen={false}
              hideEpic={false}
              colSpan={6}
            />
          </tr>
        </tbody>
      </table>,
    );

    const title = screen.getByRole('link', { name: issue.title });
    expect(title).toHaveClass('text-muted-foreground', 'group-hover:text-foreground');
    if (status === 'CANCELED') {
      expect(title).toHaveClass('line-through');
    } else {
      expect(title).not.toHaveClass('line-through');
    }
  });

  it('CANCELED 상태에서 선택 배경 위 제목은 전경색을 유지한다', () => {
    const issue = createIssue({ status: 'CANCELED' });
    renderWithProviders(
      <table>
        <tbody>
          <tr>
            <IssueRowMobileCell
              issue={issue}
              projectKey="WP"
              to="/projects/WP/issues/1"
              selected
              menuOpen={false}
              hideEpic={false}
              colSpan={6}
            />
          </tr>
        </tbody>
      </table>,
    );

    const title = screen.getByRole('link', { name: issue.title });
    expect(title).toHaveClass('text-foreground', 'line-through');
    expect(title).not.toHaveClass('text-muted-foreground');
  });

  it.each(['DONE', 'CANCELED'] as const)('%s 상태에서 작업 시트가 열리면 제목 대비를 유지한다', (status) => {
    const issue = createIssue({ status });
    renderWithProviders(
      <table>
        <tbody>
          <tr>
            <IssueRowMobileCell
              issue={issue}
              projectKey="WP"
              to="/projects/WP/issues/1"
              selected={false}
              menuOpen
              hideEpic={false}
              colSpan={6}
            />
          </tr>
        </tbody>
      </table>,
    );

    const title = screen.getByRole('link', { name: issue.title });
    expect(title).toHaveClass('text-foreground');
    expect(title).not.toHaveClass('text-muted-foreground');
    if (status === 'CANCELED') expect(title).toHaveClass('line-through');
    else expect(title).not.toHaveClass('line-through');
  });

});
