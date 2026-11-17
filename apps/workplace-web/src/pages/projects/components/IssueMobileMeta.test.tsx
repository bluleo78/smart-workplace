// IssueMobileMeta ◆ 에픽 — 하위 태스크도 스토리의 에픽(parent.epic)을 보인다(WP-1692).
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { IssueResponse } from '@/types/issue';

import { createIssue } from '../../../../e2e/factories/issue.factory';
import { makeEpicType } from '../../../../e2e/factories/issueType.factory';
import { IssueMobileMeta } from './IssueMobileMeta';

const epicRef = { number: 1, title: '결제 개편 에픽', type: makeEpicType() };
const storyType = { id: 2, name: 'STORY', colorToken: 'BLUE', icon: 'Flag' } as const;

function subtask(): IssueResponse {
  return createIssue({ number: 3, parent: { number: 2, title: '스토리', type: storyType, epic: epicRef } });
}

describe('IssueMobileMeta ◆ 에픽 (WP-1692)', () => {
  it('하위 태스크는 스토리의 에픽 제목을 보인다', () => {
    render(<IssueMobileMeta issue={subtask()} projectKey="WP" testIdPrefix="row-3" />);
    expect(screen.getByTestId('row-3-epic')).toHaveTextContent('결제 개편 에픽');
  });

  it('hideEpic 이면 에픽을 숨긴다', () => {
    render(<IssueMobileMeta issue={subtask()} projectKey="WP" testIdPrefix="row-3" hideEpic />);
    expect(screen.queryByTestId('row-3-epic')).not.toBeInTheDocument();
  });
});
