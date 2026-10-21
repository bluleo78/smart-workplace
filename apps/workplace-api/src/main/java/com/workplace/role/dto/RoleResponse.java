package com.workplace.role.dto;

/**
 * 역할 요약.
 *
 * @param grantsAdmin ADMIN 시스템 역할이거나 관리 권한(구성원·역할·SSO·감사)이 하나라도 든 역할 — AI 에이전트에게는 새로 줄 수
 *     없다(WP-728). 화면 「역할 할당」이 대상 종류에 맞는 역할만 보이는 데 쓴다.
 */
public record RoleResponse(
    Long id, String name, String description, boolean isSystem, boolean grantsAdmin) {

  /** 관리 권한 여부를 따지지 않는 곳(테스트·단순 조회)용 — grantsAdmin=false. */
  public RoleResponse(Long id, String name, String description, boolean isSystem) {
    this(id, name, description, isSystem, false);
  }
}
