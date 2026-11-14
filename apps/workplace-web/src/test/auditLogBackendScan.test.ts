// 감사 로그 백엔드 스캐너 단위 테스트(WP-1560) — 인라인 자바 조각으로, 도우미 메서드를 거쳐 넘어오는 새 값도 잡히는지 지킨다.
import { describe, expect, it } from 'vitest';

import { scanSource } from './auditLogBackendScan';

/** 액션 값만 정렬해 뽑는다. */
function actions(src: string): string[] {
  return [...scanSource(src).values.action].sort();
}

const HELPER_CLASS = `
class Svc {
  private final AuditLogService auditLogService;
  void a() { audit("FIRST_ACTION", "d"); }
  void b() { audit("NEW_ACTION", "d"); }
  private void audit(String action, String description) {
    auditLogService.log(1L, "u", action, "thing", "1", description, null, null, "SUCCESS", null, null);
  }
}`;

describe('scanSource (WP-1560)', () => {
  it('같은 파일 도우미로 넘기는 값(새로 더한 리터럴 호출 포함)을 찾는다', () => {
    const r = scanSource(HELPER_CLASS);
    expect(r.unresolved).toEqual([]);
    expect(actions(HELPER_CLASS)).toEqual(['FIRST_ACTION', 'NEW_ACTION']);
  });

  it('도우미를 두 단계 거쳐도 따라간다', () => {
    const src = `
class Svc {
  AuditLogService auditLogService;
  void a() { audit("DEEP_ACTION"); }
  void audit(String action) { logAudit(action, "r"); }
  void logAudit(String action, String res) { auditLogService.log(1L, "u", action, res, "1", "d", null, null, "SUCCESS", null, null); }
}`;
    expect(actions(src)).toEqual(['DEEP_ACTION']);
  });

  it('호출부가 없는 도우미 파라미터는 풀 수 없는 자리로 보고한다', () => {
    const src = `
class Svc {
  AuditLogService auditLogService;
  public void log(String actionType) { auditLogService.log(1L, "u", actionType, "r", "1", "d", null, null, "S", null, null); }
}`;
    expect(scanSource(src).unresolved).toEqual(['action actionType']);
  });

  it('final static · static final 상수를 모두 푼다', () => {
    const src = `
class Svc {
  AuditLogService auditLogService;
  public final static String A = "FINAL_STATIC";
  private static final String B = "STATIC_FINAL";
  void x() { auditLogService.log(1L, "u", A, B, "1", "d", null, null, "S", null, null); }
}`;
    const r = scanSource(src);
    expect(r.values).toEqual({ action: ['FINAL_STATIC'], resource: ['STATIC_FINAL'] });
  });

  it('필드 이름이 auditLogService 가 아니어도 타입으로 찾는다', () => {
    const src = `
class Svc {
  private final AuditLogService audit;
  void x() { audit.log(1L, "u", "OTHER_NAME_ACTION", "r", "1", "d", null, null, "S", null, null); }
}`;
    expect(actions(src)).toEqual(['OTHER_NAME_ACTION']);
  });

  it('tenant 변형은 인자 위치가 하나 뒤다', () => {
    const src = `
class Svc {
  AuditLogService auditLogService;
  void x() { auditLogService.logInTenant(7L, 1L, "u", "TENANT_ACTION", "res", "1", "d", null, null, "S", null, null); }
}`;
    expect(scanSource(src).values).toEqual({ action: ['TENANT_ACTION'], resource: ['res'] });
  });

  it('인자 안의 문자 리터럴 \')\' · 따옴표·주석 속 괄호에 속지 않는다', () => {
    const src = `
class Svc {
  AuditLogService auditLogService;
  void x() {
    // auditLogService.log(1L, "u", "IN_COMMENT", "r");
    auditLogService.log(1L, "u", "CHAR_ACTION", "r", String.valueOf(')'), "d)", null, null, "S", null, null);
  }
}`;
    const r = scanSource(src);
    expect(r.calls).toBe(1);
    expect(actions(src)).toEqual(['CHAR_ACTION']);
  });

  it('삼항과 지역 변수 대입, 접근자 메서드 반환값도 푼다', () => {
    const src = `
class Svc {
  AuditLogService auditLogService;
  void x(boolean on) {
    String t;
    if (on) { t = "LOCAL_A"; } else { t = "LOCAL_B"; }
    auditLogService.log(1L, "u", on ? "TERN_A" : "TERN_B", "r", "1", "d", null, null, "S", null, null);
    auditLogService.log(1L, "u", t, "r", "1", "d", null, null, "S", null, null);
    auditLogService.log(1L, "u", target.kind(), "r", "1", "d", null, null, "S", null, null);
  }
  String kind() { return "ACCESSOR_ACTION"; }
}`;
    expect(actions(src)).toEqual(['ACCESSOR_ACTION', 'LOCAL_A', 'LOCAL_B', 'TERN_A', 'TERN_B']);
    expect(scanSource(src).unresolved).toEqual([]);
  });

  it('인자가 모자란 호출은 죽지 않고 풀 수 없는 자리로 보고한다', () => {
    const src = `
class Svc {
  AuditLogService auditLogService;
  void x() { auditLogService.log(1L, "u"); }
}`;
    expect(scanSource(src).unresolved).toEqual(['action <인자 없음: 2개만 있음>', 'resource <인자 없음: 2개만 있음>']);
  });
});
