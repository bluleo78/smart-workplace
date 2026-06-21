package com.workplace.platform;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
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
 * 테넌트 쿼터 설정 — PATCH /api/platform/tenants/{id}/quota 플랫폼 권한 경계 검증(#81).
 *
 * <p>클래스-레벨 {@code @Transactional}: 공유 test DB 오염 방지. {@link PlatformTenantControllerTest} 와 동일 패턴.
 */
@AutoConfigureMockMvc
@Transactional
class PlatformTenantQuotaTest extends IntegrationTestBase {

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

  /** 일반(테넌트) 토큰 — ROLE_PLATFORM 없음 → 403 예상. */
  private String regularToken() {
    long user = createHumanUser("regular");
    return jwtTokenProvider.generateAccessToken(user, "regular");
  }

  /** 테넌트 생성 후 id 반환. */
  private long createTenant(String authHeader) throws Exception {
    long owner = createHumanUser("owner");
    String slug = "qt-" + UUID.randomUUID().toString().substring(0, 8);
    String body =
        objectMapper.writeValueAsString(new CreateTenantRequest("QuotaTestInc", slug, owner));
    MvcResult result =
        mvc.perform(
                org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post(
                        "/api/platform/tenants")
                    .header("Authorization", authHeader)
                    .contentType("application/json")
                    .content(body))
            .andExpect(status().isCreated())
            .andReturn();
    JsonNode json = objectMapper.readTree(result.getResponse().getContentAsString());
    return json.get("id").asLong();
  }

  /** 플랫폼 토큰으로 쿼터 변경하면 200 + GET 에 반영된다. */
  @Test
  void 플랫폼토큰은_쿼터_수정_가능() throws Exception {
    String auth = "Bearer " + platformToken();
    long tid = createTenant(auth);

    // PATCH — 5 GB 로 변경
    mvc.perform(
            patch("/api/platform/tenants/" + tid + "/quota")
                .header("Authorization", auth)
                .contentType("application/json")
                .content("{\"quotaBytes\": 5368709120}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.quotaBytes").value(5368709120L));

    // GET 에도 반영
    mvc.perform(get("/api/platform/tenants/" + tid).header("Authorization", auth))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.quotaBytes").value(5368709120L));
  }

  /** 일반(테넌트) 토큰으로 PATCH 하면 403. */
  @Test
  void 일반토큰은_403() throws Exception {
    mvc.perform(
            patch("/api/platform/tenants/1/quota")
                .header("Authorization", "Bearer " + regularToken())
                .contentType("application/json")
                .content("{\"quotaBytes\": 1}"))
        .andExpect(status().isForbidden());
  }
}
