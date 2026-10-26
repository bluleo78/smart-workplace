import { describe, expect, it, vi } from 'vitest';
import {
  defaultListAssignee,
  fieldDefByName,
  resolveAssigneeIds,
  resolveCycleIds,
  resolveMilestoneId,
  resolveRelationType,
  resolveTypeId,
  rowByName,
  toFieldValue,
  splitLabelNames,
  resolveComponentNames,
  resolveComponentIds,
  resolveVersionNames,
  resolveVersionIds,
  splitStatusTokens,
  resolveStatusPatch,
  type CurrentUserClient,
  type ProjectMetaClient,
} from './resolve.js';
import type { IssueRelationTypeRow } from './tool-client.js';

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
    getProjectComponents: vi.fn().mockResolvedValue([]),
    getProjectVersions: vi.fn().mockResolvedValue([]),
    getProjectMilestones: vi.fn().mockResolvedValue([{ id: 7, name: 'v1.0' }]),
    getProjectCycles: vi.fn().mockResolvedValue([
      { id: 30, name: 'Sprint 3', status: 'ACTIVE' },
      { id: 31, name: 'Sprint 4', status: 'PLANNED' },
    ]),
    getProjectFields: vi.fn().mockResolvedValue([]),
    getProjectStatuses: vi.fn().mockResolvedValue([
      { id: 10, name: '할 일', category: 'TODO', position: 0 },
      { id: 11, name: '진행 중', category: 'IN_PROGRESS', position: 1 },
      { id: 12, name: '검토 중', category: 'IN_PROGRESS', position: 2 },
    ]),
  };
}

describe('splitStatusTokens (WP-807)', () => {
  it('splitStatusTokens: 범주와 이름을 나눈다', () => {
    expect(splitStatusTokens('done, 검토 중 ,IN_PROGRESS')).toEqual({ categories: ['DONE', 'IN_PROGRESS'], names: ['검토 중'] });
  });
  it('빈 토큰은 버린다', () => {
    expect(splitStatusTokens(' , TODO,,')).toEqual({ categories: ['TODO'], names: [] });
  });
});

describe('resolveStatusPatch (WP-870)', () => {
  it('범주 값은 대소문자·공백을 무시하고 { status } 로 바꾼다', () => {
    expect(resolveStatusPatch('DONE')).toEqual({ status: 'DONE' });
    expect(resolveStatusPatch(' done ')).toEqual({ status: 'DONE' });
  });
  it('그 밖의 값은 상태 이름으로 보고 trim 해 { statusName } 으로 보낸다 — 목록 조회 없이 서버가 해석한다', () => {
    expect(resolveStatusPatch('  검토 중 ')).toEqual({ statusName: '검토 중' });
  });
});

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

