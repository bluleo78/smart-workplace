package com.workplace.global.tenant;

import com.workplace.tenant.repository.MembershipRepository;
import java.util.Collection;
import java.util.List;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 대상 사용자가 현재 active 테넌트의 ACTIVE 멤버인지 검증하는 공용 헬퍼 (#713).
 *
 * <p>project/wiki/drive 공간(space)의 addMember 는 호출자 권한(OWNER)만 검증하고 대상 userId 가 어느 테넌트 소속인지는 검증하지
 * 않아, OWNER 가 다른 테넌트 사용자를 멤버로 등록할 수 있는 결함이 있었다. messaging 모듈의 {@code ChannelMemberService.add()} 가
 * 이미 구현·주석화한 "테넌트 경계를 넘는 멤버십 차단" 정책을 공용 헬퍼로 추출해 3개 모듈에 동일하게 적용한다. 향후 신규 멤버십 추가 경로에서도 이 헬퍼를 재사용해 누락을
 * 방지한다.
 */
@Component
@RequiredArgsConstructor
public class MembershipGuard {

  private final MembershipRepository membershipRepository;

  /**
   * 대상 사용자가 현재 active 테넌트의 ACTIVE 멤버가 아니면 true(정책 위반). active 테넌트 컨텍스트가 없으면(비인증 등) fail-closed 로
   * true 를 반환한다.
   */
  public boolean isForeignUser(long targetUserId) {
    Long tenantId = TenantContext.get();
    return tenantId == null || !membershipRepository.hasActiveMembership(targetUserId, tenantId);
  }

  /**
   * {@link #isForeignUser} 의 일괄판 — 대상 중 현재 active 테넌트의 ACTIVE 멤버가 아닌 id 만 입력 순서대로 돌려준다(#852 일정
   * 참석자처럼 여러 명을 한 번에 검사할 때 N 회 조회를 피한다). 컨텍스트가 없으면 fail-closed 로 전부 반환한다.
   */
  public List<Long> foreignUserIds(Collection<Long> targetUserIds) {
    Long tenantId = TenantContext.get();
    if (tenantId == null) return List.copyOf(targetUserIds);
    Set<Long> members = membershipRepository.findActiveUserIds(targetUserIds, tenantId);
    return targetUserIds.stream().filter(id -> !members.contains(id)).toList();
  }
}
