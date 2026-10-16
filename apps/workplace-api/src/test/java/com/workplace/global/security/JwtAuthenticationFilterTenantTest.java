package com.workplace.global.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

import com.workplace.global.tenant.TenantContext;
import com.workplace.tenant.dto.MembershipResponse;
import com.workplace.tenant.repository.MembershipRepository;
import jakarta.servlet.FilterChain;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;

/**
 * JwtAuthenticationFilter 의 Internal(AI 에이전트) 토큰 경로가 TenantContext 를 올바르게 설정/미설정함을 검증.
 *
 * <p>세션 GUC 기본값(application-test.yml: app.tenant_id=1)이 TenantContext 부재를 은폐하는 문제를 직접 ThreadLocal
 * 검사로 우회한다.
 */
@ExtendWith(MockitoExtension.class)
class JwtAuthenticationFilterTenantTest {

  private static final String INTERNAL_TOKEN = "test-internal-token";
  private static final Long USER_ID = 42L;
  private static final Long TENANT_ID = 1L;

  @Mock private JwtTokenProvider jwtTokenProvider;
  @Mock private com.workplace.permission.service.PermissionService permissionService;
  @Mock private MembershipRepository membershipRepository;
  // JWT 경로의 테넌트 ACTIVE 확인(WP-341) — Bearer 테스트에서만 스텁한다.
  @Mock private com.workplace.global.tenant.TenantStatusChecker tenantStatusChecker;

  private JwtAuthenticationFilter filter;

  @BeforeEach
  void setUp() {
    filter =
        new JwtAuthenticationFilter(
            jwtTokenProvider,
            permissionService,
            membershipRepository,
            INTERNAL_TOKEN,
            tenantStatusChecker);
    // 권한 조회는 빈 Set 반환으로 충분 (테스트 대상은 TenantContext). Internal 경로만 쓰므로 lenient —
    // WP-420 이후 tenant 있는 Bearer 경로는 getActiveMemberPermissions 를 부른다.
    lenient().when(permissionService.getUserPermissions(USER_ID)).thenReturn(Set.of());
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
    // 필터가 세운 인증이 다음 테스트로 새지 않게 한다(WP-420 — 인증 미설정을 단언하는 테스트가 앞 테스트의 인증을 보지 않도록).
    SecurityContextHolder.clearContext();
  }

  /**
   * Internal 토큰 + X-On-Behalf-Of 헤더로 요청 시, 대상 사용자에게 단일 활성 멤버십이 있으면 TenantContext 가 설정된다.
   *
   * <p>filter 의 finally 블록이 체인 실행 후 TenantContext 를 정리하므로, FilterChain.doFilter() 내부에서
   * AtomicReference 로 값을 캡처한다.
   */
  @Test
  void internalToken_singleMembership_setsTenantContext() throws Exception {
    when(membershipRepository.findActiveByUser(USER_ID))
        .thenReturn(List.of(new MembershipResponse(TENANT_ID, "Acme", "acme")));

    AtomicReference<Long> captured = new AtomicReference<>();
    FilterChain capturingChain = (req, res) -> captured.set(TenantContext.get());

    MockHttpServletRequest request = new MockHttpServletRequest();
    request.addHeader("Authorization", "Internal " + INTERNAL_TOKEN);
    request.addHeader("X-On-Behalf-Of", USER_ID.toString());

    filter.doFilter(request, new MockHttpServletResponse(), capturingChain);

    assertThat(captured.get())
        .as("Internal 토큰 경로 → 단일 멤버십 → TenantContext 설정 확인")
        .isEqualTo(TENANT_ID);
    // finally 블록 실행 후 ThreadLocal 은 정리돼야 함
    assertThat(TenantContext.get()).as("요청 완료 후 TenantContext 정리 확인 (스레드 풀 오염 방지)").isNull();
  }

  /**
   * 멤버십이 0건이면 TenantContext 를 설정하지 않는다(fail-closed).
   *
   * <p>미래에 멀티 소속 에이전트가 추가될 때도 동일 — 현재는 0/다중 → 미설정.
   */
  @Test
  void internalToken_noMembership_doesNotSetTenantContext() throws Exception {
    when(membershipRepository.findActiveByUser(USER_ID)).thenReturn(List.of());

    AtomicReference<Long> captured = new AtomicReference<>(Long.MIN_VALUE);
    FilterChain capturingChain = (req, res) -> captured.set(TenantContext.get());

    MockHttpServletRequest request = new MockHttpServletRequest();
    request.addHeader("Authorization", "Internal " + INTERNAL_TOKEN);
    request.addHeader("X-On-Behalf-Of", USER_ID.toString());

    filter.doFilter(request, new MockHttpServletResponse(), capturingChain);

    assertThat(captured.get()).as("멤버십 0건 → TenantContext 미설정 (fail-closed)").isNull();
  }

