package com.workplace.platform;

import static com.workplace.jooq.Tables.PLATFORM_ROLE;
import static com.workplace.jooq.Tables.PLATFORM_USER_ROLE;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.platform.dto.PlatformUserLookupResponse;
import com.workplace.platform.service.PlatformUserService;
import com.workplace.support.IntegrationTestBase;
import java.util.Optional;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** 운영자 콘솔 — 전역 사용자 이메일 조회 서비스 통합 테스트. */
@Transactional
class PlatformUserServiceTest extends IntegrationTestBase {

  @Autowired PlatformUserService service;
  @Autowired DSLContext dsl;

  /** HUMAN 사용자 시드. id 반환. */
  private long createHumanUser(String prefix, String email) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, prefix + "-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, email)
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    return id;
  }

  @Test
  void lookupByEmail_found_returnsUser() {
    String email = "lookup-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
    long userId = createHumanUser("찾음", email);

    Optional<PlatformUserLookupResponse> result = service.lookupByEmail(email);

    assertThat(result).isPresent();
    assertThat(result.get().userId()).isEqualTo(userId);
    assertThat(result.get().email()).isEqualTo(email);
    assertThat(result.get().isPlatformAdmin()).isFalse();
  }

  @Test
  void lookupByEmail_caseInsensitive_returnsUser() {
    String email = "case-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
    createHumanUser("케이스", email);

    Optional<PlatformUserLookupResponse> result = service.lookupByEmail(email.toUpperCase());

    assertThat(result).isPresent();
  }

  @Test
  void lookupByEmail_notFound_returnsEmpty() {
    Optional<PlatformUserLookupResponse> result =
        service.lookupByEmail("nobody-" + UUID.randomUUID() + "@example.com");

    assertThat(result).isEmpty();
  }

  @Test
  void lookupByEmail_platformOperator_flagTrue() {
    String email = "op-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
    long userId = createHumanUser("운영자", email);
    Long superAdminRoleId =
        dsl.select(PLATFORM_ROLE.ID)
            .from(PLATFORM_ROLE)
            .where(PLATFORM_ROLE.NAME.eq("SUPER_ADMIN"))
            .fetchOne(PLATFORM_ROLE.ID);
    dsl.insertInto(PLATFORM_USER_ROLE)
        .set(PLATFORM_USER_ROLE.USER_ID, userId)
        .set(PLATFORM_USER_ROLE.PLATFORM_ROLE_ID, superAdminRoleId)
        .execute();

    Optional<PlatformUserLookupResponse> result = service.lookupByEmail(email);

    assertThat(result).isPresent();
    assertThat(result.get().isPlatformAdmin()).isTrue();
  }
}
