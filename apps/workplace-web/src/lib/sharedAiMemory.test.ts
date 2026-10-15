// WP-386 공용 메모리 화면 로직 — 공간 쿼리 값, 행 메타(발화자 이름 없음), 기록 화면 모델(출처 대화 없음), 화면 맥락 → 채팅 공간.
import { describe, expect, it } from 'vitest';

import { CHANGE_UNDO_REFUSED_MESSAGE } from '@/components/ai/memoryChangeLogEntry';
import type { SharedAiMemoryChange, SharedAiMemoryItem, SharedMemorySpace } from '@/types/sharedAiMemory';

import {
  filterSpaces,
  historyIntro,
  parseSpaceParam,
  sameSpace,
  SHARED_UNDO_ERROR,
  sharedMemoryHref,
  sharedRowMeta,
  SPACE_GROUPS,
  spaceHint,
  spaceLabel,
  spaceOfScreenContext,
  spaceParam,
  toSharedChangeLogEntry,
} from './sharedAiMemory';

const space = (over: Partial<SharedMemorySpace>): SharedMemorySpace => ({
  type: 'PROJECT', id: 12, key: 'WP', name: 'Smart Workplace', label: 'Smart Workplace(WP)', count: 3, limit: 50, canAdd: true, canManage: false, ...over,
});
const item = (over: Partial<SharedAiMemoryItem>): SharedAiMemoryItem => ({
  id: 1, content: '배포는 API 먼저 한다', origin: 'USER_ADDED', createdAt: '2026-10-14T03:00:00Z', updatedAt: '2026-10-14T03:00:00Z', canEdit: false, ...over,
});
const snap = (id: number, content: string, origin: SharedAiMemoryItem['origin'] = 'AI_EXTRACTED') => ({ id, content, origin });
const change = (over: Partial<SharedAiMemoryChange>): SharedAiMemoryChange => ({
  id: 7, action: 'ADDED', actor: { kind: 'AI' }, createdAt: '2026-10-15T02:00:00Z', memory: null, before: [], undoneAt: null, undoable: true, ...over,
});

describe('공간 쿼리 값', () => {
  it('ORG · PROJECT:12 · WIKI_SPACE:3 왕복, 틀린 값은 null', () => {
    expect(spaceParam({ type: 'ORG', id: null })).toBe('ORG');
    expect(spaceParam({ type: 'PROJECT', id: 12 })).toBe('PROJECT:12');
    expect(parseSpaceParam('WIKI_SPACE:3')).toEqual({ type: 'WIKI_SPACE', id: 3 });
    expect(parseSpaceParam('ORG')).toEqual({ type: 'ORG', id: null });
    for (const bad of [null, '', 'PROJECT', 'PROJECT:x', 'PROJECT:0', 'TEAM:1', 'ORG:1']) expect(parseSpaceParam(bad)).toBeNull();
    expect(sameSpace({ type: 'PROJECT', id: 12 }, space({}))).toBe(true);
    expect(sameSpace({ type: 'PROJECT', id: 13 }, space({}))).toBe(false);
  });
  it('설정 링크는 공용 탭 + 공간', () => {
    expect(sharedMemoryHref({ type: 'PROJECT', id: 12 })).toBe('/settings/assistant?memoryTab=shared&space=PROJECT%3A12');
  });
  it('공간 검색은 이름·라벨·키를 대소문자 없이', () => {
    const list = [space({}), space({ type: 'WIKI_SPACE', id: 3, key: null, name: '개발팀 노트', label: '개발팀 노트' })];
    expect(filterSpaces(list, 'wp').map((s) => s.label)).toEqual(['Smart Workplace(WP)']);
    expect(filterSpaces(list, ' 노트 ').map((s) => s.label)).toEqual(['개발팀 노트']);
    expect(filterSpaces(list, '')).toHaveLength(2);
  });
});

describe('안내 문구', () => {
  it('조직은 관리자만 바꾼다, 공간은 권한에 따라', () => {
    expect(spaceHint(space({ type: 'ORG', id: null, canManage: true }))).toContain('관리자만 쓰고 고칠 수 있고, AI는 바꾸지 않아요');
    expect(spaceHint(space({ type: 'ORG', id: null, canManage: false, canAdd: false }))).toContain('관리자만 바꿀 수 있어요');
    expect(spaceHint(space({ canManage: true }))).toContain('모든 항목을 고치고 지울 수 있어요');
    expect(spaceHint(space({ canManage: false }))).toContain('내가 추가했거나 요청한 항목만');
    expect(spaceHint(space({}))).toContain('팀 모두에게 적용되는 규칙만 적어 주세요');
    expect(historyIntro(space({ canManage: true }))).toContain('항목마다 되돌릴 수 있어요');
    expect(historyIntro(space({ canManage: false }))).toContain('내가 추가했거나 요청한 항목은 되돌릴 수 있어요');
  });
});

describe('sharedRowMeta', () => {
  it('요청·직접 추가는 이름, AI 정리·대화에서 기억은 이름 없음', () => {
    expect(sharedRowMeta(item({ origin: 'USER_REQUESTED', author: { name: '김철수' } }))).toBe('김철수 요청');
    expect(sharedRowMeta(item({ origin: 'USER_ADDED', author: { name: '이영희' } }))).toBe('이영희 직접 추가');
    expect(sharedRowMeta(item({ origin: 'USER_ADDED' }))).toBe('직접 추가');
    expect(sharedRowMeta(item({ origin: 'AI_CLEANED' }))).toBe('AI가 정리');
    // 서버가 실수로 author 를 실어도 대화에서 뽑힌 항목에는 이름을 붙이지 않는다(발화자 추적 금지).
    expect(sharedRowMeta(item({ origin: 'AI_EXTRACTED', author: { name: '김철수' } }))).toBe('대화에서 AI가 기억');
  });
});