  /** 멤버십이 2건 이상이면 TenantContext 를 설정하지 않는다(멀티 소속 에이전트 P4 후속 처리 예정). */
  @Test
  void internalToken_multipleMemberships_doesNotSetTenantContext() throws Exception {
    when(membershipRepository.findActiveByUser(USER_ID))
        .thenReturn(
            List.of(
                new MembershipResponse(1L, "Acme", "acme"),
                new MembershipResponse(2L, "Beta", "beta")));

    AtomicReference<Long> captured = new AtomicReference<>(Long.MIN_VALUE);
    FilterChain capturingChain = (req, res) -> captured.set(TenantContext.get());

    MockHttpServletRequest request = new MockHttpServletRequest();
    request.addHeader("Authorization", "Internal " + INTERNAL_TOKEN);
    request.addHeader("X-On-Behalf-Of", USER_ID.toString());

    filter.doFilter(request, new MockHttpServletResponse(), capturingChain);

    assertThat(captured.get()).as("멤버십 다중 → TenantContext 미설정 (fail-closed)").isNull();
  }

  /** JWT Bearer 토큰 요청에서는 MembershipRepository 를 호출하지 않는다. (JWT 경로는 클레임에서 tenant 를 읽으므로) */
  @Test
  void bearerToken_doesNotCallMembershipRepository() throws Exception {
    when(jwtTokenProvider.validateAccessToken("valid.jwt.token")).thenReturn(true);
    when(jwtTokenProvider.getUserIdFromToken("valid.jwt.token")).thenReturn(USER_ID);
    when(jwtTokenProvider.getTenantIdFromToken("valid.jwt.token")).thenReturn(TENANT_ID);
    // WP-341: JWT 경로는 테넌트가 ACTIVE 일 때만 인증·TenantContext 를 세운다.
    when(tenantStatusChecker.isActive(TENANT_ID)).thenReturn(true);
    // WP-420: tenant 있는 JWT 는 멤버십 판정과 권한을 한 번에 얻는다 — ACTIVE 멤버(권한 없음).
    when(permissionService.getActiveMemberPermissions(USER_ID)).thenReturn(Optional.of(Set.of()));

    AtomicReference<Long> captured = new AtomicReference<>();
    FilterChain capturingChain = (req, res) -> captured.set(TenantContext.get());

    MockHttpServletRequest request = new MockHttpServletRequest();
    request.addHeader("Authorization", "Bearer valid.jwt.token");

    filter.doFilter(request, new MockHttpServletResponse(), capturingChain);

    assertThat(captured.get()).isEqualTo(TENANT_ID);
    // MembershipRepository 는 호출되지 않아야 함 (Mockito strict: 미설정 stub 호출 시 예외 발생)
  }

  /**
   * WP-420: 서명이 유효한 tenant 토큰이라도 그 tenant 멤버십이 ACTIVE 가 아니면(정지·비멤버) 인증을 세우지 않고(→ 401) TenantContext
   * 도 되돌린다 — 정지된 테넌트로 permitAll 엔드포인트가 실행되지 않게.
   */
  @Test
  void bearerToken_inactiveMembership_noAuthenticationAndNoTenantContext() throws Exception {
    when(jwtTokenProvider.validateAccessToken("valid.jwt.token")).thenReturn(true);
    when(jwtTokenProvider.getUserIdFromToken("valid.jwt.token")).thenReturn(USER_ID);
    when(jwtTokenProvider.getTenantIdFromToken("valid.jwt.token")).thenReturn(TENANT_ID);
    when(tenantStatusChecker.isActive(TENANT_ID)).thenReturn(true);
    when(permissionService.getActiveMemberPermissions(USER_ID)).thenReturn(Optional.empty());

    AtomicReference<Long> capturedTenant = new AtomicReference<>(Long.MIN_VALUE);
    AtomicReference<Object> capturedAuth = new AtomicReference<>("unset");
    FilterChain capturingChain =
        (req, res) -> {
          capturedTenant.set(TenantContext.get());
          capturedAuth.set(SecurityContextHolder.getContext().getAuthentication());
        };
    MockHttpServletRequest request = new MockHttpServletRequest();
    request.addHeader("Authorization", "Bearer valid.jwt.token");
    SecurityContextHolder.clearContext();
    filter.doFilter(request, new MockHttpServletResponse(), capturingChain);

    assertThat(capturedAuth.get()).as("정지된 멤버십 → 인증 미설정(401)").isNull();
    assertThat(capturedTenant.get()).as("정지된 멤버십 → TenantContext 되돌림").isNull();
  }

