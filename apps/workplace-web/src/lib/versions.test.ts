// 버전 화면 순수 로직(WP-888) — 기한 판정·남은 일수 문구·유형별 묶음·다음 미출시·다른 버전 표기.
import { describe, expect, it } from 'vitest';

import type { IssueResponse } from '../types/issue';
import type { VersionResponse, VersionStatus } from '../types/version';
import {
  alsoInOtherVersions,
  daysLeftLabel,
  groupIssuesByType,
  isCountFresh,
  isVersionDateRangeInvalid,
  nextUnreleased,
  versionDueState,
  versionIssuesUrl,
  versionPatch,
  versionRowActions,
} from './versions';

const v = (id: number, status: VersionStatus, releaseDate: string | null = null): VersionResponse => ({
  id, name: `v${id}`, description: null, startDate: null, releaseDate, status, releasedAt: null,
  progress: { done: 0, inProgress: 0, todo: 0 }, affectsCount: 0,
});
const TODAY = '2026-10-26';

describe('versionDueState', () => {
  it('미출시 + 출시일이 어제면 overdue', () => {
    expect(versionDueState(v(1, 'UNRELEASED', '2026-10-25'), TODAY)).toBe('overdue');
  });
  it('미출시 + 출시일이 오늘·미래면 upcoming', () => {
    expect(versionDueState(v(1, 'UNRELEASED', TODAY), TODAY)).toBe('upcoming');
    expect(versionDueState(v(1, 'UNRELEASED', '2026-11-01'), TODAY)).toBe('upcoming');
  });
  it('출시됨·보관됨이거나 날짜가 없으면 none', () => {
    expect(versionDueState(v(1, 'RELEASED', '2026-10-25'), TODAY)).toBe('none');
    expect(versionDueState(v(1, 'ARCHIVED', '2026-10-25'), TODAY)).toBe('none');
    expect(versionDueState(v(1, 'UNRELEASED'), TODAY)).toBe('none');
  });
});

describe('daysLeftLabel', () => {
  it('남은 일수·지난 일수를 문구로', () => {
    expect(daysLeftLabel(v(1, 'UNRELEASED', '2026-10-29'), TODAY)).toBe('3일 남음');
    expect(daysLeftLabel(v(1, 'UNRELEASED', '2026-10-24'), TODAY)).toBe('2일 지남');
    expect(daysLeftLabel(v(1, 'UNRELEASED', TODAY), TODAY)).toBe('오늘 출시 예정');
  });
  it('미출시가 아니거나 출시일이 없으면 null', () => {
    expect(daysLeftLabel(v(1, 'RELEASED', '2026-10-29'), TODAY)).toBeNull();
    expect(daysLeftLabel(v(1, 'UNRELEASED'), TODAY)).toBeNull();
  });
});

describe('groupIssuesByType', () => {
  const t = (id: number, name: string) => ({ id, name, colorToken: 'GRAY', icon: 'Circle' as const });
  const issue = (number: number, type: ReturnType<typeof t> | null) => ({ number, type }) as unknown as IssueResponse;
  const types = [t(1, 'EPIC'), t(2, 'TASK'), t(3, 'BUG')];

  it('프로젝트 유형 순서로 묶고 빈 묶음은 뺀다', () => {
    const groups = groupIssuesByType([issue(1, types[2]), issue(2, types[1]), issue(3, types[2])], types);
    expect(groups.map((g) => g.type?.id)).toEqual([2, 3]);
    expect(groups[1].issues.map((i) => i.number)).toEqual([1, 3]);
  });
  it('유형이 없거나 목록에 없는 이슈는 맨 끝 type=null 묶음', () => {
    const groups = groupIssuesByType([issue(1, null), issue(2, types[0]), issue(3, t(99, 'X'))], types);
    expect(groups.map((g) => g.type?.id ?? null)).toEqual([1, null]);
    expect(groups[1].issues.map((i) => i.number)).toEqual([1, 3]);
  });
  it('이슈가 없으면 빈 배열', () => {
    expect(groupIssuesByType([], types)).toEqual([]);
  });
});

