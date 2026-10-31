package com.workplace.agentruntime;

import static com.workplace.jooq.Tables.AGENT_LOCATION;
import static com.workplace.jooq.Tables.AGENT_RUNNER_TOKEN;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.agentruntime.dto.RunnerPrincipal;
import com.workplace.agentruntime.service.AgentLocationService;
import com.workplace.agentruntime.service.RunnerTokenVerifier;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.support.WebSessionAuth;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1248 AI 실행 위치·runner 토큰 API 통합 테스트 — 첫 위치 자동 기본, 토큰 평문 1회 노출, 기본 이동·삭제 가드, 토큰 재발급(옛 토큰 회수), 토큰
 * 검증(테넌트 컨텍스트 없이)과 연결 상태, 테넌트 격리.
 */
@Transactional
class AdminAgentLocationApiTest extends IntegrationTestBase {

  private static final String BASE = "/api/v1/admin/agent-locations";

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired RunnerTokenVerifier verifier;
  @Autowired AgentLocationService locationService;

  private long admin;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    admin = TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, admin, "ADMIN");
  }

  /** 브라우저 로그인 세션처럼 AuthDetails 를 단다 — 토큰 평문을 돌려주는 POST 는 웹 세션만 허용한다(@RequireWebSession). */
  private Authentication auth(long userId) {
    return WebSessionAuth.of(userId, List.of(new SimpleGrantedAuthority("user:write")));
  }

  /** 요청 필터 체인이 끝나면 TenantContext 가 비워지므로 매 호출 전에 테넌트를 다시 맞춘다. */
  private ResultActions call(
      org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder b, long caller)
      throws Exception {
    TenantContext.set(1L);
    return mvc.perform(b.with(authentication(auth(caller))));
  }

  private JsonNode json(ResultActions r) throws Exception {
    return om.readTree(r.andReturn().getResponse().getContentAsString());
  }

  private ResultActions create(String name, int capacity) throws Exception {
    return call(
        post(BASE)
            .contentType(MediaType.APPLICATION_JSON)
            .content(
                "{\"name\":\""
                    + name
                    + "\",\"description\":\"에이전트 전용 노드\",\"capacity\":"
                    + capacity
                    + "}"),
        admin);
  }

  /** 첫 위치는 자동으로 기본이 되고, 토큰 평문은 생성 응답에만 나온다. */
  @Test
  void create_firstLocation_becomesDefaultAndReturnsTokenOnce() throws Exception {
    JsonNode created = json(create("운영", 3).andExpect(status().isOk()));

    assertThat(created.at("/location/isDefault").asBoolean()).isTrue();
    String token = created.get("plaintextToken").asText();
    assertThat(token).startsWith("rt_");

    call(get(BASE), admin)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$", hasSize(1)))
        .andExpect(jsonPath("$[0].plaintextToken").doesNotExist())
        .andExpect(jsonPath("$[0].tokenPrefix").value(token.substring(0, 12)))
        .andExpect(jsonPath("$[0].connection").value("PENDING"))
        .andExpect(jsonPath("$[0].used").value(0));
  }

  @Test
  void create_whenDuplicateName_returns409() throws Exception {
    create("운영", 3).andExpect(status().isOk());

    create("운영", 3).andExpect(status().isConflict());
  }

  @Test
  void create_whenCapacityZero_returns400() throws Exception {
    create("운영", 0).andExpect(status().isBadRequest());
  }

  /** 둘째를 기본으로 하면 첫째의 기본 표시가 사라진다. */
  @Test
  void setDefault_movesDefaultFlag() throws Exception {
    long first = json(create("첫째", 3)).at("/location/id").asLong();
    long second = json(create("둘째", 3)).at("/location/id").asLong();

    call(post(BASE + "/" + second + "/default"), admin).andExpect(status().isNoContent());

    call(get(BASE), admin)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[?(@.id==" + first + ")].isDefault").value(false))
        .andExpect(jsonPath("$[?(@.id==" + second + ")].isDefault").value(true));
  }

  /** 재발급하면 옛 토큰은 못 쓰고 새 토큰만 통과한다. */
  @Test
  void rotateToken_revokesOldToken() throws Exception {
    JsonNode created = json(create("운영", 3));
    long id = created.at("/location/id").asLong();
    String old = created.get("plaintextToken").asText();

    String fresh =
        json(call(post(BASE + "/" + id + "/token"), admin).andExpect(status().isOk()))
            .get("plaintextToken")
            .asText();

    TenantContext.clear();
    assertThat(verifier.verify(old)).isEmpty();
    assertThat(verifier.verify(fresh)).isPresent();
  }

  /** 토큰은 발급한 테넌트·위치에 묶이고, 검증하면 연결 상태가 CONNECTED 로 바뀐다. */
  @Test
  void verify_returnsBoundTenantAndLocation() throws Exception {
    JsonNode created = json(create("운영", 3));
    long id = created.at("/location/id").asLong();
    String token = created.get("plaintextToken").asText();

    TenantContext.clear();
    Optional<RunnerPrincipal> p = verifier.verify(token);

    assertThat(p).contains(new RunnerPrincipal(1L, id));
    call(get(BASE), admin)
        .andExpect(jsonPath("$[0].connection").value("CONNECTED"))
        .andExpect(jsonPath("$[0].lastSeenAt").isNotEmpty());
  }

  @Test
  void verify_whenUnknownToken_returnsEmpty() {
    assertThat(verifier.verify("rt_nope")).isEmpty();
    assertThat(verifier.verify("")).isEmpty();
    assertThat(verifier.verify(null)).isEmpty();
  }

  /** 기본 위치는 지울 수 없다. */
  @Test
  void delete_whenDefault_returns409() throws Exception {
    long id = json(create("운영", 3)).at("/location/id").asLong();

    call(delete(BASE + "/" + id), admin).andExpect(status().isConflict());
  }

  @Test
  void delete_whenNotDefault_returns204() throws Exception {
    create("첫째", 3).andExpect(status().isOk());
    long second = json(create("둘째", 3)).at("/location/id").asLong();

    call(delete(BASE + "/" + second), admin).andExpect(status().isNoContent());

    assertThat(dsl.fetchCount(AGENT_LOCATION, AGENT_LOCATION.ID.eq(second))).isZero();
  }

  /** 수정 — 이름·설명·자리 수를 바꾼다. */
  @Test
  void update_changesFields() throws Exception {
    long id = json(create("운영", 3)).at("/location/id").asLong();

    call(
            org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put(BASE + "/" + id)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"새 이름\",\"description\":\"설명\",\"capacity\":5}"),
            admin)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.name").value("새 이름"))
        .andExpect(jsonPath("$.capacity").value(5));
  }

  /** ADMIN 역할이 없으면 403. */
  @Test
  void list_asNonAdmin_returns403() throws Exception {
    long member = TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createHuman(dsl));

    call(get(BASE), member).andExpect(status().isForbidden());
  }

  /**
   * 다른 테넌트 컨텍스트에서는 위치가 보이지 않는다(RLS). 새 테넌트에는 ADMIN 역할 시드가 없어 HTTP 대신 서비스를 그 테넌트 GUC 아래에서 직접 부른다.
   */
  @Test
  void list_fromOtherTenant_isEmpty() throws Exception {
    create("운영", 3).andExpect(status().isOk());
    assertThat(locationService.list()).hasSize(1);

    long tenant2 = TestFixtures.createTenant(dsl, "ACTIVE");
    useTenant(tenant2);

    assertThat(locationService.list()).isEmpty();
  }

  /** 거듭 재발급해도 쓸 수 있는 토큰은 늘 하나이고, 응답은 새 토큰 앞자리·연결 대기(PENDING)를 보인다. */
  @Test
  void rotateToken_twice_keepsSingleActiveToken() throws Exception {
    long id = json(create("운영", 3)).at("/location/id").asLong();

    call(post(BASE + "/" + id + "/token"), admin).andExpect(status().isOk());
    JsonNode rotated =
        json(call(post(BASE + "/" + id + "/token"), admin).andExpect(status().isOk()));

    assertThat(rotated.at("/location/tokenPrefix").asText())
        .isEqualTo(rotated.get("plaintextToken").asText().substring(0, 12));
    assertThat(rotated.at("/location/connection").asText()).isEqualTo("PENDING");
    assertThat(
            dsl.fetchCount(
                AGENT_RUNNER_TOKEN,
                AGENT_RUNNER_TOKEN.LOCATION_ID.eq(id).and(AGENT_RUNNER_TOKEN.REVOKED_AT.isNull())))
        .isOne();
  }

  /** 없는 위치의 토큰 재발급·삭제는 404. */
  @Test
  void rotateTokenAndDelete_whenMissing_return404() throws Exception {
    call(post(BASE + "/999999/token"), admin)
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.errors.code").value("AGENT_LOCATION_NOT_FOUND"));
    call(delete(BASE + "/999999"), admin).andExpect(status().isNotFound());
  }

  /** 마지막 사용 시각은 30초 안에 다시 검증해도 고치지 않는다(runner 요청마다 쓰기가 일어나지 않게). 30초가 지나면 고친다. */
  @Test
  void verify_throttlesLastUsedUpdates() throws Exception {
    JsonNode created = json(create("운영", 3));
    long id = created.at("/location/id").asLong();
    String token = created.get("plaintextToken").asText();
    OffsetDateTime recent = OffsetDateTime.now().minusSeconds(10).truncatedTo(ChronoUnit.MICROS);
    setLastUsed(id, recent);

    TenantContext.clear();
    verifier.verify(token);
    assertThat(lastUsed(id).toInstant()).isEqualTo(recent.toInstant());

    OffsetDateTime stale = OffsetDateTime.now().minusSeconds(60);
    setLastUsed(id, stale);
    verifier.verify(token);
    assertThat(lastUsed(id)).isAfter(stale.plusSeconds(30));
  }

  private void setLastUsed(long locationId, OffsetDateTime at) {
    dsl.update(AGENT_RUNNER_TOKEN)
        .set(AGENT_RUNNER_TOKEN.LAST_USED_AT, at)
        .where(AGENT_RUNNER_TOKEN.LOCATION_ID.eq(locationId))
        .execute();
  }

  private OffsetDateTime lastUsed(long locationId) {
    return dsl.select(AGENT_RUNNER_TOKEN.LAST_USED_AT)
        .from(AGENT_RUNNER_TOKEN)
        .where(
            AGENT_RUNNER_TOKEN
                .LOCATION_ID
                .eq(locationId)
                .and(AGENT_RUNNER_TOKEN.REVOKED_AT.isNull()))
        .fetchOne(AGENT_RUNNER_TOKEN.LAST_USED_AT);
  }
}