  /** 명시 테넌트 헤더가 에이전트의 ACTIVE 멤버십에 포함되면 그 테넌트로 설정. */
  @Test
  void internalToken_explicitTenant_member_setsRequestedTenant() throws Exception {
    when(membershipRepository.findActiveByUser(USER_ID))
        .thenReturn(
            List.of(
                new MembershipResponse(1L, "Acme", "acme"),
                new MembershipResponse(2L, "Beta", "beta")));
    AtomicReference<Long> captured = new AtomicReference<>();
    FilterChain capturingChain = (req, res) -> captured.set(TenantContext.get());
    MockHttpServletRequest request = new MockHttpServletRequest();
    request.addHeader("Authorization", "Internal " + INTERNAL_TOKEN);
    request.addHeader("X-On-Behalf-Of", USER_ID.toString());
    request.addHeader(AgentTenantResolver.TENANT_HEADER, "2");
    filter.doFilter(request, new MockHttpServletResponse(), capturingChain);
    assertThat(captured.get()).as("멀티 멤버십 + 명시 헤더(멤버) → 요청 테넌트 채택").isEqualTo(2L);
  }

  /** 명시 테넌트 헤더가 멤버십에 없으면 미설정(fail-closed) — 헤더 위조 차단. */
  @Test
  void internalToken_explicitTenant_notMember_failsClosed() throws Exception {
    when(membershipRepository.findActiveByUser(USER_ID))
        .thenReturn(List.of(new MembershipResponse(1L, "Acme", "acme")));
    AtomicReference<Long> captured = new AtomicReference<>(Long.MIN_VALUE);
    FilterChain capturingChain = (req, res) -> captured.set(TenantContext.get());
    MockHttpServletRequest request = new MockHttpServletRequest();
    request.addHeader("Authorization", "Internal " + INTERNAL_TOKEN);
    request.addHeader("X-On-Behalf-Of", USER_ID.toString());
    request.addHeader(AgentTenantResolver.TENANT_HEADER, "999");
    filter.doFilter(request, new MockHttpServletResponse(), capturingChain);
    assertThat(captured.get()).as("명시 헤더가 비멤버 테넌트 → 미설정 (fail-closed)").isNull();
  }

  /** 명시 테넌트 헤더가 단일 멤버십과 일치하면 그대로 설정. */
  @Test
  void internalToken_explicitTenant_singleMembershipMatch_setsTenant() throws Exception {
    when(membershipRepository.findActiveByUser(USER_ID))
        .thenReturn(List.of(new MembershipResponse(1L, "Acme", "acme")));
    AtomicReference<Long> captured = new AtomicReference<>();
    FilterChain capturingChain = (req, res) -> captured.set(TenantContext.get());
    MockHttpServletRequest request = new MockHttpServletRequest();
    request.addHeader("Authorization", "Internal " + INTERNAL_TOKEN);
    request.addHeader("X-On-Behalf-Of", USER_ID.toString());
    request.addHeader(AgentTenantResolver.TENANT_HEADER, "1");
    filter.doFilter(request, new MockHttpServletResponse(), capturingChain);
    assertThat(captured.get()).isEqualTo(1L);
  }

  /** 잘못된(숫자 아님) 명시 헤더는 미설정(fail-closed). */
  @Test
  void internalToken_explicitTenant_malformed_failsClosed() throws Exception {
    when(membershipRepository.findActiveByUser(USER_ID))
        .thenReturn(List.of(new MembershipResponse(1L, "Acme", "acme")));
    AtomicReference<Long> captured = new AtomicReference<>(Long.MIN_VALUE);
    FilterChain capturingChain = (req, res) -> captured.set(TenantContext.get());
    MockHttpServletRequest request = new MockHttpServletRequest();
    request.addHeader("Authorization", "Internal " + INTERNAL_TOKEN);
    request.addHeader("X-On-Behalf-Of", USER_ID.toString());
    request.addHeader(AgentTenantResolver.TENANT_HEADER, "abc");
    filter.doFilter(request, new MockHttpServletResponse(), capturingChain);
    assertThat(captured.get()).as("malformed 헤더 → 미설정 (fail-closed)").isNull();
  }
}
