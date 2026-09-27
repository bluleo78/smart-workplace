import { describe, expect, it, vi } from 'vitest';
import {
  defaultListAssignee,
  resolveAssigneeIds,
  resolveCycleIds,
  resolveLabelIds,
  resolveMilestoneId,
  resolveTypeId,
  type ProjectMetaClient,
} from './resolve.js';

/** 리졸브 소스만 채운 mock 클라이언트. */
function client(): ProjectMetaClient {
  return {
    getProjectTypes: vi.fn().mockResolvedValue([
      { id: 1, name: 'TASK' },
      { id: 2, name: 'BUG' },
    ]),
    getProjectMembers: vi.fn().mockResolvedValue([
      { userId: 10, username: 'alice' },
      { userId: 11, username: 'bob' },
    ]),
    getProjectLabels: vi.fn().mockResolvedValue([
      { id: 100, name: 'urgent' },
      { id: 101, name: 'backend' },
    ]),
    getProjectMilestones: vi.fn().mockResolvedValue([{ id: 7, name: 'v1.0' }]),
    getProjectCycles: vi.fn().mockResolvedValue([
      { id: 30, name: 'Sprint 3', status: 'ACTIVE' },
      { id: 31, name: 'Sprint 4', status: 'PLANNED' },
    ]),
  };
}

describe('resolveTypeId', () => {
  it('유형 이름을 id 로 변환한다', async () => {
    await expect(resolveTypeId(client(), 'WP', 'BUG')).resolves.toBe(2);
  });
  it('없는 유형이면 유효 목록을 담아 throw', async () => {
    await expect(resolveTypeId(client(), 'WP', 'EPIC')).rejects.toThrow(
      "유형 'EPIC' 을(를) 찾을 수 없습니다. 사용 가능: TASK, BUG",
    );
  });
});

describe('resolveAssigneeIds', () => {
  it('username 배열을 userId 배열로 변환한다', async () => {
    await expect(resolveAssigneeIds(client(), 'WP', ['bob', 'alice'])).resolves.toEqual([11, 10]);
  });
  it('없는 username 이면 유효 목록을 담아 throw', async () => {
    await expect(resolveAssigneeIds(client(), 'WP', ['carol'])).rejects.toThrow(
      "멤버 'carol' 을(를) 찾을 수 없습니다. 사용 가능 username: alice, bob",
    );
  });
});

describe('resolveLabelIds', () => {
  it('라벨 이름 배열을 id 배열로 변환한다', async () => {
    await expect(resolveLabelIds(client(), 'WP', ['backend'])).resolves.toEqual([101]);
  });
  it('없는 라벨이면 유효 목록을 담아 throw', async () => {
    await expect(resolveLabelIds(client(), 'WP', ['nope'])).rejects.toThrow(
      "라벨 'nope' 을(를) 찾을 수 없습니다. 사용 가능: urgent, backend",
    );
  });
});

// #841: reporter 만 준 "내가 만든" 조회에 assignee=me 가 끼면 교집합이 되므로 둘 다 없을 때만 기본값.
describe('defaultListAssignee', () => {
  it('assignee·reporter 모두 없으면 me', () => {
    expect(defaultListAssignee({})).toBe('me');
  });
  it('reporter 만 있으면 생략', () => {
    expect(defaultListAssignee({ reporter: 'me' })).toBeUndefined();
  });
  it('assignee 가 있으면 그대로', () => {
    expect(defaultListAssignee({ assignee: 'kim', reporter: 'me' })).toBe('kim');
  });
});

describe('마일스톤·사이클 리졸브 (#854)', () => {
  it('마일스톤 이름 → id, 없으면 사용 가능 목록을 담아 throw', async () => {
    expect(await resolveMilestoneId(client(), 'WP', 'v1.0')).toBe(7);
    await expect(resolveMilestoneId(client(), 'WP', 'v2')).rejects.toThrow('사용 가능: v1.0');
  });

  it('사이클 이름 배열 → id 배열, 하나라도 없으면 throw', async () => {
    expect(await resolveCycleIds(client(), 'WP', ['Sprint 4', 'Sprint 3'])).toEqual([31, 30]);
    await expect(resolveCycleIds(client(), 'WP', ['Sprint 3', 'Sprint 9'])).rejects.toThrow('Sprint 9');
  });
});
