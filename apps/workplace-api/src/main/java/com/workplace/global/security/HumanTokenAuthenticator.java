package com.workplace.global.security;

import com.workplace.global.tenant.TenantContext;
import com.workplace.global.tenant.TenantStatusChecker;
import com.workplace.permission.service.PermissionService;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.user.dto.UserKind;
import com.workplace.user.repository.UserRepository;
import jakarta.servlet.http.HttpServletRequest;
import java.util.ArrayList;
import java.util.List;
import org.springframework.context.annotation.Lazy;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;

/**
 * 사람 전용 Bearer 토큰(PAT {@code swp_}·OAuth access {@code swo_})의 공통 인증 단계(WP-1685). 토큰 해시 조회는 각 필터가
 * 하고, 찾은 (사용자, 테넌트)로 인증 주체를 세우는 판정·설정은 여기 한 곳에 둔다 — 두 필터가 같은 기준(사람 전용·ACTIVE 멤버십·활성 테넌트)을 어긋남 없이 쓰게
 * 하려는 것이다.
 *
 * <p>정리({@code TenantContext.clear}·{@code AgentToolContext.clear})는 호출한 필터가 finally 에서 한다 — 다운스트림
 * 처리가 끝날 때까지 컨텍스트가 살아 있어야 하기 때문이다.
 */
@Component
public class HumanTokenAuthenticator {

  private final UserRepository userRepository;
  private final PermissionService permissionService;
  private final MembershipRepository membershipRepository;
  // 정지·삭제된 테넌트로는 토큰이 유효해도 인증하지 않는다(WP-341) — JwtAuthenticationFilter 와 같은 기준.
  private final TenantStatusChecker tenantStatusChecker;

  public HumanTokenAuthenticator(
      UserRepository userRepository,
      @Lazy PermissionService permissionService,
      MembershipRepository membershipRepository,
      TenantStatusChecker tenantStatusChecker) {
    this.userRepository = userRepository;
    this.permissionService = permissionService;
    this.membershipRepository = membershipRepository;
    this.tenantStatusChecker = tenantStatusChecker;
  }

  /**
   * 토큰이 가리키는 (userId, tenantId)로 요청을 인증한다. 사람(비 AGENT) 사용자이고, 토큰의 테넌트가 그 사용자의 ACTIVE 멤버십에 있고, 그
   * 테넌트가 활성일 때만 TenantContext·SecurityContext·AgentToolContext 를 채우고 true. 하나라도 어긋나면 아무것도 바꾸지 않고
   * false(fail-closed — 인증 미설정이라 보호 경로는 401).
   */
  public boolean authenticate(HttpServletRequest request, long userId, long tenantId) {
    var user = userRepository.findById(userId).filter(u -> !UserKind.isAgent(u.kind()));
    if (user.isEmpty()) return false; // 사람 전용 — AGENT 는 AI 키(ak_)로만 인증한다
    // 토큰의 테넌트가 실제 ACTIVE 멤버십에 있을 때만 채택 — 멤버십 해지·정지 시 즉시 무효.
    boolean member =
        membershipRepository.findActiveByUser(userId).stream()
            .anyMatch(m -> m.tenantId().equals(tenantId));
    if (!member) return false;
    // 토큰의 테넌트가 비활성(정지·삭제·영구 삭제 중)이어도 인증하지 않는다.
    if (!tenantStatusChecker.isActive(tenantId)) return false;

    // 반드시 getUserPermissions 전에 설정 — GUC 주입 후 권한 조회.
    TenantContext.set(tenantId);

    List<SimpleGrantedAuthority> authorities = new ArrayList<>();
    permissionService
        .getUserPermissions(userId)
        .forEach(p -> authorities.add(new SimpleGrantedAuthority(p)));
    // details(AuthDetails)를 두지 않는다 — 웹 로그인 세션이 아니므로 토큰 발급·워크스페이스 선택 같은 세션 전용 API 가 막힌다.
    SecurityContextHolder.getContext()
        .setAuthentication(new UsernamePasswordAuthenticationToken(userId, null, authorities));
    // WP-377: MCP 가 실은 수행 도구 — 토큰 요청에서만 채택(브라우저·Internal 은 무시).
    AgentToolContext.set(AgentToolContext.normalize(request.getHeader(AgentToolContext.HEADER)));
    return true;
  }
}
