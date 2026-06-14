package com.workplace.platform;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.platform.dto.CreateTenantRequest;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;

/**
 * 운영자 콘솔 테넌트 컨트롤러 통합 테스트 — 플랫폼 토큰으로 생성→목록→상세→정지→활성화→멤버 전 흐름.
 *
 * <p>⚠️ 클래스 레벨 {@code @Transactional} 필수(공유 test DB 오염 방지 — PlatformTenantServiceTest 주석 참조).
 *
 * <p>이로써 Task 3 보안 경계의 (d)(플랫폼 토큰 게이트 통과)를 실제 엔드포인트로 확정한다.
 */
@AutoConfigureMockMvc
@Transactional
class PlatformTenantControllerTest extends IntegrationTestBase {

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

  /** 운영자(플랫폼) 토큰 — ROLE_PLATFORM 게이트 통과용. 토큰 보유 운영자와 ownerUserId 는 별개 유저. */
  private String platformToken() {
    long operator = createHumanUser("operator");
    return jwtTokenProvider.generatePlatformAccessToken(operator, "operator");
  }

  @Test
  void fullFlow_create_list_detail_suspend_activate_members() throws Exception {
    String token = platformToken();
    long owner = createHumanUser("owner");
    String auth = "Bearer " + token;
    String slug = "ctl-" + UUID.randomUUID().toString().substring(0, 8);

    // 생성 → 201
    String body = objectMapper.writeValueAsString(new CreateTenantRequest("Acme Inc", slug, owner));
    MvcResult createResult =
        mvc.perform(
                post("/api/platform/tenants")
                    .header("Authorization", auth)
                    .contentType("application/json")
                    .content(body))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.name").value("Acme Inc"))
            .andExpect(jsonPath("$.status").value("ACTIVE"))
            .andExpect(jsonPath("$.memberCount").value(1))
            .andReturn();
    JsonNode created = objectMapper.readTree(createResult.getResponse().getContentAsString());
    long tenantId = created.get("id").asLong();

    // 목록 → 200, 생성 테넌트 포함
    mvc.perform(get("/api/platform/tenants").header("Authorization", auth))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[?(@.id == " + tenantId + ")].memberCount").value(1));

    // 상세 → 200
    mvc.perform(get("/api/platform/tenants/" + tenantId).header("Authorization", auth))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("ACTIVE"));

    // 정지 → 204, 이후 상세 status=SUSPENDED
    mvc.perform(
            post("/api/platform/tenants/" + tenantId + "/suspend").header("Authorization", auth))
        .andExpect(status().isNoContent());
    mvc.perform(get("/api/platform/tenants/" + tenantId).header("Authorization", auth))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("SUSPENDED"));

    // 활성화 → 204, 이후 상세 status=ACTIVE
    mvc.perform(
            post("/api/platform/tenants/" + tenantId + "/activate").header("Authorization", auth))
        .andExpect(status().isNoContent());
    mvc.perform(get("/api/platform/tenants/" + tenantId).header("Authorization", auth))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("ACTIVE"));

    // 멤버 → 200, OWNER 1명
    mvc.perform(get("/api/platform/tenants/" + tenantId + "/members").header("Authorization", auth))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].role").value("OWNER"))
        .andExpect(jsonPath("$[0].userId").value(owner));
  }

  @Test
  void getTenant_unknownId_returns404() throws Exception {
    mvc.perform(
            get("/api/platform/tenants/9999999")
                .header("Authorization", "Bearer " + platformToken()))
        .andExpect(status().isNotFound());
  }
}
