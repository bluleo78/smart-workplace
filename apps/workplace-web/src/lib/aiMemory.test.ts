import { AxiosError, AxiosHeaders } from 'axios';
import { describe, expect, it } from 'vitest';

import type { AiMemoryItem } from '@/types/aiMemory';

import {
  canSubmitContent,
  contentCountTone,
  defaultAddScope,
  expiryPatch,
  expiryQuickPicks,
  extractApiErrorScope,
  fullScopeKeys,
  groupMemories,
  listCountTone,
  matchesMemoryQuery,
  MEMORY_LIMIT,
  memoryActionText,
  memoryBlockActionText,
  memoryErrorMessage,
  memoryFullMessage,
  memoryLength,
  memoryNoun,
  PIN_LIMIT,
  pinFullHint,
  pinnedCount,
  purgeDateKey,
  ROWS_PAGE,
  SCOPE_LABEL,
  scopeDescription,
  scopeKeyOf,
  UNDO_FULL_MESSAGE,
  visibleGroups,
  wasExpiredAtUndo,
} from './aiMemory';

/** 서버 ErrorResponse 를 실은 axios 오류. */
function apiError(status: number, data: unknown): AxiosError {
  const headers = new AxiosHeaders();
  return new AxiosError('fail', 'ERR_BAD_REQUEST', { headers }, null, {
    status, statusText: '', headers, config: { headers }, data,
  });
}

// Review Focus 3: 서버(코드포인트 300)와 같은 기준 — 이모지 한 개는 한 글자, 자르지 않고 막기만 한다.
describe('메모리 길이·카운트 (WP-55)', () => {
  it('앞뒤 공백을 지운 코드포인트 수', () => {
    expect(memoryLength('  가나 ')).toBe(2);
    expect(memoryLength('😀'.repeat(300))).toBe(300);
    expect('😀'.repeat(300).length).toBe(600); // UTF-16 길이와 다르다(전제)
  });
  it('1~300 자만 저장할 수 있다', () => {
    expect(canSubmitContent('')).toBe(false);
    expect(canSubmitContent('   ')).toBe(false);
    expect(canSubmitContent('😀'.repeat(300))).toBe(true);
    expect(canSubmitContent('😀'.repeat(301))).toBe(false);
  });
  it('내용 카운트는 300 초과면 빨강, 목록 카운트는 270 부터 주황(범위마다 300, WP-383)', () => {
    expect(contentCountTone(300)).toBe('text-muted-foreground');
    expect(contentCountTone(301)).toBe('text-destructive');
    expect(listCountTone(44)).toBe('text-muted-foreground');
    expect(listCountTone(269)).toBe('text-muted-foreground');
    expect(listCountTone(270)).toBe('text-warning-text');
    expect(listCountTone(MEMORY_LIMIT)).toBe('text-warning-text');
  });
  it('메모리 오류는 서버 문구, 그 밖은 fallback', () => {
    expect(memoryErrorMessage(apiError(409, { message: '메모리가 가득 찼어요(최대 50개)', errors: { code: 'AI_MEMORY_FULL' } }), 'f')).toBe(
      '메모리가 가득 찼어요(최대 50개)',
    );
    expect(memoryErrorMessage(new Error('x'), '추가하지 못했어요')).toBe('추가하지 못했어요');
  });
});

