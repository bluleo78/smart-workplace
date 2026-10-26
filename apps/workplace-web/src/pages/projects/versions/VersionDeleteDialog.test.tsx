// VersionDeleteDialog(WP-888) — 붙은 이슈 수를 새로 읽기 전·읽기 실패 때는 삭제가 잠기고, 실패하면 오류와 다시 시도가 나온다.
import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/renderWithProviders';

import type { VersionResponse } from '../../../types/version';
import { VersionDeleteDialog } from './VersionDeleteDialog';

const state = vi.hoisted(() => ({ count: undefined as unknown, isError: false, fresh: true, refetch: vi.fn() }));

vi.mock('@/hooks/queries/useVersions', () => ({
  useVersions: () => ({ data: [ver(1), ver(2)] }),
  useVersionIssueCount: () => ({
    data: state.count,
    isError: state.isError,
    isFetchedAfterMount: state.fresh,
    isFetching: !state.fresh,
    refetch: state.refetch,
  }),
  useDeleteVersion: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

function ver(id: number): VersionResponse {
  return { id, name: `v${id}`, description: null, startDate: null, releaseDate: null, status: 'ARCHIVED', releasedAt: null,
    progress: { done: 0, inProgress: 0, todo: 0 }, affectsCount: 0 };
}

describe('VersionDeleteDialog', () => {
  beforeEach(() => {
    state.count = undefined;
    state.isError = false;
    state.fresh = true;
    state.refetch.mockClear();
  });

  it('수를 읽는 동안에는 삭제 버튼이 잠긴다', () => {
    state.fresh = false;
    renderWithProviders(<VersionDeleteDialog projectKey="WP" version={ver(1)} onClose={() => {}} />);
    expect(screen.getByTestId('version-delete-confirm')).toBeDisabled();
  });

  it('캐시에 옛 수가 남아 있어도 새로 읽기 전에는 삭제 버튼이 잠긴다', () => {
    state.count = { fix: 0, affects: 0, unresolvedFix: 0 };
    state.fresh = false;
    renderWithProviders(<VersionDeleteDialog projectKey="WP" version={ver(1)} onClose={() => {}} />);
    expect(screen.getByTestId('version-delete-confirm')).toBeDisabled();
  });

  it('새로 읽은 수가 있으면 영향 안내가 나오고 삭제할 수 있다', () => {
    state.count = { fix: 2, affects: 1, unresolvedFix: 0 };
    renderWithProviders(<VersionDeleteDialog projectKey="WP" version={ver(1)} onClose={() => {}} />);
    expect(screen.getByTestId('version-delete-impact')).toBeInTheDocument();
    expect(screen.getByTestId('version-delete-confirm')).toBeEnabled();
  });

  it('수를 읽지 못하면 오류와 다시 시도가 나오고 삭제는 잠긴 채 다시 시도로 다시 읽는다', () => {
    state.isError = true;
    renderWithProviders(<VersionDeleteDialog projectKey="WP" version={ver(1)} onClose={() => {}} />);
    expect(screen.getByTestId('version-delete-count-error')).toBeInTheDocument();
    expect(screen.getByTestId('version-delete-confirm')).toBeDisabled();
    fireEvent.click(screen.getByTestId('version-delete-count-retry'));
    expect(state.refetch).toHaveBeenCalledTimes(1);
  });
});