describe('spaceLabel·SPACE_GROUPS (시안 v2 조직 이름)', () => {
  it('조직 묶음 소제목은 「조직」, 그 안의 공간 이름은 「조직 지침」, 나머지는 API label', () => {
    expect(SPACE_GROUPS.find((g) => g.type === 'ORG')?.label).toBe('조직');
    expect(spaceLabel({ type: 'ORG', label: '조직' })).toBe('조직 지침');
    expect(spaceLabel({ type: 'PROJECT', label: 'Smart Workplace(WP)' })).toBe('Smart Workplace(WP)');
  });
  it('공간 검색은 「조직 지침」으로도 조직을 찾는다', () => {
    const org = { type: 'ORG', id: null, key: null, name: '조직', label: '조직', count: 0, limit: 30, canAdd: false, canManage: false } as const;
    expect(filterSpaces([org], '지침')).toHaveLength(1);
  });
});

describe('toSharedChangeLogEntry', () => {
  it('ADDED — 직접 추가/새로 기억함, 행위자 이름 또는 AI', () => {
    const e = toSharedChangeLogEntry(change({ memory: snap(5, '배포는 API 먼저 한다') }));
    expect(e).toMatchObject({ id: 7, icon: 'ADDED', label: '새로 기억함', actor: 'AI', content: '배포는 API 먼저 한다', removed: false, before: [], undoable: true });
    const byUser = toSharedChangeLogEntry(change({ actor: { kind: 'USER', name: '이영희' }, memory: snap(5, 'x', 'USER_ADDED') }));
    expect(byUser).toMatchObject({ label: '직접 추가함', actor: '이영희' });
  });
  it('MERGED — 합침(개수 없음), 합치기 전 원본들', () => {
    const e = toSharedChangeLogEntry(change({ action: 'MERGED', memory: snap(5, '합친 문장', 'AI_CLEANED'), before: [snap(5, 'a'), snap(6, 'b')] }));
    expect(e).toMatchObject({ icon: 'MERGED', label: '합침', before: ['a', 'b'], beforeLabel: '합치기 전' });
  });
  it('UPDATED 고침 · DELETED 지움(취소선) · RESTORED 되돌림', () => {
    expect(toSharedChangeLogEntry(change({ action: 'UPDATED', memory: snap(5, '새'), before: [snap(5, '옛')] }))).toMatchObject({ label: '고침', before: ['옛'], beforeLabel: '이전' });
    expect(toSharedChangeLogEntry(change({ action: 'DELETED', before: [snap(5, '지운 것')] }))).toMatchObject({ icon: 'DELETED', label: '지움', content: '지운 것', removed: true, before: [] });
    expect(toSharedChangeLogEntry(change({ action: 'RESTORED', memory: snap(5, '되살린 것'), undoable: false }))).toMatchObject({ icon: 'RESTORED', label: '되돌림', undoable: false });
  });
  it('출처 대화(source)는 어떤 경우에도 싣지 않는다(발화자 추적 금지)', () => {
    for (const action of ['ADDED', 'UPDATED', 'MERGED', 'DELETED', 'RESTORED'] as const) {
      const e = toSharedChangeLogEntry(change({ action, memory: snap(5, 'x'), before: [snap(5, 'y')] }));
      expect(e).not.toHaveProperty('source');
    }
  });
});

describe('spaceOfScreenContext', () => {
  it('프로젝트 키가 있으면 프로젝트(범위 refs 우선, 대상 refs 도)', () => {
    expect(spaceOfScreenContext({ view: '이슈 상세', app: 'ISSUE', scope: { label: '프로젝트 WP', refs: { projectKey: 'WP' } } })).toEqual({ type: 'PROJECT', key: 'WP' });
    expect(spaceOfScreenContext({ view: '프로젝트', focus: { type: '프로젝트', label: 'x', refs: { projectKey: 'AB' } } })).toEqual({ type: 'PROJECT', key: 'AB' });
  });
  it('노트 화면의 spaceId 는 노트 스페이스, 드라이브의 spaceId 는 아니다', () => {
    expect(spaceOfScreenContext({ view: '위키', app: 'WIKI', scope: { label: '위키 스페이스 개발', refs: { spaceId: '2' } } })).toEqual({ type: 'WIKI_SPACE', id: 2 });
    expect(spaceOfScreenContext({ view: '드라이브', app: 'DRIVE', scope: { label: '드라이브', refs: { spaceId: '4' } } })).toBeNull();
    expect(spaceOfScreenContext({ view: '위키', app: 'WIKI', scope: { label: 'x', refs: { spaceId: 'abc' } } })).toBeNull();
  });
  it('공간이 없는 화면·화면 맥락 없음은 null', () => {
    expect(spaceOfScreenContext({ view: '메일함', app: 'MAIL' })).toBeNull();
    expect(spaceOfScreenContext(null)).toBeNull();
  });
});

describe('SHARED_UNDO_ERROR', () => {
  it('CHANGED 는 개인 기록 되돌리기와 같은 문구 상수를 쓴다', () => {
    expect(SHARED_UNDO_ERROR.SHARED_MEMORY_CHANGED).toBe(CHANGE_UNDO_REFUSED_MESSAGE);
    expect(SHARED_UNDO_ERROR.SHARED_MEMORY_CHANGE_UNDONE).toBe('이미 되돌린 기록이에요');
    expect(SHARED_UNDO_ERROR.SHARED_MEMORY_NOT_FOUND).toBe('이 기록은 더 이상 되돌릴 수 없어요');
  });
});
