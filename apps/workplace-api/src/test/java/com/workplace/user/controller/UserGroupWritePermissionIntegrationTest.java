package com.workplace.user.controller;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER_GROUP;
import static com.workplace.jooq.Tables.USER_GROUP_MEMBER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * 사용자 그룹 쓰기 권한 전 구간(HTTP) 통합 테스트(#839).
 *
 * <p>UserGroupController 는 클래스 레벨 contact:read 만 걸려 있다 — 개인 그룹은 일반 구성원도 만들 수 있어야 하므로 의도된 것이고, 쓰기
 * 인가는 서비스가 visibility 별로 한다(SHARED=user-group:manage, PERSONAL=소유자). 슬라이스 테스트는 서비스를 목으로 대체해 이 경로를 못
 * 보므로, 실제 보안 체인·서비스·예외 매핑을 통과시켜 "manage 권한 없는 일반 구성원의 공유 그룹 쓰기 = 403, 남의 개인 그룹 = 404(존재 은닉)" 를
 * 고정한다. AI 도구(MCP)가 그룹 쓰기를 노출하면서 이 서버 경계가 유일한 방어선이 된다.
 */
@Transactional
class UserGroupWritePermissionIntegrationTest extends IntegrationTestBase {

  @Autowired MockMvc mockMvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;

  /** USER 역할(contact:read 보유, user-group:manage 미보유) 일반 구성원. */
  private long plain;

  /** 공유 그룹 소유 경계가 없으므로 ADMIN 이 만든 SHARED 그룹을 대상으로 쓴다. */
  private long sharedGroup;

  /** 다른 사용자의 개인 그룹. */
  private long othersPersonal;

  @BeforeEach
  void setUp() {
    plain = seedHuman("USER");
    long other = seedHuman("USER");
    sharedGroup = seedGroup("공유-" + suffix(), "SHARED", null);
    othersPersonal = seedGroup("개인-" + suffix(), "PERSONAL", other);
  }

  private static String suffix() {
    return UUID.randomUUID().toString().substring(0, 8);
  }

  /** HUMAN 유저 + 지정 역할 + 테넌트#1 ACTIVE 멤버십. */
  private long seedHuman(String roleName) {
    long id = TestFixtures.createHuman(dsl);
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq(roleName)).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, id)
        .set(MEMBERSHIP.TENANT_ID, 1L)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    return id;
  }

  private long seedGroup(String name, String visibility, Long ownerId) {
    return dsl.insertInto(USER_GROUP)
        .set(USER_GROUP.NAME, name)
        .set(USER_GROUP.VISIBILITY, visibility)
        .set(USER_GROUP.OWNER_ID, ownerId)
        .returning(USER_GROUP.ID)
        .fetchOne()
        .getId();
  }

  private String bearer(long userId) {
    return "Bearer " + jwtTokenProvider.generateAccessToken(userId, "user-" + userId);
  }

  @Test
  void createShared_byPlainUser_returns403() throws Exception {
    mockMvc
        .perform(
            post("/api/v1/user-groups")
                .header("Authorization", bearer(plain))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"새 공유\",\"visibility\":\"SHARED\"}"))
        .andExpect(status().isForbidden());
  }

  @Test
  void createPersonal_byPlainUser_returns201() throws Exception {
    mockMvc
        .perform(
            post("/api/v1/user-groups")
                .header("Authorization", bearer(plain))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"내 그룹 " + suffix() + "\",\"visibility\":\"PERSONAL\"}"))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.ownerId").value(plain));
  }

  @Test
  void updateShared_byPlainUser_returns403() throws Exception {
    mockMvc
        .perform(
            patch("/api/v1/user-groups/" + sharedGroup)
                .header("Authorization", bearer(plain))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"바꿈\"}"))
        .andExpect(status().isForbidden());
  }

  @Test
  void deleteShared_byPlainUser_returns403_andGroupSurvives() throws Exception {
    mockMvc
        .perform(
            delete("/api/v1/user-groups/" + sharedGroup).header("Authorization", bearer(plain)))
        .andExpect(status().isForbidden());
    assertThat(dsl.fetchExists(USER_GROUP, USER_GROUP.ID.eq(sharedGroup))).isTrue();
  }

  @Test
  void addMemberToShared_byPlainUser_returns403() throws Exception {
    mockMvc
        .perform(
            post("/api/v1/user-groups/" + sharedGroup + "/members")
                .header("Authorization", bearer(plain))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"targetType\":\"MEMBER\",\"targetId\":" + plain + "}"))
        .andExpect(status().isForbidden());
    assertThat(dsl.fetchExists(USER_GROUP_MEMBER, USER_GROUP_MEMBER.GROUP_ID.eq(sharedGroup)))
        .isFalse();
  }

  @Test
  void removeMemberFromShared_byPlainUser_returns403_andMembershipSurvives() throws Exception {
    dsl.insertInto(USER_GROUP_MEMBER)
        .set(USER_GROUP_MEMBER.GROUP_ID, sharedGroup)
        .set(USER_GROUP_MEMBER.TARGET_TYPE, "MEMBER")
        .set(USER_GROUP_MEMBER.TARGET_ID, plain)
        .execute();
    mockMvc
        .perform(
            delete("/api/v1/user-groups/" + sharedGroup + "/members/MEMBER/" + plain)
                .header("Authorization", bearer(plain)))
        .andExpect(status().isForbidden());
    assertThat(dsl.fetchExists(USER_GROUP_MEMBER, USER_GROUP_MEMBER.GROUP_ID.eq(sharedGroup)))
        .isTrue();
  }

  @Test
  void deleteOthersPersonal_byPlainUser_returns404_existenceHidden() throws Exception {
    mockMvc
        .perform(
            delete("/api/v1/user-groups/" + othersPersonal).header("Authorization", bearer(plain)))
        .andExpect(status().isNotFound());
    assertThat(dsl.fetchExists(USER_GROUP, USER_GROUP.ID.eq(othersPersonal))).isTrue();
  }

  @Test
  void deleteShared_byAdmin_returns204() throws Exception {
    long admin = seedHuman("ADMIN");
    mockMvc
        .perform(
            delete("/api/v1/user-groups/" + sharedGroup).header("Authorization", bearer(admin)))
        .andExpect(status().isNoContent());
    assertThat(dsl.fetchExists(USER_GROUP, USER_GROUP.ID.eq(sharedGroup))).isFalse();
  }
}
