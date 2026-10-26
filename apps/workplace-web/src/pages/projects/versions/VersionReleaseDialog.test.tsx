// VersionReleaseDialog(WP-888) — 끝나지 않은 이슈 수를 읽기 전에는 출시 버튼이 잠기고, 읽은 뒤 0건 초과면 옮기기 선택지가 나온다.
import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/renderWithProviders';

import type { VersionResponse } from '../../../types/version';
import { VersionReleaseDialog } from './VersionReleaseDialog';

const state = vi.hoisted(() => ({ count: undefined as unknown, loading: true, isError: false, fresh: true, refetch: vi.fn() }));

vi.mock('@/hooks/queries/useVersions', () => ({
  useVersions: () => ({ data: [ver(1, 'UNRELEASED'), ver(2, 'UNRELEASED')] }),
  useVersionIssueCount: () => ({
    isLoading: state.loading,
    data: state.count,
    isError: state.isError,
    // 캐시에 옛 값이 남은 채 다시 읽는 중인 상태를 흉내 낸다(fresh=false).
    isFetchedAfterMount: state.fresh,
    isFetching: !state.fresh,
    refetch: state.refetch,
  }),
  useReleaseVersion: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

function ver(id: number, status: 'UNRELEASED'): VersionResponse {
  return { id, name: `v${id}`, description: null, startDate: null, releaseDate: null, status, releasedAt: null,
    progress: { done: 0, inProgress: 0, todo: 0 }, affectsCount: 0 };
}

describe('VersionReleaseDialog', () => {
  beforeEach(() => {
    state.count = undefined;
    state.loading = true;
    state.isError = false;
    state.fresh = true;
    state.refetch.mockClear();
  });

  it('수를 읽는 동안에는 출시 버튼이 잠긴다', () => {
    renderWithProviders(<VersionReleaseDialog projectKey="WP" version={ver(1, 'UNRELEASED')} onClose={() => {}} />);
    expect(screen.getByTestId('version-release-submit')).toBeDisabled();
  });

  it('수를 읽고 끝나지 않은 이슈가 있으면 옮기기 선택지가 나오고 출시할 수 있다', () => {
    state.loading = false;
    state.count = { fix: 3, affects: 0, unresolvedFix: 2 };
    renderWithProviders(<VersionReleaseDialog projectKey="WP" version={ver(1, 'UNRELEASED')} onClose={() => {}} />);
    expect(screen.getByText('아직 끝나지 않은 이슈 2건이 있어요.')).toBeInTheDocument();
    expect(screen.getByText('다음 버전으로 옮기기')).toBeInTheDocument();
    expect(screen.getByTestId('version-release-submit')).toBeEnabled();
  });

  it('캐시에 옛 수가 남아 있어도 새로 읽기 전에는 출시 버튼이 잠긴다', () => {
    state.loading = false;
    state.count = { fix: 3, affects: 0, unresolvedFix: 2 };
    state.fresh = false;
    renderWithProviders(<VersionReleaseDialog projectKey="WP" version={ver(1, 'UNRELEASED')} onClose={() => {}} />);
    expect(screen.getByTestId('version-release-submit')).toBeDisabled();
  });

  it('수를 읽지 못하면 오류와 다시 시도가 나오고 출시는 잠긴 채 다시 시도로 다시 읽는다', () => {
    state.loading = false;
    state.isError = true;
    renderWithProviders(<VersionReleaseDialog projectKey="WP" version={ver(1, 'UNRELEASED')} onClose={() => {}} />);
    expect(screen.getByTestId('version-release-count-error')).toBeInTheDocument();
    expect(screen.getByTestId('version-release-submit')).toBeDisabled();
    fireEvent.click(screen.getByTestId('version-release-count-retry'));
    expect(state.refetch).toHaveBeenCalledTimes(1);
  });
});
