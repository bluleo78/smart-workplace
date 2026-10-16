package com.workplace.global.security;

import com.workplace.tenant.dto.MembershipResponse;
import java.util.List;
import org.springframework.util.StringUtils;

/**
 * AI 에이전트 콜백(Internal 토큰 / ak_ API 키)의 active-tenant 해석을 두 필터가 공유하는 헬퍼.
 *
 * <p>정적 자격증명은 요청별 테넌트를 담을 수 없으므로, 선택적 {@code X-On-Behalf-Of-Tenant} 헤더로 테넌트를 명시한다. 헤더는 신뢰하지 않고 반드시
 * 대상 에이전트의 ACTIVE 멤버십에 포함될 때만 채택한다(헤더 위조 시 fail-closed). 헤더가 없으면 단일 멤버십을 자동 선택하고, 0/다중이면
 * 미설정(fail-closed)한다. 미설정 시 RLS GUC 가 비어 모든 행이 차단된다. 명시 헤더가 해석되지 않으면 인증 자체를 거부한다({@link Rejected},
 * WP-420).
 */
public final class AgentTenantResolver {

  /** 에이전트 콜백이 작업 대상 테넌트를 명시하는 헤더. 값은 tenantId(숫자). */
  public static final String TENANT_HEADER = "X-On-Behalf-Of-Tenant";

  private AgentTenantResolver() {}

  /**
   * 테넌트 해석 결과 3상태. 필터는 이 값을 exhaustive switch 로 다뤄 「명시 테넌트 거부」 분기를 빠뜨릴 수 없다(WP-420).
   *
   * <ul>
   *   <li>{@link Resolved} — 채택할 테넌트(명시 헤더가 ACTIVE 멤버십에 있거나, 헤더 없이 단일 멤버십).
   *   <li>{@link NoTenant} — 헤더 없이 ACTIVE 멤버십이 0/다중. 테넌트 없는 인증으로 둔다 — GUC 가 비어 RLS 가 테넌트 행·역할 권한을
   *       막는다 (fail-closed). 개인 비서 전역 계정의 자격 조회 등 테넌트 없는 인증이 필요한 흐름(V163).
   *   <li>{@link Rejected} — 헤더로 테넌트를 <b>명시</b>했는데 그 테넌트의 ACTIVE 멤버십으로 해석되지 않음(비멤버·정지·형식 오류). 필터는
   *       인증을 세우지 않는다(→ 401) — 테넌트 없는 인증으로 넘어가 요청이 「명시한 테넌트」가 아닌 맥락에서 처리되지 않게.
   * </ul>
   */
  public sealed interface Resolution permits Resolved, NoTenant, Rejected {}

  /** 채택한 테넌트. */
  public record Resolved(long tenantId) implements Resolution {}

  /** 헤더 없이 ACTIVE 멤버십 0/다중 — 테넌트 없는 인증. */
  public record NoTenant() implements Resolution {}

  /** 명시한 테넌트가 ACTIVE 멤버십으로 해석되지 않음 — 인증하지 않는다(401). */
  public record Rejected() implements Resolution {}

  /**
   * 에이전트 콜백의 active-tenant 를 해석한다.
   *
   * @param memberships 대상 에이전트의 ACTIVE 멤버십(테넌트도 ACTIVE)
   * @param requestedTenantHeader {@code X-On-Behalf-Of-Tenant} 헤더 원문(null 가능)
   * @return 해석 결과 3상태({@link Resolution})
   */
  public static Resolution resolve(
      List<MembershipResponse> memberships, String requestedTenantHeader) {
    if (StringUtils.hasText(requestedTenantHeader)) {
      long requested;
      try {
        requested = Long.parseLong(requestedTenantHeader.trim());
      } catch (NumberFormatException e) {
        return new Rejected(); // 위조/오타 → fail-closed
      }
      // 헤더는 신뢰하지 않는다 — 실제 ACTIVE 멤버십에 있을 때만 채택.
      return memberships.stream().anyMatch(m -> m.tenantId().equals(requested))
          ? new Resolved(requested)
          : new Rejected();
    }
    // 명시 헤더 없음 → 기존 동작: 단일 멤버십만 자동 선택. 0/다중 → 테넌트 없음.
    return memberships.size() == 1 ? new Resolved(memberships.get(0).tenantId()) : new NoTenant();
  }
}
