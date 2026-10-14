import { describe, expect, it, vi } from 'vitest';
import {
  defaultListAssignee,
  fieldDefByName,
  resolveAssigneeIds,
  resolveCycleIds,
  resolveMilestoneId,
  resolveTypeId,
  rowByName,
  toFieldValue,
  ensureLabelIds,
  type CurrentUserClient,
  type LabelCreatorClient,
  type ProjectMetaClient,
} from './resolve.js';

/** 리졸브 소스만 채운 mock 클라이언트. 호출자(me)는 alice(10). */
function client(): ProjectMetaClient & CurrentUserClient {
  return {
    getMe: vi.fn().mockResolvedValue({ id: 10, username: 'alice' }),
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
    getProjectFields: vi.fn().mockResolvedValue([]),
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
  // WP-53: "나에게 할당해줘" — 'me' 는 호출자 본인(PAT 소유자 / X-On-Behalf-Of 신원)으로 해석한다.
  it("'me' 는 호출자 본인의 userId 로 변환한다", async () => {
    const c = client();
    await expect(resolveAssigneeIds(c, 'WP', ['me'])).resolves.toEqual([10]);
    expect(c.getMe).toHaveBeenCalledTimes(1);
  });
  it("'me' 는 대소문자·앞뒤 공백을 무시한다", async () => {
    await expect(resolveAssigneeIds(client(), 'WP', [' ME '])).resolves.toEqual([10]);
  });
  it("'me' 와 다른 username 을 섞어 쓸 수 있다", async () => {
    await expect(resolveAssigneeIds(client(), 'WP', ['bob', 'me'])).resolves.toEqual([11, 10]);
  });
  it("본인 username 과 'me' 를 함께 넘기면 중복 없이 한 번만 담는다", async () => {
    await expect(resolveAssigneeIds(client(), 'WP', ['alice', 'bob', 'me'])).resolves.toEqual([10, 11]);
  });
  it("'me' 가 없으면 호출자 조회를 하지 않는다", async () => {
    const c = client();
    await resolveAssigneeIds(c, 'WP', ['bob']);
    expect(c.getMe).not.toHaveBeenCalled();
  });
  it('호출자가 프로젝트 멤버가 아니면 본인 지정 불가 사유로 throw', async () => {
    const c = client();
    vi.mocked(c.getMe).mockResolvedValue({ id: 99, username: 'dave' });
    await expect(resolveAssigneeIds(c, 'WP', ['me'])).rejects.toThrow(
      "현재 사용자 'dave' 은(는) 프로젝트 WP 의 멤버가 아니라 담당자로 지정할 수 없습니다.",
    );
  });
});

