package com.workplace.tenant.outbound;

import com.workplace.global.realtime.AudienceResolver;
import com.workplace.tenant.repository.MembershipRepository;
import java.util.Collection;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * TENANT scope 수신자 = 테넌트 ACTIVE 멤버 전원 (WP-36). 공개 채널 탐색 목록·공유 연락처처럼 멤버십과 무관하게 테넌트 전원이 보는 목록의 변경용.
 * SseRegistry 가 연결된 사용자에게만 보내므로 전원 조회라도 실제 전송은 접속자 수에 비례한다.
 */
@Component
@RequiredArgsConstructor
public class TenantAudienceResolver implements AudienceResolver {

  public static final String SCOPE = "TENANT";

  private final MembershipRepository membershipRepository;

  @Override
  public String scopeType() {
    return SCOPE;
  }

  @Override
  public Collection<Long> resolve(long tenantId) {
    return membershipRepository.findActiveUserIdsByTenant(tenantId);
  }
}
