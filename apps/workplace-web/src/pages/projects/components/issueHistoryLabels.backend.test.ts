// 이력 종류 표 ↔ 백엔드 enum 대조 테스트(WP-1593) — 프론트 IssueHistoryEventType 은 손으로 쓴 타입이라, 백엔드 enum 에 종류가 생겨도
// 컴파일러는 모른다. 그래서 자바 enum 소스(IssueHistoryEventType.java)를 읽어 HISTORY_EVENT_LABEL 의 키와 정확히 같은지 본다 —
// 빠지면 이슈 활동 기록·프로젝트 개요·홈 「최근 활동」 위젯에 영문 원본이나 「수정」이 보인다(시작일·마일스톤이 그랬다).
// 주석 걷어 내기는 감사 로그 대조 스캐너(src/test/auditLogBackendScan.ts, WP-1560)의 stripComments 를 같이 쓴다.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

import { stripComments } from '@/test/auditLogBackendScan';

import { HISTORY_EVENT_LABEL } from './issueHistoryLabels';

/** 백엔드 이력 종류 enum 소스(저장소 기준 apps/workplace-api/.../issue/dto/IssueHistoryEventType.java). */
const ENUM_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../workplace-api/src/main/java/com/workplace/issue/dto/IssueHistoryEventType.java',
);

/** enum 본문({ … })의 상수 이름을 모은다 — 주석을 걷은 뒤 쉼표로 나눈다(상수에 인자·본문이 없는 단순 enum). */
function enumConstants(src: string): string[] {
  const body = /enum\s+IssueHistoryEventType\s*\{([^}]*)\}/.exec(stripComments(src))?.[1] ?? '';
  return body
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

it('HISTORY_EVENT_LABEL 의 키가 백엔드 IssueHistoryEventType enum 상수와 정확히 같다', () => {
  const backend = enumConstants(readFileSync(ENUM_FILE, 'utf8'));
  // 파싱이 깨져 빈 목록끼리 비교하는 거짓 통과를 막는다.
  expect(backend.length).toBeGreaterThan(20);
  expect(backend.every((c) => /^[A-Z_]+$/.test(c))).toBe(true);
  expect(Object.keys(HISTORY_EVENT_LABEL).sort()).toEqual([...backend].sort());
});
