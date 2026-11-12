package com.workplace.help.controller;

import static com.workplace.jooq.Tables.HELP_METRIC_DAILY;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.help.service.HelpMetricService;
import com.workplace.jooq.tables.records.HelpMetricDailyRecord;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/** 도움말 지표 기록 API 시험(WP-1512) — 열기·0건 검색 기록, 값 정규화·가리기, 검증과 인증. */
@Transactional
class HelpMetricApiTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired HelpMetricService service;

  /** 다른 시험이 남긴 행을 비운다 — 시험 트랜잭션이 롤백한다. */
  @BeforeEach
  void clean() {
    baseDsl.execute("DELETE FROM help_metric_daily");
  }

  /** 로그인한 구성원 인증을 만든다. */
  private Authentication member() {
    long uid = TestFixtures.createHuman(baseDsl);
    return new UsernamePasswordAuthenticationToken(uid, "n/a", List.of());
  }

  /** 인증 상태로 JSON 본문을 POST 한다. */
  private void postJson(String path, String json, int expected) throws Exception {
    mvc.perform(
            post("/api/v1/help/metrics" + path)
                .contentType(MediaType.APPLICATION_JSON)
                .content(json)
                .with(authentication(member())))
        .andExpect(status().is(expected));
  }

  /** 저장된 행을 모두 읽는다. */
  private List<HelpMetricDailyRecord> rows() {
    return baseDsl.selectFrom(HELP_METRIC_DAILY).fetch();
  }

  @Test
  void openIsCountedPerRouteAndHelpId() throws Exception {
    String body = "{\"route\":\"/mail\",\"helpId\":\"mail\"}";
    postJson("/open", body, 204);
    postJson("/open", body, 204);
    assertThat(rows())
        .singleElement()
        .satisfies(
            r -> {
              assertThat(r.getKind()).isEqualTo("OPEN");
              assertThat(r.getRoute()).isEqualTo("/mail");
              assertThat(r.getHelpId()).isEqualTo("mail");
              assertThat(r.getCount()).isEqualTo(2);
            });
  }

  @Test
  void searchMissStoresMaskedQuery() throws Exception {
    postJson(
        "/search-miss",
        "{\"query\":\"토큰 만료 ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123\",\"route\":\"/\",\"helpId\":\"home\"}",
        204);
    assertThat(rows())
        .singleElement()
        .satisfies(
            r -> {
              assertThat(r.getKind()).isEqualTo("SEARCH_MISS");
              assertThat(r.getTerm()).isEqualTo("토큰 만료 [가림]");
              assertThat(r.getRoute()).isEqualTo("/");
              assertThat(r.getHelpId()).isEqualTo("home");
            });
  }

  @Test
  void searchMissBlankQueryIsIgnored() throws Exception {
    postJson("/search-miss", "{\"query\":\"   \",\"route\":\"/\",\"helpId\":\"home\"}", 204);
    assertThat(rows()).isEmpty();
  }

  @Test
  void searchMissQueryCappedAt200() throws Exception {
    postJson(
        "/search-miss",
        "{\"query\":\"" + "가".repeat(300) + "\",\"route\":\"/\",\"helpId\":\"home\"}",
        204);
    assertThat(rows())
        .singleElement()
        .satisfies(
            r -> assertThat(r.getTerm().codePointCount(0, r.getTerm().length())).isEqualTo(200));
  }

  @Test
  void aiGapViaServiceStoresMaskedQuestion() {
    service.recordAiGap("키 sk-ant-api03-AbCdEf1234567890 넣는 법", "agent.run.repo");
    assertThat(rows())
        .singleElement()
        .satisfies(
            r -> {
              assertThat(r.getKind()).isEqualTo("AI_GAP");
              assertThat(r.getTerm()).isEqualTo("키 [가림] 넣는 법");
              assertThat(r.getRoute()).isEmpty();
              assertThat(r.getHelpId()).isEqualTo("agent.run.repo");
            });
  }

  @Test
  void routeIsMasked() throws Exception {
    postJson("/open", "{\"route\":\"/s/ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123\"}", 204);
    assertThat(rows())
        .singleElement()
        .satisfies(r -> assertThat(r.getRoute()).isEqualTo("/s/[가림]"));
  }

  /**
   * 경로는 조각(/)별로 가린다 — 통째로 가리면 24자 넘는 대소문자·숫자 섞인 경로 전체가 긴 덩어리 규칙에 걸려 서로 다른 화면이 모두 [가림] 한 줄로 합쳐진다.
   */
  @Test
  void longMixedCaseRouteStaysReadable() throws Exception {
    String route = "/projects/TEAM2/settings/Members2";
    assertThat(route.length()).isGreaterThanOrEqualTo(24);
    postJson("/open", "{\"route\":\"" + route + "\"}", 204);
    assertThat(rows()).singleElement().satisfies(r -> assertThat(r.getRoute()).isEqualTo(route));
  }

  /** 경로 조각별 가리기 뒤에도 200 코드포인트로 자른다. */
  @Test
  void routeCappedAt200AfterSegmentMasking() throws Exception {
    postJson("/open", "{\"route\":\"/" + "abc/".repeat(80) + "\"}", 204);
    assertThat(rows())
        .singleElement()
        .satisfies(
            r -> assertThat(r.getRoute().codePointCount(0, r.getRoute().length())).isEqualTo(200));
  }

  /** 도움말 id 는 매뉴얼 id 꼴(소문자·숫자·.·_·-, 절 앵커 #…)만 받고, 그 밖의 값은 '' 로 저장한다. */
  @Test
  void helpIdOutsideIdShapeIsStoredEmpty() {
    service.recordOpen("/a", "Mail Rules!");
    service.recordOpen("/b", "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123");
    service.recordOpen("/c", "  mail.rules_v2-x  ");
    service.recordOpen("/d", "audit-logs#기록을-찾는다");
    service.recordOpen("/e", "audit-logs#Secret");
    assertThat(rows())
        .extracting(HelpMetricDailyRecord::getRoute, HelpMetricDailyRecord::getHelpId)
        .containsExactlyInAnyOrder(
            org.assertj.core.groups.Tuple.tuple("/a", ""),
            org.assertj.core.groups.Tuple.tuple("/b", ""),
            org.assertj.core.groups.Tuple.tuple("/c", "mail.rules_v2-x"),
            org.assertj.core.groups.Tuple.tuple("/d", "audit-logs#기록을-찾는다"),
            org.assertj.core.groups.Tuple.tuple("/e", ""));
  }

  @Test
  void missingRouteIs400() throws Exception {
    postJson("/open", "{\"helpId\":\"x\"}", 400);
  }

  @Test
  void anonymousIs401() throws Exception {
    mvc.perform(
            post("/api/v1/help/metrics/open")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"route\":\"/mail\"}"))
        .andExpect(status().isUnauthorized());
  }

  /** audit:read 권한을 가진 관리자 인증을 만든다. */
  private Authentication admin() {
    long uid = TestFixtures.createHuman(baseDsl);
    return new UsernamePasswordAuthenticationToken(
        uid, "n/a", List.of(new SimpleGrantedAuthority("audit:read")));
  }

  /** 관리자 인증으로 조회(GET)한다. */
  private org.springframework.test.web.servlet.ResultActions read(String query) throws Exception {
    return mvc.perform(get("/api/v1/help/metrics?" + query).with(authentication(admin())));
  }

  @Test
  void threeKindsAccumulateAndAreReadBack() throws Exception {
    String open = "{\"route\":\"/mail\",\"helpId\":\"mail\"}";
    postJson("/open", open, 204);
    postJson("/open", open, 204);
    postJson(
        "/search-miss",
        "{\"query\":\"토큰 ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123\",\"route\":\"/\",\"helpId\":\"home\"}",
        204);
    service.recordAiGap("AKIAIOSFODNN7EXAMPLE 어디", "");

    read("kind=OPEN&days=7")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.kind").value("OPEN"))
        .andExpect(jsonPath("$.days").value(7))
        .andExpect(jsonPath("$.items[0].route").value("/mail"))
        .andExpect(jsonPath("$.items[0].helpId").value("mail"))
        .andExpect(jsonPath("$.items[0].count").value(2))
        .andExpect(jsonPath("$.items[0].lastAt").exists());
    read("kind=SEARCH_MISS")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[0].term").value("토큰 [가림]"));
    read("kind=AI_GAP")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[0].term").value("[가림] 어디"));
  }

  @Test
  void memberWithoutAuditReadIs403() throws Exception {
    mvc.perform(get("/api/v1/help/metrics?kind=OPEN").with(authentication(member())))
        .andExpect(status().isForbidden());
  }

  @Test
  void unsupportedDaysIs400() throws Exception {
    read("kind=OPEN&days=14")
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("기간은 7·30·90일 중 하나입니다"));
  }

  @Test
  void unknownKindIs400() throws Exception {
    read("kind=FOO").andExpect(status().isBadRequest());
  }

  /** 검토 초점 5 — 다른 워크스페이스는 audit:read 가 있어도 첫 워크스페이스의 행을 보지 못한다. */
  @Test
  void otherTenantSeesNothing() throws Exception {
    postJson("/open", "{\"route\":\"/mail\",\"helpId\":\"mail\"}", 204);
    long t2 = TestFixtures.createTenant(baseDsl, "ACTIVE");
    useTenant(t2);
    read("kind=OPEN").andExpect(status().isOk()).andExpect(jsonPath("$.items.length()").value(0));
  }
}