// WP-394: 있는 라벨은 id, 없는 라벨은 이름(서버가 만든다)으로 나눈다.
describe('splitLabelNames', () => {
  const existing = [{ id: 100, name: 'urgent' }, { id: 101, name: 'backend' }];

  it('공백을 빼고 중복을 하나로, 있는 라벨은 ids·없는 라벨은 created', () => {
    expect(splitLabelNames([' urgent ', 'ai-fix', 'ai-fix', 'backend'], existing)).toEqual({ ids: [100, 101], created: ['ai-fix'] });
  });

  // WP-911: 서버 유일 제약이 lower(name) 이라 대소문자만 다른 이름은 같은 라벨이다.
  it('대소문자만 다르면 있는 라벨을 쓰고, 함께 준 대소문자 변형은 하나로 친다', () => {
    expect(splitLabelNames(['Urgent'], existing)).toEqual({ ids: [100], created: [] });
    expect(splitLabelNames(['New', 'new', 'NEW'], existing)).toEqual({ ids: [], created: ['New'] });
  });

  it('빈 이름·40자 초과면 throw', () => {
    expect(() => splitLabelNames(['ai-fix', '  '], existing)).toThrow('라벨 이름이 비어 있습니다.');
    expect(() => splitLabelNames(['x'.repeat(41)], existing)).toThrow('40자 이하');
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

// WP-887: 관계 유형 입력 — 코드 정확 일치 → 이름(대소문자 무시) → 코드(대소문자 무시) 순.
describe('resolveRelationType', () => {
  const row = (id: number, code: string | null, name: string, hidden = false): IssueRelationTypeRow => ({
    id,
    code,
    name,
    directed: false,
    outwardLabel: name,
    inwardLabel: null,
    externalOnly: false,
    hidden,
  } as IssueRelationTypeRow);
  const types = [row(1, 'RELATES', '관련'), row(2, 'CAUSES', '원인'), row(3, null, 'Follows'), row(4, null, 'relates'), row(5, null, '감춤', true)];

  it('코드는 정확히 같으면 이름보다 먼저 — RELATES 는 기본 유형', () => {
    expect(resolveRelationType(types, ' RELATES ').id).toBe(1);
  });

  it('이름은 대소문자를 가리지 않는다(서버·가져오기와 같은 규칙)', () => {
    expect(resolveRelationType(types, 'follows').id).toBe(3);
    expect(resolveRelationType(types, 'FOLLOWS').id).toBe(3);
    expect(resolveRelationType(types, '원인').id).toBe(2);
  });

  it('코드와 철자만 같은 사용자 정의 이름도 정확한 이름으로 닿는다 — 이름이 대소문자 무시 코드보다 앞', () => {
    expect(resolveRelationType(types, 'relates').id).toBe(4);
    expect(resolveRelationType(types, 'Relates').id).toBe(4);
  });

  it('겹치는 이름이 없으면 소문자 코드도 받아 준다', () => {
    expect(resolveRelationType(types, 'causes').id).toBe(2);
  });

  it('없는 유형은 사용 가능 목록과 함께, 숨긴 유형은 새로 걸 수 없다고 거절한다', () => {
    expect(() => resolveRelationType(types, '없음')).toThrow('사용 가능: RELATES, CAUSES, Follows, relates');
    expect(() => resolveRelationType(types, '감춤')).toThrow('숨겨져');
  });
});

describe('resolveComponentNames (WP-933)', () => {
  const existing = [
    { id: 1, name: 'Compute' },
    { id: 2, name: 'Storage' },
    { id: 3, name: '옛 구성요소', archived: true },
  ];

  it('대소문자·앞뒤 공백을 무시하고 같은 이름은 하나로 쳐 id 로 바꾼다', () => {
    expect(resolveComponentNames([' compute ', 'COMPUTE', 'Storage'], existing)).toEqual({ ids: [1, 2], unknown: [], archived: [] });
  });

  it('분해형(NFD) 한글 이름도 NFC 로 저장된 구성요소와 같은 것으로 맞춘다', () => {
    const korean = [{ id: 7, name: '컴퓨트'.normalize('NFC') }];
    const nfd = '컴퓨트'.normalize('NFD');
    expect(nfd).not.toBe('컴퓨트');
    expect(resolveComponentNames([` ${nfd} `, '컴퓨트'], korean)).toEqual({ ids: [7], unknown: [], archived: [] });
  });

  it('없는 이름은 unknown, 보관된 이름은 archived 로 따로 알린다(id 에는 넣지 않는다)', () => {
    expect(resolveComponentNames(['Compute', 'Nope', '옛 구성요소'], existing)).toEqual({ ids: [1], unknown: ['Nope'], archived: ['옛 구성요소'] });
  });

  it('resolveComponentIds 는 없는 이름이면 쓸 수 있는(보관 안 된) 목록을 담아 throw 한다', () => {
    expect(() => resolveComponentIds(['Nope'], existing)).toThrow("구성요소 'Nope' 을(를) 찾을 수 없습니다. 사용 가능: Compute, Storage");
  });

  it('resolveComponentIds 는 보관된 이름이면 새로 붙일 수 없다고 throw 한다', () => {
    expect(() => resolveComponentIds(['옛 구성요소'], existing)).toThrow('보관');
  });

  it('resolveComponentIds 는 allowArchivedIds 에 든 보관 구성요소는 통과시킨다(이미 붙어 있던 것 유지)', () => {
    expect(resolveComponentIds(['Compute', '옛 구성요소'], existing, new Set([3]))).toEqual([1, 3]);
  });

  it('빈 이름이면 throw 한다', () => {
    expect(() => resolveComponentIds([' '], existing)).toThrow('구성요소 이름이 비어 있습니다.');
  });
});

describe('resolveVersionNames (WP-888)', () => {
  const existing = [
    { id: 1, name: 'v1.0', status: 'UNRELEASED' },
    { id: 2, name: 'v0.9', status: 'RELEASED' },
    { id: 3, name: 'v0.1', status: 'ARCHIVED' },
  ];

  it('대소문자·공백을 무시하고 같은 이름은 하나로 쳐 id 로 바꾼다(출시된 버전도 붙일 수 있다)', () => {
    expect(resolveVersionNames([' V1.0 ', 'v1.0', 'v0.9'], existing)).toEqual({ ids: [1, 2], unknown: [], archived: [] });
  });

  it('없는 이름은 unknown, 보관(status=ARCHIVED)은 archived 로 따로 알린다', () => {
    expect(resolveVersionNames(['v1.0', 'v9', 'v0.1'], existing)).toEqual({ ids: [1], unknown: ['v9'], archived: ['v0.1'] });
  });

  it('allowArchivedIds 에 든 보관 버전은 통과시킨다', () => {
    expect(resolveVersionNames(['v0.1'], existing, { allowArchivedIds: new Set([3]) })).toEqual({ ids: [3], unknown: [], archived: [] });
  });

  it('resolveVersionIds 는 없는 이름이면 보관 아닌 목록을, 보관이면 새로 붙일 수 없다고 throw 한다', () => {
    expect(() => resolveVersionIds(['v9'], existing)).toThrow("버전 'v9' 을(를) 찾을 수 없습니다. 사용 가능: v1.0, v0.9");
    expect(() => resolveVersionIds(['v0.1'], existing)).toThrow('보관');
    expect(resolveVersionIds(['v0.1'], existing, new Set([3]))).toEqual([3]);
  });

  it('빈 이름이면 구성요소 문구 없이 throw 한다', () => {
    expect(() => resolveVersionIds([' '], existing)).toThrow('버전 이름이 비어 있습니다.');
  });
});
