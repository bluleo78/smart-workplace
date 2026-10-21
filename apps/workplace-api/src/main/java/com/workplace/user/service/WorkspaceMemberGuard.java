package com.workplace.user.service;

import com.workplace.global.tenant.TenantContext;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.user.exception.UserNotFoundException;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 대상 사용자(사람·AI)가 지금 워크스페이스의 구성원인지 확인하는 공용 가드(#811, WP-703). user 는 전역 테이블이라 id 만으로 다른 워크스페이스의
 * 사용자·AI 에 닿을 수 있으므로, 관리자 단건 조회·변경 API 는 이 검사를 먼저 한다. 비구성원은 존재 자체를 숨기도록 404(Not Found)로 응답한다 —
 * project 도메인의 멤버십 가드와 같은 방식.
 *
 * <p>WP-417: 정지(SUSPENDED)된 구성원도 구성원으로 본다 — 관리자가 정지한 구성원을 계속 보고 다시 활성화할 수 있어야 한다.
 */
@Component
@RequiredArgsConstructor
public class WorkspaceMemberGuard {

  private final MembershipRepository membershipRepository;

  /**
   * 현재 테넌트(인증된 관리자 경로라 컨텍스트가 반드시 있다) 기준 검사.
   *
   * @return 대상의 이 워크스페이스 멤버십 상태(ACTIVE/SUSPENDED)
   */
  public String require(Long userId) {
    return require(userId, TenantContext.require());
  }

  /** {@link #require(Long)} 의 테넌트를 이미 받은 호출용. */
  public String require(Long userId, Long tenantId) {
    return membershipRepository
        .findStatus(userId, tenantId)
        .orElseThrow(() -> UserNotFoundException.ofId(userId));
  }
}
