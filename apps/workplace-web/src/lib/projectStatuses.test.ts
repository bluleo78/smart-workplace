// 프로젝트 상태 순수 로직(WP-808) — 정렬·범주 묶기·기본 상태·편집 권한·이름 검증.
import { describe, expect, it } from 'vitest';

import type { ProjectStatus } from '../types/projectStatus';
import {
  canEditStatuses,
  categorySpans,
  defaultStatusOf,
  sortStatuses,
  STATUS_NAME_MAX,
  statusesByCategory,
  validateStatusName,
} from './projectStatuses';

const st = (id: number, name: string, category: ProjectStatus['category'], position: number): ProjectStatus => ({
  id,
  name,
  category,
  position,
});

// 서버 순서와 일부러 다르게 섞은 목록 — 범주가 position 보다 앞서는지 본다.
const MIXED: ProjectStatus[] = [
  st(3, '완료', 'DONE', 0),
  st(12, '검토 중', 'IN_PROGRESS', 5),
  st(1, '할 일', 'TODO', 9),
  st(4, '취소', 'CANCELED', 1),
  st(2, '진행 중', 'IN_PROGRESS', 2),
];

describe('projectStatuses', () => {
  it('sortStatuses 는 범주 순서 → position', () => {
    const before = MIXED.map((s) => s.id);
    expect(sortStatuses(MIXED).map((s) => s.id)).toEqual([1, 2, 12, 3, 4]);
    // 입력 배열은 건드리지 않는다(쿼리 캐시 데이터를 직접 넘겨도 안전).
    expect(MIXED.map((s) => s.id)).toEqual(before);
  });

  it('statusesByCategory 는 범주 4개를 모두 키로 두고 각 범주를 position 순으로 담는다', () => {
    const by = statusesByCategory([st(2, '진행 중', 'IN_PROGRESS', 2), st(12, '검토 중', 'IN_PROGRESS', 1)]);
    expect(by.TODO).toEqual([]);
    expect(by.IN_PROGRESS.map((s) => s.id)).toEqual([12, 2]);
    expect(by.DONE).toEqual([]);
    expect(by.CANCELED).toEqual([]);
  });

  it('defaultStatusOf 는 범주의 최소 position', () => {
    expect(defaultStatusOf(MIXED, 'IN_PROGRESS')?.id).toBe(2);
    expect(defaultStatusOf(MIXED, 'TODO')?.id).toBe(1);
    expect(defaultStatusOf([], 'DONE')).toBeUndefined();
  });

  it('canEditStatuses: OWNER+TEAM true, OWNER+PERSONAL false, MEMBER false', () => {
    expect(canEditStatuses(true, 'TEAM')).toBe(true);
    expect(canEditStatuses(true, 'OPEN')).toBe(true);
    expect(canEditStatuses(true, 'PERSONAL')).toBe(false);
    expect(canEditStatuses(false, 'TEAM')).toBe(false);
    // 프로젝트를 아직 못 불러왔을 때(유형 미상)도 OWNER 면 편집 가능 — 서버가 개인 프로젝트를 최종 거절한다.
    expect(canEditStatuses(true, undefined)).toBe(true);
  });

  it('validateStatusName: 공백만 → 「상태 이름을 입력해 주세요」', () => {
    expect(validateStatusName('   ', MIXED)).toBe('상태 이름을 입력해 주세요');
    expect(validateStatusName('', MIXED)).toBe('상태 이름을 입력해 주세요');
  });

  it('validateStatusName: 31자 → 30자 오류, 30자 → null', () => {
    expect(STATUS_NAME_MAX).toBe(30);
    expect(validateStatusName('가'.repeat(31), MIXED)).toBe('상태 이름은 30자 이하로 입력해 주세요');
    expect(validateStatusName('가'.repeat(30), MIXED)).toBeNull();
    // 앞뒤 공백은 길이에 넣지 않는다(서버도 trim 후 저장).
    expect(validateStatusName(` ${'가'.repeat(30)} `, MIXED)).toBeNull();
  });

  it('validateStatusName: " 검토 중 " 은 「검토 중」 과 중복, 자기 자신(excludeId)은 허용', () => {
    expect(validateStatusName(' 검토 중 ', MIXED)).toBe('이미 존재하는 상태 이름입니다');
    // 대소문자만 다른 이름도 중복.
    expect(validateStatusName('qa', [st(20, 'QA', 'IN_PROGRESS', 3)])).toBe('이미 존재하는 상태 이름입니다');
    expect(validateStatusName('검토 중', MIXED, 12)).toBeNull();
    expect(validateStatusName('QA 대기', MIXED)).toBeNull();
  });

  it('validateStatusName: 범주 코드와 같은 이름(대소문자·앞뒤 공백 무시)은 거절, 코드를 품은 이름은 허용', () => {
    const msg = '범주 코드(TODO·IN_PROGRESS·DONE·CANCELED)는 상태 이름으로 쓸 수 없습니다';
    for (const code of ['TODO', ' done ', 'In_Progress', 'canceled']) {
      expect(validateStatusName(code, MIXED)).toBe(msg);
    }
    expect(validateStatusName('TODO 검토', MIXED)).toBeNull();
  });

  it('categorySpans: 진행 중 범주 컬럼 3개면 span count 3, 범주 순서 고정', () => {
    // 입력 순서를 섞어도 띠는 범주 순서(할 일 → 진행 중 → 완료 → 취소)이고, 라벨은 고정 범주 라벨이다.
    const spans = categorySpans([
      st(4, '취소', 'CANCELED', 9),
      st(13, 'QA 대기', 'IN_PROGRESS', 4),
      st(1, '접수', 'TODO', 0),
      st(2, '작업 중', 'IN_PROGRESS', 1),
      st(3, '완료', 'DONE', 8),
      st(12, '검토 중', 'IN_PROGRESS', 2),
    ]);
    expect(spans).toEqual([
      { category: 'TODO', label: '할 일', count: 1 },
      { category: 'IN_PROGRESS', label: '진행 중', count: 3 },
      { category: 'DONE', label: '완료', count: 1 },
      { category: 'CANCELED', label: '취소', count: 1 },
    ]);
  });

  it('categorySpans: 컬럼이 없는 범주(개인 보드의 취소)는 띠에서 뺀다', () => {
    const spans = categorySpans([st(1, '할 일', 'TODO', 0), st(2, '진행 중', 'IN_PROGRESS', 1), st(3, '완료', 'DONE', 2)]);
    expect(spans.map((s) => s.category)).toEqual(['TODO', 'IN_PROGRESS', 'DONE']);
    expect(categorySpans([])).toEqual([]);
  });
});
