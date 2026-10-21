package com.workplace.role.dto;

import java.util.Set;

/**
 * 관리 권한 — 구성원·역할·SSO·감사 로그를 다루는 권한(WP-728). 이 중 하나라도 든 역할(과 ADMIN 시스템 역할)은 AI 에이전트에게 새로 줄 수 없다. 역할
 * 할당 가드와 역할 목록의 grantsAdmin 표시가 같은 기준을 쓰도록 한곳에 둔다.
 */
public final class AdminPermissionCodes {

  public static final Set<String> CODES =
      Set.of(
          "user:write",
          "user:delete",
          "role:assign",
          "role:write",
          "role:delete",
          "sso:manage",
          "audit:read");

  private AdminPermissionCodes() {}
}