describe('메모리 범위 (WP-379)', () => {
  it('범위 키·이름 — null·없음은 공통', () => {
    expect(scopeKeyOf(null)).toBe('COMMON');
    expect(scopeKeyOf(undefined)).toBe('COMMON');
    expect(scopeKeyOf('MAIL')).toBe('MAIL');
    expect(SCOPE_LABEL.COMMON).toBe('공통');
    expect(SCOPE_LABEL.WIKI).toBe('노트');
    expect(SCOPE_LABEL.MESSAGING).toBe('메신저');
  });

  it('결과 줄 명사 — 앱이면 "이슈 메모리", 공통이면 "메모리"', () => {
    expect(memoryNoun('ISSUE')).toBe('이슈 메모리');
    expect(memoryNoun(undefined)).toBe('메모리');
  });

  it('가득 참 문구 — 앱 범위면 그 범위 이름, 공통·모름이면 기존 문구', () => {
    expect(memoryFullMessage('ISSUE')).toBe('이슈 메모리가 가득 찼어요. 설정에서 정리해 주세요');
    expect(memoryFullMessage('COMMON')).toBe(UNDO_FULL_MESSAGE);
    expect(memoryFullMessage(null)).toBe(UNDO_FULL_MESSAGE);
    expect(memoryFullMessage('CONTACTS')).toBe(UNDO_FULL_MESSAGE);
  });

  it('409 응답의 errors.scope 를 읽는다(없으면 null)', () => {
    expect(extractApiErrorScope(apiError(409, { message: 'x', errors: { code: 'AI_MEMORY_FULL', scope: 'MAIL' } }))).toBe('MAIL');
    expect(extractApiErrorScope(apiError(409, { message: 'x', errors: { code: 'AI_MEMORY_FULL' } }))).toBeNull();
    expect(extractApiErrorScope(new Error('x'))).toBeNull();
  });
});

const mem = (id: number, scope: AiMemoryItem['scope'] = null): AiMemoryItem => ({
  id,
  kind: 'PREFERENCE',
  content: `m${id}`,
  source: 'AI',
  createdAt: '2026-10-10T00:00:00Z',
  updatedAt: '2026-10-10T00:00:00Z',
  scope,
});

describe('설정 묶음 (WP-379)', () => {
  it('범위 순서(공통 → 이슈 → 노트 → 메일 → 드라이브 → 메신저 → 캘린더)로 묶고 빈 범위는 뺀다 — 묶음 안은 받은 순서(최신순) 그대로', () => {
    const groups = groupMemories([mem(9, 'MAIL'), mem(8), mem(7, 'ISSUE'), mem(6), mem(5, 'MAIL'), mem(4, undefined)]);
    expect(groups.map((g) => g.key)).toEqual(['COMMON', 'ISSUE', 'MAIL']);
    expect(groups.map((g) => g.label)).toEqual(['공통', '이슈', '메일']);
    expect(groups[0].active.map((m) => m.id)).toEqual([8, 6, 4]);
    expect(groups[2].active.map((m) => m.id)).toEqual([9, 5]);
    expect(groups.every((g) => g.expired.length === 0)).toBe(true);
  });

  it('모르는 범위 값(신 서버)은 묶음에서 뺀다', () => {
    const unknown = { ...mem(3), scope: 'NEWAPP' as unknown as AiMemoryItem['scope'] };
    expect(groupMemories([unknown, mem(2)]).map((g) => [g.key, g.active.length])).toEqual([['COMMON', 1]]);
  });

  it('가득 찬 범위 — 묶음의 유효 행 수가 한도 이상', () => {
    const groups = groupMemories([...Array.from({ length: 50 }, (_, i) => mem(i + 1)), mem(100, 'ISSUE')]);
    expect([...fullScopeKeys(groups, 50)]).toEqual(['COMMON']);
  });

  it('직접 추가 기본 범위 — 공통, 공통이 가득이면 첫 빈 앱 범위, 모두 가득이면 null', () => {
    expect(defaultAddScope(new Set())).toBe('COMMON');
    expect(defaultAddScope(new Set(['COMMON', 'ISSUE']))).toBe('WIKI');
    expect(defaultAddScope(new Set(['COMMON', 'ISSUE', 'WIKI', 'MAIL', 'DRIVE', 'MESSAGING', 'CALENDAR']))).toBeNull();
  });

  it('묶음 설명', () => {
    expect(scopeDescription('COMMON')).toBe('모든 AI 대화에 반영돼요');
    expect(scopeDescription('DRIVE')).toBe('드라이브 화면의 AI 대화에만 반영돼요');
  });
});

