// createIssueSchema(WP-412) — 이슈 생성 폼 검증 규칙 단위 테스트.
// 이슈 생성 다이얼로그 E2E 가 화면으로 확인하던 규칙(제목 trim·200자·시작일≤마감일·부모 번호 한국어 오류)을 여기로 옮겼다.
// "에러가 실제 UI 에 뜨는지"는 각 필드별 E2E 가 계속 맡는다.
import { describe, expect, it } from 'vitest';

import { createIssueSchema } from './issue';

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

describe('createIssueSchema — 부모 번호', () => {
  it('빈 입력(valueAsNumber → NaN)은 영문 원시 메시지 대신 한국어 오류', () => {
    expect(firstError({ title: 't', parentNumber: NaN }, 'parentNumber')).toBe('부모 이슈 번호를 입력해주세요');
  });

  it('양의 정수·null·생략은 통과', () => {
    for (const parentNumber of [3, null, undefined]) {
      expect(createIssueSchema.safeParse({ title: 't', parentNumber }).success).toBe(true);
    }
  });
});
