package com.workplace.auth;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.LOGIN_ATTEMPTS;
import static com.workplace.jooq.Tables.PLATFORM_USER_ROLE;
import static com.workplace.jooq.Tables.REFRESH_TOKEN;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.auth.dto.LoginRequest;
import com.workplace.auth.exception.InvalidTokenException;
import com.workplace.auth.service.AuthService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.platform.dto.PlatformLoginRequest;
import com.workplace.platform.repository.PlatformRoleRepository;
import com.workplace.platform.service.PlatformAuthService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.LocalDateTime;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.crypto.password.PasswordEncoder;

/**
 * refresh 토큰 재사용(탈취 의심)을 감지하면 family 전체 폐기가 실제로 커밋되는지(WP-819).
 *
 * <p>갱신은 {@code @Transactional} 이고 재사용을 감지하면 family 를 폐기한 뒤 401 예외를 던진다. 예외로 트랜잭션이 롤백되면 폐기도 사라져, 훔친
 * 토큰으로 먼저 받은 새 토큰이 계속 갱신된다. 테스트 트랜잭션 안에서는 롤백이 테스트 끝까지 미뤄져 드러나지 않으므로, 이 클래스는 트랜잭션 없이 각 호출이 스스로
 * 커밋·롤백하게 둔다.
 */
class RefreshTokenReuseRevocationTest extends IntegrationTestBase {

  private static final String PASSWORD = "Password123";
  private static final String REUSED = "이미 사용된 토큰입니다. 다시 로그인해 주세요.";

  @Autowired private AuthService authService;
  @Autowired private PlatformAuthService platformAuthService;
  @Autowired private PasswordEncoder passwordEncoder;
  @Autowired private PlatformRoleRepository platformRoleRepository;

  private TestFixtures.LoginableHuman user;

  @BeforeEach
  void seed() {
    user = TestFixtures.createLoginableHuman(baseDsl, passwordEncoder.encode(PASSWORD));
  }

  @AfterEach
  void cleanup() {
    TenantContext.clear();
    baseDsl.deleteFrom(LOGIN_ATTEMPTS).where(LOGIN_ATTEMPTS.USERNAME.eq(user.username())).execute();
    baseDsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.eq(user.id())).execute();
    baseDsl.deleteFrom(REFRESH_TOKEN).where(REFRESH_TOKEN.USER_ID.eq(user.id())).execute();
    baseDsl
        .deleteFrom(PLATFORM_USER_ROLE)
        .where(PLATFORM_USER_ROLE.USER_ID.eq(user.id()))
        .execute();
    baseDsl.deleteFrom(USER).where(USER.ID.eq(user.id())).execute();
  }

  @Test
  void 재사용을_감지하면_훔친_토큰으로_받은_새_토큰도_더는_갱신되지_않는다() {
    String stolen = authService.login(new LoginRequest(user.username(), PASSWORD)).refreshToken();
    String attackerNext = authService.refresh(stolen).refreshToken(); // 공격자가 먼저 회전
    expireGrace();

    assertThatThrownBy(() -> authService.refresh(stolen)) // 피해자가 쓰인 토큰으로 갱신 → 탈취 감지
        .isInstanceOf(InvalidTokenException.class)
        .hasMessage(REUSED);

    assertThat(liveTokens()).isZero();
    assertThatThrownBy(() -> authService.refresh(attackerNext))
        .isInstanceOf(InvalidTokenException.class);
  }

  @Test
  void 운영자_토큰도_재사용을_감지하면_family_전체가_폐기된다() {
    platformRoleRepository.assignSuperAdmin(user.id());
    String stolen =
        platformAuthService
            .login(new PlatformLoginRequest(user.username(), PASSWORD))
            .refreshToken();
    String attackerNext = platformAuthService.refresh(stolen).refreshToken();
    expireGrace();

    assertThatThrownBy(() -> platformAuthService.refresh(stolen))
        .isInstanceOf(InvalidTokenException.class)
        .hasMessage(REUSED);

    assertThat(liveTokens()).isZero();
    assertThatThrownBy(() -> platformAuthService.refresh(attackerNext))
        .isInstanceOf(InvalidTokenException.class);
  }

  /** 이 사용자의 폐기된 토큰 revoked_at 을 grace 밖(1시간 전)으로 당긴다 — 진짜 탈취 시나리오를 sleep 없이 재현. */
  private void expireGrace() {
    baseDsl
        .update(REFRESH_TOKEN)
        .set(REFRESH_TOKEN.REVOKED_AT, LocalDateTime.now().minusHours(1))
        .where(REFRESH_TOKEN.USER_ID.eq(user.id()))
        .and(REFRESH_TOKEN.REVOKED.isTrue())
        .execute();
  }

  /** 이 사용자의 아직 폐기되지 않은 refresh 토큰 수. */
  private int liveTokens() {
    return baseDsl.fetchCount(
        REFRESH_TOKEN, REFRESH_TOKEN.USER_ID.eq(user.id()).and(REFRESH_TOKEN.REVOKED.isFalse()));
  }
}
