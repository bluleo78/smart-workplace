package com.workplace.global.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.global.tenant.TenantContext;
import com.workplace.permission.service.PermissionService;
import com.workplace.tenant.dto.MembershipResponse;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.user.dto.UserKind;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.repository.UserRepository;
import jakarta.servlet.FilterChain;
import java.time.LocalDateTime;
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

/**
 * ApiKeyAuthenticationFilter 의 AGENT(`Bearer ak_...`) 경로가 TenantContext 를 올바르게 설정/미설정함을 검증.
 *
 * <p>JwtAuthenticationFilterTenantTest(Internal 경로)의 미러. 해시 재계산을 피하기 위해 {@code
 * findActiveByHash(anyString())} 를 lenient 스텁으로 고정 키를 반환하고, 평문 키는 prefix 검사를 통과하도록 {@code Bearer
 * ak_test} 로 둔다. 세션 GUC 기본값(application-test.yml)이 TenantContext 부재를 은폐하므로 직접 ThreadLocal 을 검사한다.
 */
@ExtendWith(MockitoExtension.class)
class ApiKeyAuthenticationFilterTenantTest {

  private static final String PLAINTEXT_KEY = "ak_test";
  private static final Long KEY_ID = 7L;
  private static final Long USER_ID = 42L;
  private static final Long TENANT_ID = 1L;

  @Mock private AgentApiKeyRepository agentApiKeyRepository;
  @Mock private UserRepository userRepository;
  @Mock private PermissionService permissionService;
  @Mock private MembershipRepository membershipRepository;

  private ApiKeyAuthenticationFilter filter;

  @BeforeEach
  void setUp() {
    filter =
        new ApiKeyAuthenticationFilter(
            agentApiKeyRepository, userRepository, permissionService, membershipRepository);
    // 해시 재계산을 피하려고 모든 해시에 동일 활성 키 반환 (lenient — JWT 경로 미사용 테스트가 없으므로 사실상 항상 히트).
    lenient()
        .when(agentApiKeyRepository.findActiveByHash(anyString()))
        .thenReturn(Optional.of(new AgentApiKeyRepository.ActiveKey(KEY_ID, USER_ID)));
    // 대상 유저는 AGENT.
    lenient().when(userRepository.findById(USER_ID)).thenReturn(Optional.of(agentUser()));
    // 권한 조회는 빈 Set 으로 충분 (테스트 대상은 TenantContext).
    lenient().when(permissionService.getUserPermissions(USER_ID)).thenReturn(Set.of());
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
  }

  /** kind=AGENT 인 UserResponse 픽스처. */
  private static UserResponse agentUser() {
    return new UserResponse(
        USER_ID,
        "agent-bot",
        "agent@bot.local",
        "Agent Bot",
        true,
        LocalDateTime.now(),
        UserKind.AGENT);
  }

  private static MockHttpServletRequest apiKeyRequest() {
    MockHttpServletRequest request = new MockHttpServletRequest();
    request.addHeader("Authorization", "Bearer " + PLAINTEXT_KEY);
    return request;
  }

  /** 단일 활성 멤버십 + 헤더 없음 → 그 테넌트로 TenantContext 설정. */
  @Test
  void apiKey_singleMembership_setsTenantContext() throws Exception {
    when(membershipRepository.findActiveByUser(USER_ID))
        .thenReturn(List.of(new MembershipResponse(TENANT_ID, "Acme", "acme")));

    AtomicReference<Long> captured = new AtomicReference<>();
    FilterChain capturingChain = (req, res) -> captured.set(TenantContext.get());

    filter.doFilter(apiKeyRequest(), new MockHttpServletResponse(), capturingChain);

    assertThat(captured.get()).as("API 키 경로 → 단일 멤버십 → TenantContext 설정 확인").isEqualTo(TENANT_ID);
    // finally 블록 실행 후 ThreadLocal 은 정리돼야 함
    assertThat(TenantContext.get()).as("요청 완료 후 TenantContext 정리 확인 (스레드 풀 오염 방지)").isNull();
  }

  /** 멀티 멤버십 + 명시 헤더(멤버) → 요청 테넌트 채택. */
  @Test
  void apiKey_explicitTenant_member_setsRequestedTenant() throws Exception {
    when(membershipRepository.findActiveByUser(USER_ID))
        .thenReturn(
            List.of(
                new MembershipResponse(1L, "Acme", "acme"),
                new MembershipResponse(2L, "Beta", "beta")));

    AtomicReference<Long> captured = new AtomicReference<>();
    FilterChain capturingChain = (req, res) -> captured.set(TenantContext.get());

    MockHttpServletRequest request = apiKeyRequest();
    request.addHeader(AgentTenantResolver.TENANT_HEADER, "2");

    filter.doFilter(request, new MockHttpServletResponse(), capturingChain);

    assertThat(captured.get()).as("멀티 멤버십 + 명시 헤더(멤버) → 요청 테넌트 채택").isEqualTo(2L);
  }

  /** 명시 헤더가 비멤버 테넌트 → 미설정 (fail-closed, 헤더 위조 차단). */
  @Test
  void apiKey_explicitTenant_notMember_failsClosed() throws Exception {
    when(membershipRepository.findActiveByUser(USER_ID))
        .thenReturn(List.of(new MembershipResponse(1L, "Acme", "acme")));

    AtomicReference<Long> captured = new AtomicReference<>(Long.MIN_VALUE);
    FilterChain capturingChain = (req, res) -> captured.set(TenantContext.get());

    MockHttpServletRequest request = apiKeyRequest();
    request.addHeader(AgentTenantResolver.TENANT_HEADER, "999");

    filter.doFilter(request, new MockHttpServletResponse(), capturingChain);

    assertThat(captured.get()).as("명시 헤더가 비멤버 테넌트 → 미설정 (fail-closed)").isNull();
  }

  /** 멤버십 다중 + 헤더 없음 → 미설정 (fail-closed). */
  @Test
  void apiKey_multipleMemberships_noHeader_failsClosed() throws Exception {
    when(membershipRepository.findActiveByUser(USER_ID))
        .thenReturn(
            List.of(
                new MembershipResponse(1L, "Acme", "acme"),
                new MembershipResponse(2L, "Beta", "beta")));

    AtomicReference<Long> captured = new AtomicReference<>(Long.MIN_VALUE);
    FilterChain capturingChain = (req, res) -> captured.set(TenantContext.get());

    filter.doFilter(apiKeyRequest(), new MockHttpServletResponse(), capturingChain);

    assertThat(captured.get()).as("멤버십 다중 + 헤더 없음 → 미설정 (fail-closed)").isNull();
  }
}