describe('기한 (WP-380)', () => {
  it('만료 행은 묶음 끝으로 — 한도 계산(active)에서 빠진다', () => {
    const rows = [
      { ...mem(5), expired: true, expiresOn: '2026-10-10' },
      { ...mem(4), expiresOn: '2026-10-24', expired: false },
      mem(3),
    ];
    const [g] = groupMemories(rows);
    expect(g.active.map((m) => m.id)).toEqual([4, 3]);
    expect(g.expired.map((m) => m.id)).toEqual([5]);
    expect(fullScopeKeys([g], 2).has('COMMON')).toBe(true);
    expect(fullScopeKeys([g], 3).has('COMMON')).toBe(false);
  });

  it('만료 행만 있는 범위도 묶음을 보인다', () => {
    expect(groupMemories([{ ...mem(1, 'MAIL'), expired: true, expiresOn: '2026-10-01' }]).map((g) => g.key)).toEqual(['MAIL']);
  });

  it('자동 삭제일 = 기한 + 31일(10/10 → 11/10)', () => {
    expect(purgeDateKey('2026-10-10')).toBe('2026-11-10');
    expect(purgeDateKey('2026-12-15')).toBe('2027-01-15');
  });

  it('빠른 선택 — 기한 없음(편집·추가만)·다음 주·한 달 뒤', () => {
    expect(expiryQuickPicks('2026-10-14', true)).toEqual([
      { key: 'none', label: '기한 없음', value: null },
      { key: 'next-week', label: '다음 주', value: '2026-10-21' },
      { key: 'next-month', label: '한 달 뒤', value: '2026-11-14' },
    ]);
    expect(expiryQuickPicks('2026-01-31', false).map((q) => q.value)).toEqual(['2026-02-07', '2026-02-28']);
  });

  it('기한 바꾸기 본문 — 같으면 없음, 지정이면 expiresOn, 없애면 clearExpiry', () => {
    expect(expiryPatch('2026-10-24', '2026-10-24')).toEqual({});
    expect(expiryPatch(null, '2026-10-24')).toEqual({ expiresOn: '2026-10-24' });
    expect(expiryPatch('2026-10-24', null)).toEqual({ clearExpiry: true });
  });
});

describe('설정 지움 되돌리기의 기한 판정 (WP-380)', () => {
  it('되돌리기를 누른 날(KST)보다 기한이 앞서면 지난 것 — 다시 만들지 않는다', () => {
    expect(wasExpiredAtUndo('2026-10-13', '2026-10-14')).toBe(true);
  });

  it('기한 당일·이후·기한 없음은 되돌릴 수 있다', () => {
    expect(wasExpiredAtUndo('2026-10-14', '2026-10-14')).toBe(false);
    expect(wasExpiredAtUndo('2026-10-20', '2026-10-14')).toBe(false);
    expect(wasExpiredAtUndo(null, '2026-10-14')).toBe(false);
    expect(wasExpiredAtUndo(undefined, '2026-10-14')).toBe(false);
  });
});

