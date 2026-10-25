package com.workplace.role.dto;

import java.util.Set;

/**
 * 관리 권한 — 구성원·역할·SSO·감사 로그·외부 공유 정책·공유 그룹처럼 워크스페이스 전체를 다루는 권한(WP-728). 이 중 하나라도 든 역할(과 ADMIN 시스템
 * 역할)은 AI 에이전트에게 새로 줄 수 없다. 역할 할당 가드와 역할 목록의 grantsAdmin 표시가 같은 기준을 쓰도록 한곳에 둔다.
 *
 * <p>기준(WP-769): ADMIN 시스템 역할에만 있는 권한(일반 구성원 USER 에는 없는 것) + 플랫폼(운영자) 권한. 프로젝트 관리(project:manage)처럼
 * USER 도 가진 권한은 프로젝트 소유자 경계 안에서만 쓰이므로 넣지 않는다. 관리자 전용 권한을 새로 만들면 여기에도 더한다 — {@code
 * RoleKindAssignmentTest} 가 이 기준과 목록이 같은지 검사한다.
 */
public final class AdminPermissionCodes {

  public static final Set<String> CODES =
      Set.of(
          "user:read",
          "user:write",
          "user:delete",
          "role:read",
          "role:assign",
          "role:write",
          "role:delete",
          "permission:read",
          "sso:manage",
          "audit:read",
          "wiki_share:manage",
          "user-group:manage",
          "issue_relation_type:manage",
          "platform:tenant:create",
          "platform:tenant:read",
          "platform:tenant:suspend",
          "platform:member:read");

  private AdminPermissionCodes() {}
}
