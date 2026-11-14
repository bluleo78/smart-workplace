// 감사 로그 라벨 ↔ 백엔드 소스 대조 테스트(WP-1560) — 백엔드가 감사 로그(AuditLogService.log·logInTenant·logInTenantOrGlobal)로 남기는
// 액션·리소스 값에 프론트 라벨이 모두 있는지 소스를 읽어 확인한다. 라벨이 빠지면 감사 로그 화면에 영문 코드가 그대로 보이기 때문이다(#109·WP-1560).
// 값 추출은 src/test/auditLogBackendScan.ts(리터럴·상수·같은 파일 도우미 파라미터·지역 변수·접근자). 못 푸는 자리는 아래 명시 목록과 정확히 같아야 한다.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { scanSource } from '@/test/auditLogBackendScan';

import { AUDIT_ACTION_TYPES, AUDIT_RESOURCES } from './auditLogLabels';

/** 백엔드 자바 소스 루트(저장소 기준 apps/workplace-api/src/main/java). */
const BACKEND_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../workplace-api/src/main/java');

/**
 * 정적으로 값을 못 푸는 자리 전부(`<파일>: <액션|리소스> <인자 텍스트>`). 새 자리가 생기거나 사라지면 테스트가 실패하니,
 * 넘어오는 값을 확인해 라벨을 채우고 이 목록을 고친다. 항목마다 어떤 값이 어디서 오는지 적는다.
 */
const EXPECTED_UNRESOLVED: string[] = [
  // 노트 공유 감사(WikiShareAudit.log) — 액션은 다른 파일(WikiShareService·WikiShareAccessRequestService)이 이 클래스의 상수
  // (WIKI_SHARE_CREATED/UPDATED/PEOPLE_CHANGED/REGENERATED/REVOKED/ACCESS_DENIED/POLICY_CHANGED)로 넘긴다. 전부 라벨이 있다.
  'com/workplace/wiki/service/WikiShareAudit.java: action actionType',
];

/** 디렉터리를 재귀로 돌며 .java 파일 경로를 모은다. */
function listJavaFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listJavaFiles(full) : full.endsWith('.java') ? [full] : [];
  });
}

interface Found {
  calls: number;
  action: { file: string; value: string }[];
  resource: { file: string; value: string }[];
  unresolved: string[];
}

/** 감사 기록 서비스를 쓰는 파일만(전체 자바 파일 2천여 개 중 서른 개 안팎) 스캔해 값(파일 표시 포함)과 못 푼 자리를 모은다. */
function scanBackend(): Found {
  const out: Found = { calls: 0, action: [], resource: [], unresolved: [] };
  for (const path of listJavaFiles(BACKEND_ROOT)) {
    const raw = readFileSync(path, 'utf-8');
    if (!/AuditLogService/.test(raw)) continue;
    const file = relative(BACKEND_ROOT, path);
    const r = scanSource(raw);
    out.calls += r.calls;
    for (const kind of ['action', 'resource'] as const) out[kind].push(...r.values[kind].map((value) => ({ file, value })));
    out.unresolved.push(...r.unresolved.map((u) => `${file}: ${u}`));
  }
  return out;
}

describe('감사 로그 라벨 ↔ 백엔드 값 대조 (WP-1560)', () => {
  let found: Found;
  beforeAll(() => {
    found = scanBackend();
  });

  it('호출부를 실제로 읽었다(경로가 틀려 빈 통과가 되지 않게)', () => {
    expect(found.calls).toBeGreaterThan(20);
    expect(found.action.length).toBeGreaterThan(0);
    expect(found.resource.length).toBeGreaterThan(0);
  });

  it('백엔드가 남기는 액션 값마다 프론트 라벨이 있다', () => {
    const known = new Set<string>(AUDIT_ACTION_TYPES.map((t) => t.value));
    expect(found.action.filter((a) => !known.has(a.value)).map((a) => `${a.file}: ${a.value}`)).toEqual([]);
  });

  it('백엔드가 남기는 리소스 값마다 프론트 라벨이 있다', () => {
    const known = new Set<string>(AUDIT_RESOURCES.map((t) => t.value));
    expect(found.resource.filter((r) => !known.has(r.value)).map((r) => `${r.file}: ${r.value}`)).toEqual([]);
  });

  it('값을 못 푸는 자리가 명시 목록과 정확히 같다(새 자리·사라진 자리 모두 실패)', () => {
    expect([...found.unresolved].sort()).toEqual([...EXPECTED_UNRESOLVED].sort());
  });
});