describe('고정·검색·인피니트 스크롤 (WP-383)', () => {
  const pinned = (id: number, scope: AiMemoryItem['scope'] = null): AiMemoryItem => ({ ...mem(id, scope), pinned: true });

  it('묶음 안에서 고정 행이 맨 위 — 고정끼리·나머지끼리는 받은 최신순 그대로', () => {
    const groups = groupMemories([mem(9), pinned(8), mem(7), pinned(6)]);
    expect(groups[0].active.map((m) => m.id)).toEqual([8, 6, 9, 7]);
  });

  it('고정 수는 만료 행도 센다(서버 상한과 같은 기준)', () => {
    const expiredPinned = { ...pinned(5), expired: true, expiresOn: '2026-10-01' };
    const [g] = groupMemories([pinned(9), mem(8), expiredPinned]);
    expect(pinnedCount(g)).toBe(2);
    expect(PIN_LIMIT).toBe(10);
  });

  it('검색은 앞뒤 공백을 지운 질의의 대소문자 무시 부분 일치 — 빈 질의는 모두 맞는다', () => {
    const m = { ...mem(1), content: '고양이를 좋아한다 (ABC)' };
    expect(matchesMemoryQuery(m, ' 고양 ')).toBe(true);
    expect(matchesMemoryQuery(m, 'abc')).toBe(true);
    expect(matchesMemoryQuery(m, '')).toBe(true);
    expect(matchesMemoryQuery(m, '강아지')).toBe(false);
  });

  it('고정 막힘 안내 문구 — 데스크톱 툴팁·터치 토스트 공용', () => {
    expect(pinFullHint(10)).toBe('이 범위는 고정이 10개까지예요');
  });

  it('인피니트 스크롤 — 묶음을 이어 앞에서 maxRows 행만, 행이 안 남은 묶음은 뺀다', () => {
    const groups = groupMemories([...Array.from({ length: 25 }, (_, i) => mem(i + 1)), ...Array.from({ length: 10 }, (_, i) => mem(100 + i, 'ISSUE'))]);
    const first = visibleGroups(groups, '', ROWS_PAGE);
    expect(first.total).toBe(35);
    expect(first.views.map((v) => [v.group.key, v.rows.length])).toEqual([
      ['COMMON', 25],
      ['ISSUE', 5],
    ]);
    expect(visibleGroups(groups, '', 20).views.map((v) => [v.group.key, v.rows.length])).toEqual([['COMMON', 20]]);
    expect(visibleGroups(groups, '', ROWS_PAGE * 2).views.reduce((n, v) => n + v.rows.length, 0)).toBe(35);
    // 더 있음 — 아직 그리지 않은 행이 있을 때만.
    expect(first.hasMore).toBe(true);
    expect(visibleGroups(groups, '', 35).hasMore).toBe(false);
    // 일치 수는 자르기 전 묶음 기준(ISSUE 는 5행만 보여도 10개).
    expect(first.views.map((v) => v.matched)).toEqual([25, 10]);
  });

  it('인피니트 스크롤 — 검색으로 거른 행만 세고 맞는 행이 없는 묶음은 뺀다', () => {
    const cat = { ...mem(1, 'ISSUE'), content: '고양이' };
    const groups = groupMemories([mem(3), mem(2), cat]);
    const { views, total, hasMore } = visibleGroups(groups, '고양', ROWS_PAGE);
    expect(total).toBe(1);
    expect(hasMore).toBe(false);
    expect(views.map((v) => [v.group.key, v.matched])).toEqual([['ISSUE', 1]]);
  });
});

// 채팅 메모리 결과 줄 동작 문구(WP-412 — ai-memory-result-line E2E 에서 이관).
describe('memoryActionText', () => {
  it('동작별 문구 — 저장함·고침·지움', () => {
    expect(memoryActionText('saved', undefined)).toBe('메모리에 저장함');
    expect(memoryActionText('updated', null)).toBe('메모리를 고침');
    expect(memoryActionText('forgotten', undefined)).toBe('메모리에서 지움');
  });

  it('앱 범위면 범위 이름을 붙인다(WP-379)', () => {
    expect(memoryActionText('saved', 'ISSUE')).toBe('이슈 메모리에 저장함');
    expect(memoryActionText('forgotten', 'ISSUE')).toBe('이슈 메모리에서 지움');
  });

  it('공용 저장 결과 줄은 공간 이름을 붙인다(WP-386)', () => {
    expect(
      memoryBlockActionText({ kind: 'memory', action: 'shared', changeId: 1, memoryId: 2, spaceName: 'WP 프로젝트', content: 'x', undone: false }),
    ).toBe('WP 프로젝트 공용 메모리에 기억했어요');
  });
});
