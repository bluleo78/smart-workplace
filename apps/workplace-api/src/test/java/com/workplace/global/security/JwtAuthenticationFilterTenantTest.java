package com.workplace.global.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import com.workplace.global.tenant.TenantContext;
import com.workplace.tenant.dto.MembershipResponse;
import com.workplace.tenant.repository.MembershipRepository;
import jakarta.servlet.FilterChain;
import java.util.List;
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

  private JwtAuthenticationFilter filter;

  @BeforeEach
  void setUp() {
    filter =
        new JwtAuthenticationFilter(
            jwtTokenProvider, permissionService, membershipRepository, INTERNAL_TOKEN);
    // 권한 조회는 빈 Set 반환으로 충분 (테스트 대상은 TenantContext)
    when(permissionService.getUserPermissions(USER_ID)).thenReturn(Set.of());
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
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
    when(permissionService.getUserPermissions(USER_ID)).thenReturn(Set.of());

    AtomicReference<Long> captured = new AtomicReference<>();
    FilterChain capturingChain = (req, res) -> captured.set(TenantContext.get());

    MockHttpServletRequest request = new MockHttpServletRequest();
    request.addHeader("Authorization", "Bearer valid.jwt.token");

    filter.doFilter(request, new MockHttpServletResponse(), capturingChain);

    assertThat(captured.get()).isEqualTo(TENANT_ID);
    // MembershipRepository 는 호출되지 않아야 함 (Mockito strict: 미설정 stub 호출 시 예외 발생)
  }
}
