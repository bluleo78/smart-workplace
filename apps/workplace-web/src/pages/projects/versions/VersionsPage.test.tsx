// VersionsPage(WP-888) 권한·빈 상태·접기 분기 — OWNER/ADMIN 은 만들기·⋯ 메뉴, 멤버는 읽기 전용, 삭제는 보관된 행만, 비면 안내 문구.
// 훅을 vi.mock 으로 끊고 분기만 본다(WP-413). 실제 API(MSW)를 지나는 권한·출시 요청은 versionManage.test.tsx, 화면 배선은 E2E(issue-versions.spec.ts)가 맡는다.
import { fireEvent, screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/renderWithProviders';

import type { VersionResponse, VersionStatus } from '../../../types/version';
import VersionsPage from './VersionsPage';

const state = vi.hoisted(() => ({
  versions: [] as unknown[],
  members: [] as unknown[],
  isAdmin: false,
  type: 'TEAM',
}));

vi.mock('@/hooks/queries/useVersions', () => {
  const mutation = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
  return {
    useVersions: () => ({ isLoading: false, data: state.versions }),
    useVersionIssueCount: () => ({ isLoading: false, data: { fix: 0, affects: 0, unresolvedFix: 0 } }),
    useCreateVersion: () => mutation,
    useUpdateVersion: () => mutation,
    useReleaseVersion: () => mutation,
    useUnreleaseVersion: () => mutation,
    useDeleteVersion: () => mutation,
  };
});
vi.mock('@/hooks/queries/useProjects', () => ({
  useProject: () => ({ error: null, data: { key: 'WP', name: '워크플레이스', type: state.type } }),
}));
vi.mock('@/hooks/queries/useProjectMembers', () => ({
  useProjectMembers: () => ({ isLoading: false, data: state.members }),
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 1 }, isAdmin: state.isAdmin }),
}));

const ver = (id: number, name: string, status: VersionStatus, extra: Partial<VersionResponse> = {}): VersionResponse => ({
  id, name, description: null, startDate: null, releaseDate: null, status, releasedAt: null,
  progress: { done: 1, inProgress: 0, todo: 1 }, affectsCount: 0, ...extra,
});

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<VersionsPage />} />
    </Routes>,
  );
}

describe('VersionsPage', () => {
  beforeEach(() => {
    state.versions = [];
    state.members = [{ userId: 1, role: 'OWNER' }];
    state.isAdmin = false;
    state.type = 'TEAM';
  });

  it('버전이 없으면 안내 문구를 보인다', () => {
    renderPage();
    expect(
      screen.getByText('출시 단위로 이슈를 모으고 진행을 봐요. 버전을 만들면 이슈에 수정 버전·영향 버전 칸이 생겨요.'),
    ).toBeInTheDocument();
  });

  it('OWNER 는 만들기와 행 ⋯ 메뉴가 보이고 요약에 미출시·출시됨 수가 나온다', () => {
    state.versions = [ver(1, 'v1.0', 'RELEASED'), ver(2, 'v1.1', 'UNRELEASED'), ver(3, 'v1.2', 'UNRELEASED')];
    renderPage();
    expect(screen.getByTestId('version-new')).toBeInTheDocument();
    expect(screen.getByTestId('version-menu-2')).toBeInTheDocument();
    expect(screen.getByTestId('version-summary')).toHaveTextContent('미출시 2 · 출시됨 1');
  });

  it('멤버는 읽기 전용 — 만들기·⋯ 메뉴가 없다', () => {
    state.members = [{ userId: 1, role: 'MEMBER' }];
    state.versions = [ver(1, 'v1.0', 'UNRELEASED')];
    renderPage();
    expect(screen.queryByTestId('version-new')).not.toBeInTheDocument();
    expect(screen.queryByTestId('version-menu-1')).not.toBeInTheDocument();
    expect(screen.getByText('v1.0')).toBeInTheDocument();
  });

  it('테넌트 ADMIN 은 멤버가 아니어도 관리할 수 있다', () => {
    state.members = [];
    state.isAdmin = true;
    state.versions = [ver(1, 'v1.0', 'UNRELEASED')];
    renderPage();
    expect(screen.getByTestId('version-new')).toBeInTheDocument();
  });

  it('보관한 버전은 접혀 있다가 펼치면 보이고, 삭제는 보관된 행에만 있다', async () => {
    state.versions = [ver(1, 'v1.1', 'UNRELEASED'), ver(2, 'v0.9', 'ARCHIVED')];
    renderPage();
    expect(screen.queryByText('v0.9')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /보관한 버전 1개 보기/ }));
    expect(screen.getByText('v0.9')).toBeInTheDocument();

    // 보관 안 된 행 메뉴 — 삭제 없음.
    fireEvent.pointerDown(screen.getByTestId('version-menu-1'), { button: 0, ctrlKey: false });
    expect(await screen.findByTestId('version-action-archive')).toBeInTheDocument();
    expect(screen.queryByTestId('version-action-delete')).not.toBeInTheDocument();
  });

  it('보관된 행 메뉴에는 복원·삭제가 있다', async () => {
    state.versions = [ver(2, 'v0.9', 'ARCHIVED')];
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /보관한 버전 1개 보기/ }));
    fireEvent.pointerDown(screen.getByTestId('version-menu-2'), { button: 0, ctrlKey: false });
    expect(await screen.findByTestId('version-action-delete')).toBeInTheDocument();
    expect(screen.getByTestId('version-action-restore')).toBeInTheDocument();
  });

  it('미출시인데 출시일이 지났으면 「지남」을 붉게 표시한다', () => {
    state.versions = [ver(1, 'v1.0', 'UNRELEASED', { releaseDate: '2000-01-01' }), ver(2, 'v1.1', 'RELEASED', { releaseDate: '2000-01-01' })];
    renderPage();
    expect(screen.getAllByText('지남')).toHaveLength(1);
  });
});