describe('nextUnreleased', () => {
  it('목록 순서상 다음 미출시를 돌려주고 출시·보관은 건너뛴다', () => {
    const list = [v(1, 'UNRELEASED'), v(2, 'RELEASED'), v(3, 'ARCHIVED'), v(4, 'UNRELEASED')];
    expect(nextUnreleased(list, 1)?.id).toBe(4);
  });
  it('마지막이거나 현재 id 가 없으면 null', () => {
    const list = [v(1, 'UNRELEASED'), v(2, 'UNRELEASED')];
    expect(nextUnreleased(list, 2)).toBeNull();
    expect(nextUnreleased(list, 9)).toBeNull();
  });
});

describe('alsoInOtherVersions', () => {
  it('현재 버전을 뺀 다른 수정 버전 이름', () => {
    const issue = { fixVersions: [{ id: 1, name: 'v1.5.2' }, { id: 2, name: 'v1.5.3' }] } as unknown as IssueResponse;
    expect(alsoInOtherVersions(issue, 1)).toEqual(['v1.5.3']);
  });
  it('수정 버전이 없는 구버전 응답은 빈 배열', () => {
    expect(alsoInOtherVersions({} as IssueResponse, 1)).toEqual([]);
  });
});

describe('versionPatch', () => {
  const target = { ...v(1, 'UNRELEASED', '2026-11-01'), name: 'v1', description: '설명', startDate: '2026-10-01' };
  const same = { name: 'v1', description: '설명', startDate: '2026-10-01', releaseDate: '2026-11-01' };
  it('바뀐 게 없으면 빈 본문', () => {
    expect(versionPatch(target, same)).toEqual({});
  });
  it('바뀐 필드만 싣고 이름은 앞뒤 공백을 뗀다', () => {
    expect(versionPatch(target, { ...same, name: ' v2 ', releaseDate: '2026-11-05' })).toEqual({
      name: 'v2',
      releaseDate: '2026-11-05',
    });
  });
  it('설명·날짜를 비우면 지우기 플래그', () => {
    expect(versionPatch(target, { ...same, description: '', startDate: '', releaseDate: '' })).toEqual({
      clearDescription: true,
      clearStartDate: true,
      clearReleaseDate: true,
    });
  });
});

describe('versionRowActions', () => {
  it('미출시는 편집·출시·보관, 출시됨은 출시 취소, 보관됨은 복원·삭제', () => {
    expect(versionRowActions({ status: 'UNRELEASED' }, true)).toEqual(['edit', 'release', 'archive']);
    expect(versionRowActions({ status: 'RELEASED' }, true)).toEqual(['edit', 'unrelease', 'archive']);
    expect(versionRowActions({ status: 'ARCHIVED' }, true)).toEqual(['edit', 'restore', 'delete']);
  });
  it('관리 권한이 없으면 없음', () => {
    expect(versionRowActions({ status: 'ARCHIVED' }, false)).toEqual([]);
  });
});

describe('isVersionDateRangeInvalid·versionIssuesUrl', () => {
  it('시작일 > 출시일만 잘못', () => {
    expect(isVersionDateRangeInvalid('2026-11-02', '2026-11-01')).toBe(true);
    expect(isVersionDateRangeInvalid('2026-11-01', '2026-11-01')).toBe(false);
    expect(isVersionDateRangeInvalid('', '2026-11-01')).toBe(false);
  });
  it('이슈 목록 URL', () => {
    expect(versionIssuesUrl('WP', 'fixVersion', 7)).toBe('/projects/WP?view=list&fixVersion=7');
  });
});

describe('isCountFresh', () => {
  const ok = { data: { fix: 1 }, isFetchedAfterMount: true, isFetching: false, isError: false };
  it('이번 열림에서 새로 읽고 끝났을 때만 true', () => {
    expect(isCountFresh(ok)).toBe(true);
    expect(isCountFresh({ ...ok, data: undefined })).toBe(false);
    expect(isCountFresh({ ...ok, isFetchedAfterMount: false })).toBe(false);
    expect(isCountFresh({ ...ok, isFetching: true })).toBe(false);
    expect(isCountFresh({ ...ok, isError: true })).toBe(false);
  });
});
