package com.workplace.platform;

import static com.workplace.jooq.Tables.USER;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.platform.dto.CreateTenantRequest;
import com.workplace.platform.dto.UpdateTenantRequest;
import com.workplace.platform.service.PlatformTenantService;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;

/**
 * 테넌트 이름·slug 수정 — PATCH /api/platform/tenants/{id} 검증(WP-336).
 *
 * <p>클래스-레벨 {@code @Transactional}: 공유 test DB 오염 방지. {@link PlatformTenantQuotaTest} 와 동일 패턴.
 */
@Transactional
class PlatformTenantUpdateTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired ObjectMapper objectMapper;
  @Autowired JwtTokenProvider jwtTokenProvider;

  private String auth;

  /** 운영자(플랫폼) 토큰 준비 — ROLE_PLATFORM 게이트 통과용. */
  @BeforeEach
  void setUp() {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long operator =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "operator-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "operator")
            .set(USER.EMAIL, "operator-" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    auth = "Bearer " + jwtTokenProvider.generatePlatformAccessToken(operator, "operator");
  }

  /** 소유자 없는 테넌트 생성 후 id 반환. */
  private long createTenant(String name, String slug) throws Exception {
    String body = objectMapper.writeValueAsString(new CreateTenantRequest(name, slug, null));
    String json =
        mvc.perform(
                post("/api/platform/tenants")
                    .header("Authorization", auth)
                    .contentType("application/json")
                    .content(body))
            .andExpect(status().isCreated())
            .andReturn()
            .getResponse()
            .getContentAsString();
    return objectMapper.readTree(json).get("id").asLong();
  }

  private ResultActions update(long id, String name, String slug) throws Exception {
    return mvc.perform(
        patch("/api/platform/tenants/" + id)
            .header("Authorization", auth)
            .contentType("application/json")
            .content(objectMapper.writeValueAsString(new UpdateTenantRequest(name, slug))));
  }

  private static String uniq(String prefix) {
    return prefix + "-" + UUID.randomUUID().toString().substring(0, 8);
  }

  /** 이름·slug 를 바꾸면 200 + 상세/GET 에 반영된다. */
  @Test
  void 이름과_slug_수정() throws Exception {
    long id = createTenant("Before Inc", uniq("before"));
    String newSlug = uniq("after");

    update(id, "  After Inc  ", newSlug)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.name").value("After Inc"))
        .andExpect(jsonPath("$.slug").value(newSlug));

    mvc.perform(get("/api/platform/tenants/" + id).header("Authorization", auth))
        .andExpect(jsonPath("$.name").value("After Inc"))
        .andExpect(jsonPath("$.slug").value(newSlug));
  }

  /** 현재 slug 를 그대로 보내면 자기 자신과의 중복으로 보지 않는다. */
  @Test
  void 현재_slug_유지는_허용() throws Exception {
    String slug = uniq("keep");
    long id = createTenant("Keep Inc", slug);

    update(id, "Keep Renamed", slug)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.slug").value(slug));
  }

  /** 다른 테넌트의 slug 로 바꾸면 400 + 안내 메시지. */
  @Test
  void 다른_테넌트_slug_중복은_400() throws Exception {
    String taken = uniq("taken");
    createTenant("Taken Inc", taken);
    long id = createTenant("Mine Inc", uniq("mine"));

    update(id, "Mine Inc", taken)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("이미 사용 중인 slug 입니다: " + taken));
  }

  /** slug 를 비우면 이름에서 자동 생성한다 — 자기 자신의 현재 slug 와 같으면 suffix 없이 유지. */
  @Test
  void slug_비우면_이름에서_자동생성() throws Exception {
    String name = uniq("Auto Slug");
    long id = createTenant(name, null);
    String expected = PlatformTenantService.slugify(name);

    update(id, name, "  ").andExpect(status().isOk()).andExpect(jsonPath("$.slug").value(expected));
  }

  /** 긴 이름에서 자동 생성한 slug 는 컬럼 길이(64)를 넘지 않는다. */
  @Test
  void 긴_이름의_자동_slug_는_64자_이내() throws Exception {
    long id = createTenant("Short Inc", uniq("short"));
    String longName = "a".repeat(80) + " " + UUID.randomUUID();

    String json =
        update(id, longName, "")
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString();
    String slug = objectMapper.readTree(json).get("slug").asText();
    org.assertj.core.api.Assertions.assertThat(slug)
        .hasSizeLessThanOrEqualTo(64)
        .doesNotEndWith("-");
  }

  /** 앞뒤 공백이 붙은 slug 는 다듬어 저장한다. */
  @Test
  void slug_앞뒤_공백은_다듬는다() throws Exception {
    long id = createTenant("Trim Inc", uniq("trim"));
    String slug = uniq("trimmed");

    update(id, "Trim Inc", "  " + slug + "  ")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.slug").value(slug));
  }

  /** 이름 공백·slug 형식 위반은 400. */
  @Test
  void 이름_공백_또는_slug_형식위반은_400() throws Exception {
    long id = createTenant("Valid Inc", uniq("valid"));

    update(id, "   ", uniq("ok")).andExpect(status().isBadRequest());
    update(id, "Valid Inc", "Upper_Case").andExpect(status().isBadRequest());
  }

  /** 없는 테넌트는 404. */
  @Test
  void 없는_테넌트는_404() throws Exception {
    update(Long.MAX_VALUE, "Nope", uniq("nope")).andExpect(status().isNotFound());
  }
}
