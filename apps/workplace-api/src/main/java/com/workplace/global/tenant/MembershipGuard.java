package com.workplace.global.tenant;

import com.workplace.tenant.repository.MembershipRepository;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.function.BiFunction;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 대상 사용자가 현재 active 테넌트의 ACTIVE 멤버인지 검증하는 공용 헬퍼 (#713). 예외: {@link #nonMemberUserIds} 는 정지된
 * 구성원(SUSPENDED)도 멤버로 보는 「보이기 전용」 판정이라, 사람을 새로 끌어들이는 경로(초대·공유·참석자)에는 쓰지 않는다(WP-1159).
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
    return excludeMembers(targetUserIds, membershipRepository::findActiveUserIds);
  }

  /**
   * 대상 중 현재 active 테넌트에 ACTIVE·SUSPENDED 멤버십이 <b>없는</b> id 만 입력 순서대로 돌려준다(WP-1159). {@link
   * #foreignUserIds} 와 달리 정지된 구성원은 이 워크스페이스 사람으로 본다 — 지난 코멘트의 멘션처럼 이미 쓰인 글을 보여 주기만 하는 경로용이다. 컨텍스트가
   * 없으면 fail-closed 로 전부 반환한다.
   */
  public List<Long> nonMemberUserIds(Collection<Long> targetUserIds) {
    return excludeMembers(targetUserIds, membershipRepository::findActiveOrSuspendedUserIds);
  }

  /** 두 일괄 판정의 공통 — 컨텍스트가 없으면 fail-closed 로 전부, 있으면 멤버 조회 결과에 없는 id 를 입력 순서대로. */
  private List<Long> excludeMembers(
      Collection<Long> targetUserIds, BiFunction<Collection<Long>, Long, Set<Long>> members) {
    Long tenantId = TenantContext.get();
    if (tenantId == null) return List.copyOf(targetUserIds);
    Set<Long> found = members.apply(targetUserIds, tenantId);
    return targetUserIds.stream().filter(id -> !found.contains(id)).toList();
  }

  /**
   * 사용자가 <b>지정한</b> 테넌트의 ACTIVE 멤버인지 — 현재 active 테넌트가 아닌 다른 워크스페이스를 가리키는 링크(노트 공유 WP-579)가 "전환할 수
   * 있는 워크스페이스인가" 를 판정할 때 쓴다. {@link #isForeignUser} 와 달리 TenantContext 를 보지 않는다.
   */
  public boolean isActiveMemberOf(long userId, long tenantId) {
    return membershipRepository.hasActiveMembership(userId, tenantId);
  }

  /**
   * WP-417: 대상의 현재 active 테넌트 멤버십 상태(ACTIVE/SUSPENDED). 멤버가 아니면 빈 값 — 컨텍스트가 없으면 fail-closed 로 빈
   * 값(비멤버 취급). 정지된 구성원을 "여기 없는 사용자(404)"가 아니라 "비활성(409)"으로 안내해야 하는 경로가 쓴다.
   */
  public Optional<String> membershipStatus(long targetUserId) {
    Long tenantId = TenantContext.get();
    if (tenantId == null) return Optional.empty();
    return membershipRepository.findStatus(targetUserId, tenantId);
  }
}
