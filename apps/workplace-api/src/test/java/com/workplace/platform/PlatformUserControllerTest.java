package com.workplace.platform;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/** 운영자 콘솔 — 전역 사용자 이메일 조회·자동완성 검색 컨트롤러 통합 테스트. */
@Transactional
class PlatformUserControllerTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;

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

  private String platformToken() {
    long operator = createHumanUser("operator", "op-" + UUID.randomUUID() + "@example.com");
    return jwtTokenProvider.generatePlatformAccessToken(operator, "operator");
  }

  @Test
  void lookup_found_returns200() throws Exception {
    String email = "found-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
    long userId = createHumanUser("찾음", email);
    String auth = "Bearer " + platformToken();

    mvc.perform(
            get("/api/platform/users/lookup").param("email", email).header("Authorization", auth))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.userId").value(userId))
        .andExpect(jsonPath("$.email").value(email))
        .andExpect(jsonPath("$.isPlatformAdmin").value(false));
  }

  @Test
  void lookup_notFound_returns404() throws Exception {
    String auth = "Bearer " + platformToken();

    mvc.perform(
            get("/api/platform/users/lookup")
                .param("email", "nobody-" + UUID.randomUUID() + "@example.com")
                .header("Authorization", auth))
        .andExpect(status().isNotFound());
  }

  /** 검색 테스트 격리용 고유 토큰 — 다른 테스트/시드 사용자와 겹치지 않게 이름·이메일에 심는다. */
  private static String token() {
    return "zq" + UUID.randomUUID().toString().replace("-", "").substring(0, 10);
  }

  @Test
  void search_matchesEmailNameAndUsername_partialIgnoreCase() throws Exception {
    String t = token();
    long byEmail = createHumanUser("메일사용자", "x-" + t + "@example.com");
    long byName = createHumanUser("이름" + t.toUpperCase(), null);
    String auth = "Bearer " + platformToken();

    // createHumanUser 의 username 은 "<prefix>-<uuid8>" 이라 prefix 가 이름이면 username 도 일치한다.
    mvc.perform(get("/api/platform/users/search").param("q", t).header("Authorization", auth))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$", hasSize(2)))
        .andExpect(jsonPath("$[?(@.id == %d)].email", byEmail).value("x-" + t + "@example.com"))
        .andExpect(jsonPath("$[?(@.id == %d)].username", byName).exists());
  }

  @Test
  void search_excludesAgentAndInactiveUsers() throws Exception {
    String t = token();
    long human = createHumanUser("사람" + t, null);
    long agent = createHumanUser("에이전트" + t, null);
    dsl.update(USER).set(USER.KIND, "AGENT").where(USER.ID.eq(agent)).execute();
    long inactive = createHumanUser("비활성" + t, null);
    dsl.update(USER).set(USER.IS_ACTIVE, false).where(USER.ID.eq(inactive)).execute();
    String auth = "Bearer " + platformToken();

    mvc.perform(get("/api/platform/users/search").param("q", t).header("Authorization", auth))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$", hasSize(1)))
        .andExpect(jsonPath("$[0].id").value(human));
  }

  @Test
  void search_prefixMatchFirst_thenByName() throws Exception {
    String t = token();
    long contains = createHumanUser("가" + t, null);
    long prefixB = createHumanUser(t + "나", null);
    long prefixA = createHumanUser(t + "가", null);
    String auth = "Bearer " + platformToken();

    mvc.perform(get("/api/platform/users/search").param("q", t).header("Authorization", auth))
        .andExpect(jsonPath("$[0].id").value(prefixA))
        .andExpect(jsonPath("$[1].id").value(prefixB))
        .andExpect(jsonPath("$[2].id").value(contains));
  }

  @Test
  void search_shortQuery_returnsEmpty() throws Exception {
    String auth = "Bearer " + platformToken();

    mvc.perform(get("/api/platform/users/search").param("q", " a ").header("Authorization", auth))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$", hasSize(0)));
  }

  @Test
  void search_respectsLimit() throws Exception {
    String t = token();
    for (int i = 0; i < 3; i++) {
      createHumanUser(t + i, null);
    }
    String auth = "Bearer " + platformToken();

    mvc.perform(
            get("/api/platform/users/search")
                .param("q", t)
                .param("limit", "2")
                .header("Authorization", auth))
        .andExpect(jsonPath("$", hasSize(2)));
  }
}
