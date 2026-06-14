package com.workplace.platform;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.platform.repository.PlatformRoleRepository;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** PlatformRoleRepository — SUPER_ADMIN 부여 후 보유/권한코드 조회를 검증한다. */
@Transactional
class PlatformRoleRepositoryTest extends IntegrationTestBase {

  @Autowired PlatformRoleRepository platformRoleRepository;
  @Autowired DSLContext dsl;

  private Long createUser() {
    String username = "pr-" + UUID.randomUUID().toString().substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, username)
        .set(USER.PASSWORD, "x")
        .set(USER.NAME, "pr")
        .set(USER.EMAIL, username + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void noPlatformRole_hasAnyIsFalse() {
    Long userId = createUser();
    assertThat(platformRoleRepository.hasAnyPlatformRole(userId)).isFalse();
    assertThat(platformRoleRepository.findPermissionCodes(userId)).isEmpty();
  }

  @Test
  void assignSuperAdmin_grantsRoleAndAllPlatformPermissions() {
    Long userId = createUser();
    platformRoleRepository.assignSuperAdmin(userId);

    assertThat(platformRoleRepository.hasAnyPlatformRole(userId)).isTrue();
    assertThat(platformRoleRepository.findPermissionCodes(userId))
        .contains(
            "platform:tenant:create",
            "platform:tenant:read",
            "platform:tenant:suspend",
            "platform:member:read");
  }

  @Test
  void assignSuperAdmin_isIdempotent() {
    Long userId = createUser();
    platformRoleRepository.assignSuperAdmin(userId);
    platformRoleRepository.assignSuperAdmin(userId); // 중복 호출 — 예외 없이 무시
    assertThat(platformRoleRepository.hasAnyPlatformRole(userId)).isTrue();
  }
}
