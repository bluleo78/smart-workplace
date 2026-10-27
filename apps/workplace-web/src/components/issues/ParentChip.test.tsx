// 부모 칩·배지(WP-1038) — 다른 프로젝트 에픽은 그 프로젝트 키로 링크하고, 조회자가 읽을 수 없는 에픽은 링크 없이 「볼 수 없는 에픽」.
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/test/renderWithProviders';

import type { ParentRef } from '../../types/issue';
import { ParentBadge } from './ParentBadge';
import { ParentChip } from './ParentChip';

const EPIC = { id: 1, name: 'EPIC', icon: 'Zap', colorToken: 'PURPLE' } as unknown as ParentRef['type'];
const crossParent: ParentRef = { number: 3, title: '기획 에픽', type: EPIC, projectKey: 'PLAN' };
const hiddenParent = { number: 0, title: null, type: null, hidden: true } as unknown as ParentRef;

describe('ParentChip', () => {
  it('다른 프로젝트 에픽은 부모의 프로젝트 키로 링크·키를 만든다', () => {
    renderWithProviders(<ParentChip projectKey="WP" parent={crossParent} issueNumber={9} showKey />);
    const chip = screen.getByTestId('issue-row-9-parent');
    expect(chip).toHaveAttribute('href', '/projects/PLAN/issues/3');
    expect(chip).toHaveTextContent('PLAN-3');
  });

  it('가려진 부모는 링크 없이 「볼 수 없는 에픽」', () => {
    renderWithProviders(<ParentChip projectKey="WP" parent={hiddenParent} issueNumber={9} showKey />);
    const chip = screen.getByTestId('issue-row-9-parent');
    expect(chip.tagName).toBe('SPAN');
    expect(chip).toHaveTextContent('볼 수 없는 에픽');
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('ParentBadge', () => {
  it('다른 프로젝트 에픽은 그 프로젝트로 링크한다', () => {
    renderWithProviders(<ParentBadge projectKey="WP" parent={crossParent} />);
    const badge = screen.getByTestId('parent-badge-3');
    expect(badge).toHaveAttribute('href', '/projects/PLAN/issues/3');
    expect(badge).toHaveTextContent('PLAN-3');
  });

  it('가려진 부모는 링크 없이 문구만', () => {
    renderWithProviders(<ParentBadge projectKey="WP" parent={hiddenParent} />);
    expect(screen.getByTestId('parent-badge-hidden')).toHaveTextContent('볼 수 없는 에픽');
    expect(screen.queryByRole('link')).toBeNull();
  });
});
