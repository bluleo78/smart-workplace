package com.workplace.user.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.auth.dto.LoginRequest;
import com.workplace.auth.exception.TenantAccessDeniedException;
import com.workplace.auth.service.AuthService;
import com.workplace.global.security.AuthDetails;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.tenant.dto.MembershipResponse;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.user.dto.UserKind;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ClassPathResource;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-417 V181 — 전역 비활성 사람 계정을 소속 워크스페이스 멤버십 정지로 옮기는 이관. Flyway 는 이미 돌았으므로 마이그레이션 파일의 마커 사이 문장을 시드
 * 위에 다시 돌려 본다(같은 문장을 테스트한다 — AiMemoryCleanupMigrationTest 와 같은 방식). @Transactional 롤백으로 시드와 이관 결과는
 * 남지 않는다.
 */
@Transactional
class GlobalInactiveToSuspendMigrationTest extends IntegrationTestBase {

  private static final String PASSWORD = "Password123";

  @Autowired private DSLContext dsl;
  @Autowired private UserService userService;
  @Autowired private AuthService authService;
  @Autowired private MembershipRepository membershipRepository;
  @Autowired private PasswordEncoder passwordEncoder;

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  /** V181 의 이관 블록 — `-- @wp417-migrate-begin` 과 `-- @wp417-migrate-end` 사이의 DO 블록 하나. */
  private static String migrationBlock() throws IOException {
    String all =
        new ClassPathResource("db/migration/V181__wp417_global_inactive_to_membership_suspend.sql")
            .getContentAsString(StandardCharsets.UTF_8);
    int begin = all.indexOf("-- @wp417-migrate-begin");
    int end = all.indexOf("-- @wp417-migrate-end");
    return all.substring(all.indexOf('\n', begin) + 1, end).strip();
  }

  /** 블록을 JDBC 로 그대로 실행한다 — jOOQ 평문 SQL 의 바인드·템플릿 해석({}·?)을 거치지 않게. 테스트 트랜잭션의 같은 커넥션. */
  private void runMigration() throws IOException {
    String block = migrationBlock();
    dsl.connection(
        c -> {
          try (var st = c.createStatement()) {
            st.execute(block);
          }
        });
  }

  private long seedUser(String kind, String username, boolean active) {
    return dsl.insertInto(USER)
        .set(USER.USERNAME, username)
        .set(USER.NAME, username)
        .set(USER.EMAIL, username)
        .set(USER.PASSWORD, UserKind.HUMAN.equals(kind) ? passwordEncoder.encode(PASSWORD) : null)
        .set(USER.KIND, kind)
        .set(USER.IS_ACTIVE, active)
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  private static String uniqueName(String prefix) {
    return prefix + "-" + UUID.randomUUID().toString().substring(0, 12) + "@ex.com";
  }

  private boolean globalActive(long userId) {
    return Boolean.TRUE.equals(
        dsl.select(USER.IS_ACTIVE).from(USER).where(USER.ID.eq(userId)).fetchOne(USER.IS_ACTIVE));
  }

  private String status(long userId, long tenantId) {
    return TestFixtures.membershipStatus(dsl, userId, tenantId);
  }

  @Test
  void globalInactiveHuman_becomesActiveWithAllMembershipsSuspended_agentUntouched_idempotent()
      throws IOException {
    long tenantA = TestFixtures.createTenant(dsl, "ACTIVE");
    long tenantB = TestFixtures.createTenant(dsl, "ACTIVE");
    long human = seedUser(UserKind.HUMAN, uniqueName("wp417m-h"), false);
    membershipRepository.create(human, tenantA, "ACTIVE");
    membershipRepository.create(human, tenantB, "ACTIVE");
    // V163 고아 정리처럼 꺼진 AGENT — 이관 대상이 아니다.
    long agent = seedUser(UserKind.AGENT, uniqueName("wp417m-a"), false);
    membershipRepository.create(agent, tenantA, "ACTIVE");
    // 이미 활성인 사람은 그대로.
    long activeHuman = seedUser(UserKind.HUMAN, uniqueName("wp417m-ok"), true);
    membershipRepository.create(activeHuman, tenantA, "ACTIVE");
    // 멤버십이 하나도 없는 전역 비활성 사람(퇴사자·보안 사고 계정 등) — 옮길 정지가 없으니 다시 켜면 안 된다.
    long orphanHuman = seedUser(UserKind.HUMAN, uniqueName("wp417m-o"), false);

    runMigration();
    assertThat(globalActive(orphanHuman)).isFalse();

    assertThat(globalActive(human)).isTrue();
    assertThat(status(human, tenantA)).isEqualTo("SUSPENDED");
    assertThat(status(human, tenantB)).isEqualTo("SUSPENDED");
    assertThat(globalActive(agent)).isFalse();
    assertThat(status(agent, tenantA)).isEqualTo("ACTIVE");
    assertThat(globalActive(activeHuman)).isTrue();
    assertThat(status(activeHuman, tenantA)).isEqualTo("ACTIVE");

    // 멱등 — 다시 돌려도 결과가 같다(이미 활성으로 돌아온 사람의 멤버십을 또 건드리지 않는다).
    runMigration();
    assertThat(globalActive(human)).isTrue();
    assertThat(status(human, tenantA)).isEqualTo("SUSPENDED");
    assertThat(status(human, tenantB)).isEqualTo("SUSPENDED");
    assertThat(globalActive(agent)).isFalse();
    assertThat(status(agent, tenantA)).isEqualTo("ACTIVE");
    assertThat(status(activeHuman, tenantA)).isEqualTo("ACTIVE");
    assertThat(globalActive(orphanHuman)).isFalse();
  }

  @Test
  void afterMigration_reactivationInOneWorkspace_opensOnlyThatWorkspace() throws IOException {
    long tenantA = TestFixtures.createTenant(dsl, "ACTIVE");
    long tenantB = TestFixtures.createTenant(dsl, "ACTIVE");
    String username = uniqueName("wp417m-r");
    long human = seedUser(UserKind.HUMAN, username, false);
    membershipRepository.create(human, tenantA, "ACTIVE");
    membershipRepository.create(human, tenantB, "ACTIVE");

    runMigration();

    // 이관 직후: 로그인은 되지만(전역 활성) 선택 가능한 워크스페이스는 없다 — 이관 전과 같은 접근 범위.
    assertThat(authService.login(new LoginRequest(username, PASSWORD)).memberships()).isEmpty();

    // T_A 관리자가 사용자 상세에서 다시 켬 → T_A 만 로그인·선택 가능, T_B 는 여전히 정지.
    useTenant(tenantA);
    userService.setUserActive(human, true, null);

    var login = authService.login(new LoginRequest(username, PASSWORD));
    assertThat(login.memberships().stream().map(MembershipResponse::tenantId).toList())
        .containsExactly(tenantA);
    assertThat(authService.selectTenant(human, tenantA, AuthDetails.PASSWORD).accessToken())
        .isNotBlank();
    assertThatThrownBy(() -> authService.selectTenant(human, tenantB, AuthDetails.PASSWORD))
        .isInstanceOf(TenantAccessDeniedException.class);
  }
}
