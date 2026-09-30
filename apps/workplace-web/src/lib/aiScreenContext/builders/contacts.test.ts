// 연락처 화면 컨텍스트 builder 단위 테스트(WP-54).
import { describe, expect, it } from 'vitest';

import { buildContactsContext } from './contacts';

const base = { q: '', type: 'ALL' as const, organization: null, title: null, groupId: null, groupName: null, count: 10, hasMore: false, selected: null };

describe('buildContactsContext', () => {
  it('필터·건수', () => {
    expect(buildContactsContext({ ...base, q: '김', type: 'EXTERNAL', organization: '에이사' })).toEqual({
      view: '연락처',
      scope: { label: '연락처', facts: [{ label: '검색어', value: '김' }, { label: '유형', value: '외부' }, { label: '소속', value: '에이사' }], count: 10, hasMore: false },
    });
  });
  it('목록 미로드(count 없음)면 건수·hasMore 를 보내지 않는다', () => {
    const scope = buildContactsContext({ ...base, count: undefined, hasMore: undefined }).scope!;
    expect(scope).not.toHaveProperty('count');
    expect(scope).not.toHaveProperty('hasMore');
  });
  it('그룹 — groupId refs', () => {
    expect(buildContactsContext({ ...base, groupId: 6, groupName: '영업팀' }).scope).toMatchObject({ refs: { groupId: '6' }, facts: [{ label: '그룹', value: '영업팀' }] });
  });
  it('구성원 선택 — username refs(get_member_contact 인자)', () => {
    const ctx = buildContactsContext({ ...base, selected: { type: 'MEMBER', id: 1, name: '양동희', username: 'dh', organization: 'IA', title: '팀장', email: 'dh@x.com' } });
    expect(ctx.focus).toEqual({
      type: '연락처',
      label: '양동희',
      refs: { username: 'dh' },
      facts: [{ label: '구분', value: '구성원' }, { label: '소속', value: 'IA' }, { label: '직함', value: '팀장' }, { label: '이메일', value: 'dh@x.com' }],
    });
  });
  it('외부 연락처 — externalId refs', () => {
    const ctx = buildContactsContext({ ...base, selected: { type: 'EXTERNAL', id: 55, name: '김철수', username: null, organization: null, title: null, email: null } });
    expect(ctx.focus).toEqual({ type: '연락처', label: '김철수', refs: { externalId: '55' }, facts: [{ label: '구분', value: '외부' }] });
  });
  it('구성원인데 username 미로딩이면 refs 비움(틀린 id 를 보내지 않음)', () => {
    const ctx = buildContactsContext({ ...base, selected: { type: 'MEMBER', id: 1, name: '양동희', username: null, organization: null, title: null, email: null } });
    expect(ctx.focus!.refs).toEqual({});
  });
});
