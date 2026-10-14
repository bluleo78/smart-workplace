import { AxiosError, AxiosHeaders } from 'axios';
import { describe, expect, it } from 'vitest';

import type { AiMemoryItem } from '@/types/aiMemory';

import {
  canSubmitContent,
  COLLAPSE_OVER,
  collapsedRows,
  contentCountTone,
  defaultAddScope,
  extractApiErrorScope,
  fullScopeKeys,
  groupMemories,
  listCountTone,
  memoryErrorMessage,
  memoryFullMessage,
  memoryLength,
  memoryNoun,
  SCOPE_LABEL,
  scopeDescription,
  scopeKeyOf,
  UNDO_FULL_MESSAGE,
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
  it('내용 카운트는 300 초과면 빨강, 목록 카운트는 45 부터 주황', () => {
    expect(contentCountTone(300)).toBe('text-muted-foreground');
    expect(contentCountTone(301)).toBe('text-destructive');
    expect(listCountTone(44)).toBe('text-muted-foreground');
    expect(listCountTone(45)).toBe('text-warning-text');
    expect(listCountTone(50)).toBe('text-warning-text');
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

  it('가득 찬 범위 — 묶음의 유효 행 수가 한도 이상', () => {
    const groups = groupMemories([...Array.from({ length: 50 }, (_, i) => mem(i + 1)), mem(100, 'ISSUE')]);
    expect([...fullScopeKeys(groups, 50)]).toEqual(['COMMON']);
  });

  it('10개 넘는 묶음은 접으면 5개, 펼치면 전부 — 10개 이하는 그대로', () => {
    const eleven = Array.from({ length: COLLAPSE_OVER + 1 }, (_, i) => mem(i));
    expect(collapsedRows(eleven, false)).toHaveLength(5);
    expect(collapsedRows(eleven, true)).toHaveLength(11);
    expect(collapsedRows(eleven.slice(0, 10), false)).toHaveLength(10);
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
