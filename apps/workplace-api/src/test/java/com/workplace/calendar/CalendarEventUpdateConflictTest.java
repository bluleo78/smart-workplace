package com.workplace.calendar;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.ArrayList;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * WP-1920: 일정 수정의 expectedUpdatedAt 버전 검사 — 실제 DB·HTTP 로 확인한다.
 *
 * <p>같은 값이면 통과, 본 뒤 바뀌었으면 409(EVENT_CONFLICT)이고 행은 그대로, 값을 안 보내면(AI·MCP) 지금처럼 덮어쓴다. 「이 일정만」 고친
 * 회차(override)는 그 행의 updatedAt 으로 비교한다.
 */
@Transactional
class CalendarEventUpdateConflictTest extends IntegrationTestBase {

  private static final String MESSAGE = "다른 사람이 먼저 이 일정을 수정했습니다. 최신 내용을 확인한 뒤 다시 저장해 주세요.";
  private static final JsonMapper JSON = JsonMapper.builderWithJackson2Defaults().build();

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;

  long me;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    me = TestFixtures.createHuman(dsl);
  }

  /** 일정 읽기·쓰기 권한을 가진 사람 요청으로 꾸민다(요청마다 테넌트를 되돌려 놓는다). */
  private RequestPostProcessor asMe() {
    RequestPostProcessor auth =
        authentication(
            new UsernamePasswordAuthenticationToken(
                me,
                "n/a",
                List.of(
                    new SimpleGrantedAuthority("calendar:read"),
                    new SimpleGrantedAuthority("calendar:write"))));
    return req -> {
      TenantContext.set(1L);
      return auth.postProcessRequest(req);
    };
  }

  private static String body(String title, String rrule) {
    String rule = rrule == null ? "" : ",\"recurrenceRule\":\"" + rrule + "\"";
    return "{\"title\":\""
        + title
        + "\",\"startsAt\":\"2026-11-20T01:00:00Z\",\"endsAt\":\"2026-11-20T02:00:00Z\""
        + rule
        + "}";
  }

  private JsonNode send(MockHttpServletRequestBuilder b) throws Exception {
    String res = mvc.perform(b.with(asMe())).andReturn().getResponse().getContentAsString();
    return JSON.readTree(res);
  }

  private JsonNode create(String title, String rrule) throws Exception {
    return JSON.readTree(
        mvc.perform(
                post("/api/v1/calendar/events")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(body(title, rrule))
                    .with(asMe()))
            .andExpect(status().isCreated())
            .andReturn()
            .getResponse()
            .getContentAsString());
  }

  /** 테스트 구간(11/19~11/23)의 일정 목록 제목들 — 저장이 반영됐는지·거절된 저장이 행을 안 바꿨는지 보는 데 쓴다. */
  private List<String> titles() throws Exception {
    JsonNode list =
        send(
            get("/api/v1/calendar/events")
                .param("from", "2026-11-19T00:00:00Z")
                .param("to", "2026-11-23T00:00:00Z"));
    List<String> titles = new ArrayList<>();
    for (JsonNode e : list) {
      titles.add(e.path("title").asText());
    }
    return titles;
  }

  /** 목록에서 제목이 title 인 일정의 updatedAt — 화면이 목록을 다시 읽어 받는 버전이다. 없으면 null. */
  private String versionOf(String title) throws Exception {
    JsonNode list =
        send(
            get("/api/v1/calendar/events")
                .param("from", "2026-11-19T00:00:00Z")
                .param("to", "2026-11-23T00:00:00Z"));
    String version = null;
    for (JsonNode e : list) {
      if (title.equals(e.path("title").asText())) version = e.path("updatedAt").asText();
    }
    return version;
  }

  /** PATCH 를 보내고 응답 JSON 을 돌려준다(상태 검증은 호출자가). expected 가 null 이면 파라미터를 생략한다. */
  private MockHttpServletRequestBuilder edit(
      long id, String title, String scope, String occurrenceDate, String expected) {
    var b =
        patch("/api/v1/calendar/events/" + id)
            .contentType(MediaType.APPLICATION_JSON)
            .content(body(title, null));
    if (scope != null) b = b.param("scope", scope);
    if (occurrenceDate != null) b = b.param("occurrenceDate", occurrenceDate);
    if (expected != null) b = b.param("expectedUpdatedAt", expected);
    return b;
  }

  /** updatedAt 이 확실히 달라지도록 잠깐 기다린다(밀리초 비교). */
  private static void tick() throws InterruptedException {
    Thread.sleep(5);
  }

  @Test
  void 수정_expectedUpdatedAt_이_같으면_200() throws Exception {
    JsonNode created = create("회의", null);
    mvc.perform(
            edit(created.path("id").asLong(), "수정", null, null, created.path("updatedAt").asText())
                .with(asMe()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.title").value("수정"));
  }

  @Test
  void 수정_expectedUpdatedAt_이_다르면_409_EVENT_CONFLICT_이고_바뀌지_않는다() throws Exception {
    JsonNode created = create("회의", null);
    long id = created.path("id").asLong();
    String oldVersion = created.path("updatedAt").asText();
    tick();
    mvc.perform(edit(id, "첫수정", null, null, oldVersion).with(asMe())).andExpect(status().isOk());
    tick();

    mvc.perform(edit(id, "늦은수정", null, null, oldVersion).with(asMe()))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.code").value("EVENT_CONFLICT"))
        .andExpect(jsonPath("$.message").value(MESSAGE));

    mvc.perform(get("/api/v1/calendar/events/" + id).with(asMe()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.title").value("첫수정"));
  }

  @Test
  void 수정_expectedUpdatedAt_없으면_지금처럼_덮어쓴다() throws Exception {
    JsonNode created = create("회의", null);
    long id = created.path("id").asLong();
    tick();
    mvc.perform(edit(id, "첫수정", null, null, null).with(asMe())).andExpect(status().isOk());
    mvc.perform(edit(id, "덮어씀", null, null, null).with(asMe()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.title").value("덮어씀"));
  }

  @Test
  void 반복_회차_override_를_THIS_로_고칠_때_override_의_updatedAt_으로_비교한다() throws Exception {
    JsonNode master = create("주간", "FREQ=DAILY;COUNT=3");
    long masterId = master.path("id").asLong();
    String occ = "2026-11-21T01:00:00Z";
    String masterVersion = master.path("updatedAt").asText();
    tick();

    // 첫 「이 일정만」 수정 — override 가 생긴다(마스터 버전으로 비교: override 없으니 마스터 행).
    mvc.perform(edit(masterId, "회차v1", "THIS", occ, masterVersion).with(asMe()))
        .andExpect(status().isOk());
    tick();

    // 화면은 목록에서 그 회차를 다시 읽는다 — override 행의 updatedAt 을 받는다.
    String overrideVersion = versionOf("회차v1");
    assertThat(overrideVersion).isNotNull();

    // 참고: 웹은 이미 고친 회차를 override 행 자기 id 로 저장하므로 마스터 id + scope 조합을 보내지 않는다. 이 테스트는
    // 화면을 연 뒤 회차가 고쳐진 오래된 화면의 요청, 또는 웹이 아닌 호출자의 경우를 확인한다.
    // 마스터 id + THIS 로 override 의 버전을 보내면 통과(마스터와 비교하면 거짓 충돌).
    mvc.perform(edit(masterId, "회차v2", "THIS", occ, overrideVersion).with(asMe()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.title").value("회차v2"));
    tick();

    // 그 전 값(override v1 버전)으로 보내면 409.
    mvc.perform(edit(masterId, "회차v3", "THIS", occ, overrideVersion).with(asMe()))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.code").value("EVENT_CONFLICT"));

    // 거절된 저장은 행을 바꾸지 않는다.
    assertThat(titles()).contains("회차v2").doesNotContain("회차v3");
  }

  /** 고친 회차를 마스터 id + scope=ALL 로 저장해도 override 행의 updatedAt 으로 비교한다(영구 거짓 409 방지). */
  @Test
  void 고친_회차를_ALL_범위로_저장할_때도_override_의_updatedAt_으로_비교한다() throws Exception {
    JsonNode master = create("주간", "FREQ=DAILY;COUNT=3");
    long masterId = master.path("id").asLong();
    String occ = "2026-11-21T01:00:00Z";
    tick();
    mvc.perform(edit(masterId, "회차v1", "THIS", occ, master.path("updatedAt").asText()).with(asMe()))
        .andExpect(status().isOk());
    tick();
    // 같은 트랜잭션 안의 테스트라 새 override 행의 updatedAt(DB 기본 now())이 마스터와 같다 — 한 번 더 고쳐 구분되게 한다.
    mvc.perform(edit(masterId, "회차v1", "THIS", occ, null).with(asMe())).andExpect(status().isOk());
    tick();

    String overrideVersion = versionOf("회차v1");
    assertThat(overrideVersion).isNotNull();
    assertThat(overrideVersion).isNotEqualTo(master.path("updatedAt").asText());

    // 참고: 위 THIS 테스트와 같은 이유로(오래된 화면·웹이 아닌 호출자) 마스터 id + scope 조합을 보낸다.
    // 낡은 값 → 409
    mvc.perform(edit(masterId, "전체", "ALL", occ, master.path("updatedAt").asText()).with(asMe()))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.code").value("EVENT_CONFLICT"));
    // 거절된 저장은 행을 바꾸지 않는다.
    assertThat(titles()).doesNotContain("전체");
    // override 의 값 → 200
    mvc.perform(edit(masterId, "전체", "ALL", occ, overrideVersion).with(asMe()))
        .andExpect(status().isOk());
  }
}
