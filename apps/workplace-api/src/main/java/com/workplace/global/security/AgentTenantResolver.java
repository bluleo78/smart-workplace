package com.workplace.global.security;

import com.workplace.tenant.dto.MembershipResponse;
import java.util.List;
import org.springframework.util.StringUtils;

/**
 * AI 에이전트 콜백(Internal 토큰 / ak_ API 키)의 active-tenant 해석을 두 필터가 공유하는 헬퍼.
 *
 * <p>정적 자격증명은 요청별 테넌트를 담을 수 없으므로, 선택적 {@code X-On-Behalf-Of-Tenant} 헤더로 테넌트를 명시한다. 헤더는 신뢰하지 않고 반드시
 * 대상 에이전트의 ACTIVE 멤버십에 포함될 때만 채택한다(헤더 위조 시 fail-closed). 헤더가 없으면 단일 멤버십을 자동 선택하고, 0/다중이면
 * 미설정(fail-closed)한다. 미설정 시 RLS GUC 가 비어 모든 행이 차단된다.
 */
public final class AgentTenantResolver {

  /** 에이전트 콜백이 작업 대상 테넌트를 명시하는 헤더. 값은 tenantId(숫자). */
  public static final String TENANT_HEADER = "X-On-Behalf-Of-Tenant";

  private AgentTenantResolver() {}

  /**
   * 에이전트 콜백의 active-tenant 를 해석한다.
   *
   * @param memberships 대상 에이전트의 ACTIVE 멤버십(테넌트도 ACTIVE)
   * @param requestedTenantHeader {@code X-On-Behalf-Of-Tenant} 헤더 원문(null 가능)
   * @return 채택할 tenantId, 또는 fail-closed 인 경우 null
   */
  public static Long resolve(List<MembershipResponse> memberships, String requestedTenantHeader) {
    if (StringUtils.hasText(requestedTenantHeader)) {
      long requested;
      try {
        requested = Long.parseLong(requestedTenantHeader.trim());
      } catch (NumberFormatException e) {
        return null; // 위조/오타 → fail-closed
      }
      // 헤더는 신뢰하지 않는다 — 실제 ACTIVE 멤버십에 있을 때만 채택.
      return memberships.stream().anyMatch(m -> m.tenantId().equals(requested)) ? requested : null;
    }
    // 명시 헤더 없음 → 기존 동작: 단일 멤버십만 자동 선택. 0/다중 → fail-closed.
    return memberships.size() == 1 ? memberships.get(0).tenantId() : null;
  }
}
