package com.workplace.global.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

import com.workplace.auth.repository.UserApiTokenRepository;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.tenant.TenantStatusChecker;
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
import org.springframework.security.core.context.SecurityContextHolder;

/**
 * UserTokenAuthenticationFilter(PAT) 의 테넌트 상태 검사 단위 테스트(WP-341) — 토큰이 유효하고 멤버십이 ACTIVE 여도 토큰의 테넌트가
 * 비활성이면 인증하지 않는다(정지·삭제된 테넌트로 PAT 가 계속 통하는 것을 막는다).
 */
@ExtendWith(MockitoExtension.class)
class UserTokenAuthenticationFilterTenantStatusTest {

  private static final Long USER_ID = 42L;
  private static final Long TENANT_ID = 9L;

  @Mock private UserApiTokenRepository userApiTokenRepository;
  @Mock private UserRepository userRepository;
  @Mock private PermissionService permissionService;
  @Mock private MembershipRepository membershipRepository;
  @Mock private TenantStatusChecker tenantStatusChecker;

  private UserTokenAuthenticationFilter filter;

  @BeforeEach
  void setUp() {
    // 같은 스레드에서 먼저 돈 다른 테스트의 인증이 남아 있을 수 있어 비운 채로 시작한다.
    SecurityContextHolder.clearContext();
    filter =
        new UserTokenAuthenticationFilter(
            userApiTokenRepository,
            userRepository,
            permissionService,
            membershipRepository,
            tenantStatusChecker);
    lenient()
        .when(userApiTokenRepository.findActiveByHash(anyString()))
        .thenReturn(Optional.of(new UserApiTokenRepository.ActiveToken(7L, USER_ID, TENANT_ID)));
    lenient()
        .when(userRepository.findById(USER_ID))
        .thenReturn(
            Optional.of(
                new UserResponse(
                    USER_ID,
                    "human",
                    "h@x.local",
                    "Human",
                    true,
                    LocalDateTime.now(),
                    UserKind.HUMAN)));
    lenient()
        .when(membershipRepository.findActiveByUser(USER_ID))
        .thenReturn(List.of(new MembershipResponse(TENANT_ID, "Acme", "acme")));
    lenient().when(permissionService.getUserPermissions(USER_ID)).thenReturn(Set.of());
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
    SecurityContextHolder.clearContext();
  }

  private static MockHttpServletRequest patRequest() {
    MockHttpServletRequest request = new MockHttpServletRequest();
    request.addHeader("Authorization", "Bearer swp_test");
    return request;
  }

  @Test
  void activeTenant_authenticated() throws Exception {
    when(tenantStatusChecker.isActive(TENANT_ID)).thenReturn(true);
    AtomicReference<Object> auth = new AtomicReference<>();
    FilterChain chain =
        (req, res) -> auth.set(SecurityContextHolder.getContext().getAuthentication());

    filter.doFilter(patRequest(), new MockHttpServletResponse(), chain);

    assertThat(auth.get()).isNotNull();
  }

  @Test
  void inactiveTenant_notAuthenticated() throws Exception {
    when(tenantStatusChecker.isActive(TENANT_ID)).thenReturn(false);
    AtomicReference<Object> auth = new AtomicReference<>();
    AtomicReference<Long> tenant = new AtomicReference<>(Long.MIN_VALUE);
    FilterChain chain =
        (req, res) -> {
          auth.set(SecurityContextHolder.getContext().getAuthentication());
          tenant.set(TenantContext.get());
        };

    filter.doFilter(patRequest(), new MockHttpServletResponse(), chain);

    assertThat(auth.get()).as("비활성 테넌트 → 인증 미설정(401)").isNull();
    assertThat(tenant.get()).as("비활성 테넌트 → TenantContext 미설정").isNull();
  }
}
