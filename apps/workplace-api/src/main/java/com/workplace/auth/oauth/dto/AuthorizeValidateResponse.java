package com.workplace.auth.oauth.dto;

import java.util.List;

/**
 * 인가 요청 검증 성공 응답(WP-1685) — 동의 화면이 그리는 값.
 *
 * @param clientName 앱 표시 이름
 * @param clientUri 앱 홈페이지(CIMD 문서에 있을 때만, 없으면 null)
 * @param redirectHost 승인 뒤 돌아갈 주소의 호스트 — 사용자가 「어디로 보내지는지」 확인하게 보인다
 * @param unverified DCR 로 등록된 앱이면 true(「확인되지 않은 앱」 표시)
 * @param workspaces 연결할 수 있는 워크스페이스(ACTIVE 멤버십·ACTIVE 테넌트)
 * @param currentTenantId 지금 브라우저 세션의 워크스페이스(목록에 있을 때만, 아니면 null) — 화면의 기본 선택
 */
public record AuthorizeValidateResponse(
    String clientName,
    String clientUri,
    String redirectHost,
    boolean unverified,
    List<Workspace> workspaces,
    Long currentTenantId) {

  /** 고를 수 있는 워크스페이스 한 개. */
  public record Workspace(long tenantId, String name, String slug) {}
}
