import { describe, expect, it, vi } from 'vitest';
import { resolveAssigneeIds, resolveLabelIds, resolveTypeId, type ProjectMetaClient } from './resolve.js';

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
