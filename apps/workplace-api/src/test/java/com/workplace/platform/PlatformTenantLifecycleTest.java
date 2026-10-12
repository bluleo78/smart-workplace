package com.workplace.platform;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.platform.dto.CreateTenantRequest;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;

/**
 * 운영자 콘솔 테넌트 생애주기(삭제·복원·영구 삭제 요청) 통합 테스트 (WP-341).
 *
 * <p>상태 전환 규칙: ACTIVE/SUSPENDED → DELETED(삭제), DELETED → ACTIVE(복원), DELETED → PURGING(영구 삭제 요청).
 * 허용되지 않는 전환은 409, 없는 테넌트는 404, 확인 이름 불일치는 400 이어야 한다.
 *
 * <p>⚠️ 클래스 레벨 {@code @Transactional} — 공유 test DB 오염 방지(PlatformTenantControllerTest 와 동일).
 */
@Transactional
class PlatformTenantLifecycleTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired ObjectMapper objectMapper;
  @Autowired JwtTokenProvider jwtTokenProvider;

  /** HUMAN 사용자 시드. id 반환. */
  private long createHumanUser(String prefix) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, prefix + "-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + "-" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    return id;
  }

  /** 운영자(플랫폼) 토큰 — ROLE_PLATFORM 게이트 통과용. */
  private String platformToken() {
    long operator = createHumanUser("operator");
    return jwtTokenProvider.generatePlatformAccessToken(operator, "operator");
  }

  /** 테넌트 생성 API 로 ACTIVE 테넌트를 만들고 id 반환. */
  private long createTenant(String auth, String name) throws Exception {
    String body = objectMapper.writeValueAsString(new CreateTenantRequest(name, null, null));
    String res =
        mvc.perform(
                post("/api/platform/tenants")
                    .header("Authorization", auth)
                    .contentType("application/json")
                    .content(body))
            .andExpect(status().isCreated())
            .andReturn()
            .getResponse()
            .getContentAsString();
    return objectMapper.readTree(res).get("id").asLong();
  }

  /** 본문 없는 상태 전환 POST(/delete, /restore, /suspend, /activate). */
  private ResultActions act(String auth, long id, String action) throws Exception {
    return mvc.perform(
        post("/api/platform/tenants/" + id + "/" + action).header("Authorization", auth));
  }

  /** 영구 삭제 요청 — 확인 이름을 본문으로 보낸다. */
  private ResultActions purge(String auth, long id, String name) throws Exception {
    return mvc.perform(
        post("/api/platform/tenants/" + id + "/purge")
            .header("Authorization", auth)
            .contentType("application/json")
            .content("{\"confirmName\":" + objectMapper.writeValueAsString(name) + "}"));
  }

  @Test
  void delete_thenRestore_roundTrip() throws Exception {
    String auth = "Bearer " + platformToken();
    long id = createTenant(auth, "Gamma");
    act(auth, id, "delete").andExpect(status().isNoContent());
    mvc.perform(get("/api/platform/tenants/" + id).header("Authorization", auth))
        .andExpect(jsonPath("$.status").value("DELETED"))
        .andExpect(jsonPath("$.deletedAt").isNotEmpty());
    // 목록은 모든 상태를 반환한다(콘솔이 탭으로 나눔).
    mvc.perform(get("/api/platform/tenants").header("Authorization", auth))
        .andExpect(jsonPath("$[?(@.id == " + id + ")].status").value("DELETED"));
    act(auth, id, "restore").andExpect(status().isNoContent());
    mvc.perform(get("/api/platform/tenants/" + id).header("Authorization", auth))
        .andExpect(jsonPath("$.status").value("ACTIVE"))
        .andExpect(jsonPath("$.deletedAt").isEmpty());
  }

  @Test
  void delete_fromSuspended_allowed_andTwice_409() throws Exception {
    String auth = "Bearer " + platformToken();
    long id = createTenant(auth, "Delta");
    act(auth, id, "suspend").andExpect(status().isNoContent());
    act(auth, id, "delete").andExpect(status().isNoContent());
    act(auth, id, "delete").andExpect(status().isConflict());
  }

  @Test
  void suspendActivate_onDeleted_409() throws Exception {
    String auth = "Bearer " + platformToken();
    long id = createTenant(auth, "Eps");
    act(auth, id, "delete").andExpect(status().isNoContent());
    act(auth, id, "suspend").andExpect(status().isConflict());
    act(auth, id, "activate").andExpect(status().isConflict());
  }

  @Test
  void restore_onActive_409() throws Exception {
    String auth = "Bearer " + platformToken();
    long id = createTenant(auth, "Zeta");
    act(auth, id, "restore").andExpect(status().isConflict());
  }

  @Test
  void purge_requiresDeleted_409() throws Exception {
    String auth = "Bearer " + platformToken();
    long id = createTenant(auth, "Eta");
    purge(auth, id, "Eta").andExpect(status().isConflict());
  }

  @Test
  void purge_nameWithSurroundingSpaces_accepted() throws Exception {
    String auth = "Bearer " + platformToken();
    long id = createTenant(auth, "Theta");
    act(auth, id, "delete").andExpect(status().isNoContent());
    purge(auth, id, "  Theta ").andExpect(status().isAccepted());
    mvc.perform(get("/api/platform/tenants/" + id).header("Authorization", auth))
        .andExpect(jsonPath("$.status").value("PURGING"));
  }

  @Test
  void purge_storedNameWithTrailingSpace_accepted() throws Exception {
    // createTenant 는 이름을 그대로 저장한다 — 저장명 "Acme " 도 "Acme" 입력으로 영구 삭제 가능해야 한다.
    String auth = "Bearer " + platformToken();
    long id = createTenant(auth, "Acme ");
    act(auth, id, "delete").andExpect(status().isNoContent());
    purge(auth, id, "Acme").andExpect(status().isAccepted());
    mvc.perform(get("/api/platform/tenants/" + id).header("Authorization", auth))
        .andExpect(jsonPath("$.status").value("PURGING"));
  }

  @Test
  void purge_nameCaseMismatch_400() throws Exception {
    String auth = "Bearer " + platformToken();
    long id = createTenant(auth, "Iota");
    act(auth, id, "delete").andExpect(status().isNoContent());
    purge(auth, id, "iota").andExpect(status().isBadRequest());
  }

  @Test
  void purge_twice_secondIs409() throws Exception {
    String auth = "Bearer " + platformToken();
    long id = createTenant(auth, "Kappa");
    act(auth, id, "delete").andExpect(status().isNoContent());
    purge(auth, id, "Kappa").andExpect(status().isAccepted());
    purge(auth, id, "Kappa").andExpect(status().isConflict());
    act(auth, id, "restore").andExpect(status().isConflict()); // PURGING 은 복원 불가
  }

  @Test
  void memberAddAndQuota_onDeleted_409() throws Exception {
    String auth = "Bearer " + platformToken();
    // 멤버 후보는 테넌트 생성 전에 시드한다 — 생성 API 가 같은 테스트 트랜잭션의 tenant GUC 를 비워 user_role INSERT 가 막히기 때문.
    long user = createHumanUser("member");
    long id = createTenant(auth, "Lambda");
    act(auth, id, "delete").andExpect(status().isNoContent());
    mvc.perform(
            patch("/api/platform/tenants/" + id + "/quota")
                .header("Authorization", auth)
                .contentType("application/json")
                .content("{\"quotaBytes\":1073741824}"))
        .andExpect(status().isConflict());
    // 기존 사용자 멤버 추가도 삭제된 테넌트에선 409.
    mvc.perform(
            post("/api/platform/tenants/" + id + "/members/existing")
                .header("Authorization", auth)
                .contentType("application/json")
                .content("{\"userId\":" + user + ",\"role\":\"MEMBER\"}"))
        .andExpect(status().isConflict());
  }

  /** 기본 테넌트(id=1)는 회원가입이 멤버십을 하드코딩하므로 삭제할 수 없다 — 409, 상태 유지. */
  @Test
  void delete_defaultTenant_409() throws Exception {
    String auth = "Bearer " + platformToken();
    act(auth, 1L, "delete").andExpect(status().isConflict());
    mvc.perform(get("/api/platform/tenants/1").header("Authorization", auth))
        .andExpect(jsonPath("$.status").value("ACTIVE"));
  }

  /**
   * 기본 테넌트(id=1)는 (어떤 경로로든 DELETED 가 되었더라도) 영구 삭제 요청도 409 — PURGING 으로 넘어가지 않는다. 테스트 트랜잭션 안에서만
   * DELETED 로 바꾸므로 롤백된다.
   */
  @Test
  void purge_defaultTenant_409() throws Exception {
    String auth = "Bearer " + platformToken();
    dsl.update(TENANT).set(TENANT.STATUS, "DELETED").where(TENANT.ID.eq(1L)).execute();
    String name =
        dsl.select(TENANT.NAME).from(TENANT).where(TENANT.ID.eq(1L)).fetchOne(TENANT.NAME);
    purge(auth, 1L, name).andExpect(status().isConflict());
    mvc.perform(get("/api/platform/tenants/1").header("Authorization", auth))
        .andExpect(jsonPath("$.status").value("DELETED"));
  }

  @Test
  void unknownTenant_404() throws Exception {
    String auth = "Bearer " + platformToken();
    act(auth, 999_999_999L, "delete").andExpect(status().isNotFound());
    act(auth, 999_999_999L, "restore").andExpect(status().isNotFound());
    purge(auth, 999_999_999L, "x").andExpect(status().isNotFound());
  }
}