// WP-394: 없는 라벨은 만들어 붙인다.
describe('ensureLabelIds', () => {
  /** 라벨 생성까지 되는 mock — 만든 라벨은 id 200 부터. */
  function creator(): ProjectMetaClient & CurrentUserClient & LabelCreatorClient {
    let next = 200;
    return { ...client(), createProjectMeta: vi.fn(async (_k: string, _kind: string, body: { name: string }) => ({ id: next++, name: body.name })) };
  }

  it('있는 라벨은 id 로 바꾸고 아무것도 만들지 않는다', async () => {
    const c = creator();
    await expect(ensureLabelIds(c, 'WP', ['backend', 'urgent'])).resolves.toEqual({ ids: [101, 100], created: [] });
    expect(c.createProjectMeta).not.toHaveBeenCalled();
  });

  it('없는 라벨은 회색으로 만들고 created 에 이름을 담는다', async () => {
    const c = creator();
    await expect(ensureLabelIds(c, 'WP', ['urgent', 'ai-fix'])).resolves.toEqual({ ids: [100, 200], created: ['ai-fix'] });
    expect(c.createProjectMeta).toHaveBeenCalledWith('WP', 'label', { name: 'ai-fix', colorToken: 'GRAY' });
  });

  it('공백을 빼고, 같은 호출 안의 중복은 한 번만 만든다', async () => {
    const c = creator();
    await expect(ensureLabelIds(c, 'WP', [' ai-fix ', 'ai-fix'])).resolves.toEqual({ ids: [200], created: ['ai-fix'] });
    expect(c.createProjectMeta).toHaveBeenCalledTimes(1);
  });

  it('대소문자가 다르면 다른 라벨이다(서버 유일 제약과 같은 기준)', async () => {
    const c = creator();
    await expect(ensureLabelIds(c, 'WP', ['Urgent'])).resolves.toEqual({ ids: [200], created: ['Urgent'] });
  });

  it('빈 이름·40자 초과면 아무것도 만들지 않고 throw', async () => {
    const c = creator();
    await expect(ensureLabelIds(c, 'WP', ['ai-fix', '  '])).rejects.toThrow('라벨 이름이 비어 있습니다.');
    await expect(ensureLabelIds(c, 'WP', ['ai-fix', 'x'.repeat(41)])).rejects.toThrow('40자 이하');
    expect(c.createProjectMeta).not.toHaveBeenCalled();
  });

  it('만드는 사이 누가 같은 이름을 만들었으면(409) 다시 읽어 그 라벨을 쓴다', async () => {
    const c = creator();
    vi.mocked(c.createProjectMeta).mockRejectedValueOnce(Object.assign(new Error('conflict'), { response: { status: 409 } }));
    vi.mocked(c.getProjectLabels)
      .mockResolvedValueOnce([{ id: 100, name: 'urgent' }])
      .mockResolvedValueOnce([{ id: 100, name: 'urgent' }, { id: 150, name: 'ai-fix' }]);
    await expect(ensureLabelIds(c, 'WP', ['ai-fix'])).resolves.toEqual({ ids: [150], created: [] });
  });

  it('만들기가 실패하고 다시 읽어도 없으면(권한 없음 등) 원래 오류를 그대로 던진다', async () => {
    const c = creator();
    const denied = Object.assign(new Error('forbidden'), { response: { status: 403 } });
    vi.mocked(c.createProjectMeta).mockRejectedValueOnce(denied);
    await expect(ensureLabelIds(c, 'WP', ['ai-fix'])).rejects.toBe(denied);
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
  it('WP-176: assignee="any"(대소문자 무시)면 담당자 조건 없음', () => {
    expect(defaultListAssignee({ assignee: ' Any ' })).toBeUndefined();
  });
  it('assignee 가 있으면 그대로', () => {
    expect(defaultListAssignee({ assignee: 'kim', reporter: 'me' })).toBe('kim');
  });
  it('WP-356: watching·parent 가 있으면 담당자 기본값을 붙이지 않는다(명시한 assignee 는 유지)', () => {
    expect(defaultListAssignee({ watching: true })).toBeUndefined();
    expect(defaultListAssignee({ parent: 'WP-1' })).toBeUndefined();
    expect(defaultListAssignee({ watching: false })).toBe('me');
    expect(defaultListAssignee({ watching: true, assignee: 'me' })).toBe('me');
  });
});

describe('커스텀 필드 값 (WP-356)', () => {
  const defs = [
    { id: 1, name: '메모', type: 'TEXT' },
    { id: 2, name: '견적', type: 'NUMBER' },
    { id: 3, name: '기한', type: 'DATE' },
    { id: 4, name: '단계', type: 'SELECT', options: ['기획', '개발'] },
    { id: 5, name: '태그', type: 'MULTI_SELECT', options: ['a', 'b'] },
  ];
  it('이름으로 정의를 찾고, 없으면 사용 가능 이름을 담아 throw', () => {
    expect(fieldDefByName(defs, '견적').id).toBe(2);
    expect(() => fieldDefByName(defs, '없음')).toThrow('사용 가능: 메모, 견적, 기한, 단계, 태그');
  });
  it('유형별로 값을 맞추고 어긋나면 throw(숫자 문자열은 숫자로, 단일 값 MULTI_SELECT 는 배열로)', () => {
    expect(toFieldValue(defs[0], 12)).toBe('12');
    expect(toFieldValue(defs[1], '3.5')).toBe(3.5);
    expect(() => toFieldValue(defs[1], 'x')).toThrow('숫자');
    expect(toFieldValue(defs[2], '2026-10-13')).toBe('2026-10-13');
    expect(() => toFieldValue(defs[2], '10/13')).toThrow('날짜');
    expect(toFieldValue(defs[3], '개발')).toBe('개발');
    expect(() => toFieldValue(defs[3], '운영')).toThrow('사용 가능: 기획, 개발');
    expect(toFieldValue(defs[4], 'a')).toEqual(['a']);
    expect(() => toFieldValue(defs[4], ['a', 'z'])).toThrow('사용 가능: a, b');
  });
  it('rowByName 은 행 전체를 돌려주고 없으면 같은 문구로 throw', () => {
    expect(rowByName([{ id: 1, name: 'x', color: 'RED' }], 'x', '라벨')).toEqual({ id: 1, name: 'x', color: 'RED' });
    expect(() => rowByName([{ id: 1, name: 'x' }], 'y', '라벨')).toThrow("라벨 'y' 을(를) 찾을 수 없습니다. 사용 가능: x");
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
