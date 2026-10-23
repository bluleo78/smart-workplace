// createIssueSchema(WP-412) — 이슈 생성 폼 검증 규칙 단위 테스트.
// 이슈 생성 다이얼로그 E2E 가 화면으로 확인하던 규칙(제목 trim·200자·시작일≤마감일·부모 번호 한국어 오류)을 여기로 옮겼다.
// "에러가 실제 UI 에 뜨는지"는 각 필드별 E2E 가 계속 맡는다.
import { describe, expect, it } from 'vitest';

import { createCommentSchema, createIssueSchema, issueTextOverLimitMessage, updateIssueSchema } from './issue';

// 첫 번째 오류 메시지(없으면 null) — 필드별 오류 문구를 짧게 단언하려고 쓴다.
function firstError(input: unknown, field: string): string | null {
  const r = createIssueSchema.safeParse(input);
  if (r.success) return null;
  return r.error.issues.find((i) => i.path[0] === field)?.message ?? null;
}

describe('createIssueSchema — 제목', () => {
  it('앞뒤 공백을 trim 한 값으로 통과한다', () => {
    const r = createIssueSchema.safeParse({ title: '  trimmed title  ' });
    expect(r.success && r.data.title).toBe('trimmed title');
  });

  it('공백뿐이면 "제목은 필수입니다"', () => {
    expect(firstError({ title: '   ' }, 'title')).toBe('제목은 필수입니다');
  });

  it('200자는 통과, 201자는 한국어 오류', () => {
    expect(createIssueSchema.safeParse({ title: 'B'.repeat(200) }).success).toBe(true);
    expect(firstError({ title: 'A'.repeat(201) }, 'title')).toBe('제목은 200자 이하여야 합니다');
  });
});

// WP-886: 우선순위 5단계 — 서버 @Pattern 과 같은 값만 받는다.
describe('createIssueSchema — 우선순위', () => {
  it('5단계는 통과하고 그 밖의 값은 거부한다', () => {
    for (const priority of ['HIGHEST', 'HIGH', 'MID', 'LOW', 'LOWEST']) {
      expect(createIssueSchema.safeParse({ title: 't', priority }).success).toBe(true);
    }
    expect(createIssueSchema.safeParse({ title: 't', priority: 'URGENT' }).success).toBe(false);
  });
});

describe('createIssueSchema — 시작일·마감일', () => {
  it('시작일이 마감일보다 늦으면 startDate 에 오류', () => {
    expect(firstError({ title: 't', startDate: '2026-07-10', dueDate: '2026-07-01' }, 'startDate')).toBe(
      '시작일은 마감일보다 늦을 수 없습니다',
    );
  });

  it('같은 날·한쪽만 있거나 빈 문자열이면 통과', () => {
    for (const v of [
      { startDate: '2026-07-01', dueDate: '2026-07-01' },
      { startDate: '2026-07-10' },
      { dueDate: '2026-07-01' },
      { startDate: '', dueDate: '' },
    ]) {
      expect(createIssueSchema.safeParse({ title: 't', ...v }).success).toBe(true);
    }
  });
});

describe('createIssueSchema — 날짜 범위 (WP-900)', () => {
  it('5자리 연도·범위 밖 날짜는 영어 원시 문구 대신 한국어 범위 오류', () => {
    const msg = '날짜는 1900-01-01 ~ 9999-12-31 사이여야 합니다';
    expect(firstError({ title: 't', dueDate: '20260-10-23' }, 'dueDate')).toBe(msg);
    expect(firstError({ title: 't', startDate: '20260-10-23' }, 'startDate')).toBe(msg);
    expect(firstError({ title: 't', dueDate: '1899-12-31' }, 'dueDate')).toBe(msg);
  });
});

describe('createIssueSchema — 부모 번호', () => {
  it('빈 입력(valueAsNumber → NaN)은 영문 원시 메시지 대신 한국어 오류', () => {
    expect(firstError({ title: 't', parentNumber: NaN }, 'parentNumber')).toBe('부모 이슈 번호를 입력해주세요');
  });

  // WP-906: 0·소수·음수·32비트 초과가 zod 영문 메시지나 서버 400 으로 새던 것을 한국어 안내로 막는다.
  it('0·소수·음수는 한국어 정수 안내', () => {
    for (const parentNumber of [0, 1.5, -3]) {
      expect(firstError({ title: 't', parentNumber }, 'parentNumber')).toBe('부모 이슈 번호는 1 이상의 정수여야 합니다');
    }
  });

  it('32비트 정수 상한까지 통과, 넘으면 상한 안내', () => {
    expect(createIssueSchema.safeParse({ title: 't', parentNumber: 2147483647 }).success).toBe(true);
    expect(firstError({ title: 't', parentNumber: 2147483648 }, 'parentNumber')).toBe(
      '부모 이슈 번호는 2147483647 이하여야 합니다',
    );
    expect(firstError({ title: 't', parentNumber: 1e21 }, 'parentNumber')).toBe('부모 이슈 번호는 2147483647 이하여야 합니다');
  });

  it('양의 정수·null·생략은 통과', () => {
    for (const parentNumber of [3, null, undefined]) {
      expect(createIssueSchema.safeParse({ title: 't', parentNumber }).success).toBe(true);
    }
  });
});

// WP-885: 본문·코멘트 상한 5만자 — 서버 IssueTextLimits.BODY_MAX 와 같다(Jira 이전 데이터 본문 2.5만자·코멘트 3.1만자).
describe('이슈 본문·코멘트 길이 상한', () => {
  it('생성 폼: 본문 5만자는 통과, 5만 1자는 한국어 오류', () => {
    expect(createIssueSchema.safeParse({ title: 't', body: '가'.repeat(50000) }).success).toBe(true);
    expect(firstError({ title: 't', body: '가'.repeat(50001) }, 'body')).toBe('본문은 50000자 이하여야 합니다');
  });

  it('수정: 본문 5만자는 통과, 5만 1자는 거절', () => {
    expect(updateIssueSchema.safeParse({ body: '가'.repeat(50000) }).success).toBe(true);
    expect(updateIssueSchema.safeParse({ body: '가'.repeat(50001) }).success).toBe(false);
  });

  it('코멘트: 5만자는 통과, 5만 1자·빈 값은 거절', () => {
    expect(createCommentSchema.safeParse({ body: '가'.repeat(50000) }).success).toBe(true);
    expect(createCommentSchema.safeParse({ body: '가'.repeat(50001) }).success).toBe(false);
    expect(createCommentSchema.safeParse({ body: '' }).success).toBe(false);
  });

  // 본문 편집기와 코멘트 작성·수정이 같은 문구를 쓴다 — 받침에 맞는 조사와 현재 글자 수.
  it('초과 안내 문구: 본문은·코멘트는 + 상한 + 현재 글자 수', () => {
    expect(issueTextOverLimitMessage('본문', 50001)).toBe('본문은 50000자 이하여야 합니다 (현재 50001자)');
    expect(issueTextOverLimitMessage('코멘트', 60000)).toBe('코멘트는 50000자 이하여야 합니다 (현재 60000자)');
  });
});
