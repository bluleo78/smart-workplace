package com.workplace.help.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasKey;
import static org.hamcrest.Matchers.not;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.help.outbound.HelpBundle;
import com.workplace.help.outbound.HelpBundle.Chapter;
import com.workplace.help.outbound.HelpBundle.Figure;
import com.workplace.help.outbound.HelpBundle.Mark;
import com.workplace.help.outbound.HelpBundle.Section;
import com.workplace.help.service.HelpManualCatalog;
import com.workplace.help.service.HelpManualIndexerTest.MutableSource;
import com.workplace.help.service.HelpManualIndexerTest.TestSourceConfig;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * 매뉴얼 절 조회 API 시험(WP-1510) — 본문·그림·경로, 관리자 장 숨김(없는 id 와 같은 404, links 에서도 거름), 없는 id, 빈 목록 첫 요청의 묶음
 * 읽기, 읽기 실패의 404 와 재시도 대기, `#`·`.` 가 든 id 의 경로 매칭. setUp 의 replace 가 앞 시험의 실패 대기도 푼다.
 */
@Import(TestSourceConfig.class)
class HelpSectionApiTest extends IntegrationTestBase {

  /** 본문 원문 — 자리표시·조건 블록·그림 지시문이 그대로 나가야 한다. */
  private static final String PICK_MD =
      "{if admin}관리자는 {agent.username} 을 고릅니다.{/if}\n![위젯 고르기 화면](figure:home-3)";

  @Autowired MockMvc mvc;
  @Autowired HelpManualCatalog catalog;
  @Autowired MutableSource source;

  /** 구성원 장(위젯 → 고르기)과 관리자 전용 장. */
  private static HelpBundle bundle() {
    return new HelpBundle(
        List.of(
            new Chapter(
                "home",
                "홈",
                List.of("member", "admin"),
                List.of(
                    new Section("home.widget", "홈 위젯", "위젯", null, "위젯 본문", List.of(), List.of()),
                    new Section(
                        "home#위젯-고르기",
                        "",
                        "위젯 고르기",
                        "home.widget",
                        PICK_MD,
                        List.of(
                            new Figure(
                                "home-3",
                                "위젯 고르기 화면",
                                List.of(new Mark(1, "추가 단추"), new Mark(2, "목록")))),
                        // 관리자 장 절로 가는 링크 — 구성원 응답에서는 걸러져야 한다
                        List.of("home.widget", "agents.token")))),
            new Chapter(
                "agents",
                "AI 에이전트 관리",
                List.of("admin"),
                List.of(new Section("agents.token", "토큰", "토큰 다시 넣기", "관리자 비밀 본문")))));
  }

  @BeforeEach
  void setUp() {
    source.failure = null;
    source.bundle = bundle();
    catalog.replace(bundle());
    source.fetches.set(0);
  }

  /** id 를 MCP 클라이언트(encodeURIComponent)처럼 인코딩해 경로에 싣는다. */
  private static MockHttpServletRequestBuilder section(String id, long uid) {
    String encoded = URLEncoder.encode(id, StandardCharsets.UTF_8).replace("+", "%20");
    return get(URI.create("/api/v1/help/sections/" + encoded))
        .with(authentication(new UsernamePasswordAuthenticationToken(uid, "n/a", List.of())));
  }

  private long admin() {
    long uid = TestFixtures.createHuman(baseDsl);
    TestFixtures.grantRole(baseDsl, uid, "ADMIN");
    return uid;
  }

  @Test
  void sectionReturnsMarkdownFiguresAndPath() throws Exception {
    long uid = TestFixtures.createHuman(baseDsl);
    mvc.perform(section("home#위젯-고르기", uid))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.id").value("home#위젯-고르기"))
        .andExpect(jsonPath("$.chapter").value("home"))
        .andExpect(jsonPath("$.chapterTitle").value("홈"))
        // 빈 label 은 title 로
        .andExpect(jsonPath("$.label").value("위젯 고르기"))
        .andExpect(jsonPath("$.title").value("위젯 고르기"))
        .andExpect(jsonPath("$.path[0]").value("홈 위젯"))
        .andExpect(jsonPath("$.path[1]").value("위젯 고르기"))
        .andExpect(jsonPath("$.markdown").value(PICK_MD))
        .andExpect(jsonPath("$.figures[0].id").value("home-3"))
        .andExpect(jsonPath("$.figures[0].alt").value("위젯 고르기 화면"))
        .andExpect(jsonPath("$.figures[0]", not(hasKey("src"))))
        .andExpect(jsonPath("$.figures[0].marks[1].n").value(2))
        .andExpect(jsonPath("$.figures[0].marks[1].label").value("목록"))
        .andExpect(jsonPath("$.figures[0].marks[1]", not(hasKey("key"))))
        .andExpect(jsonPath("$.links[0]").value("home.widget"));
  }

  @Test
  void linksToAdminChapterHiddenFromMember() throws Exception {
    long member = TestFixtures.createHuman(baseDsl);
    mvc.perform(section("home#위젯-고르기", member))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.links.length()").value(1))
        .andExpect(jsonPath("$.links[0]").value("home.widget"));
    mvc.perform(section("home#위젯-고르기", admin()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.links.length()").value(2))
        .andExpect(jsonPath("$.links[1]").value("agents.token"));
  }

  @Test
  void idWithDotIsReachable() throws Exception {
    long uid = TestFixtures.createHuman(baseDsl);
    mvc.perform(section("home.widget", uid))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.id").value("home.widget"))
        .andExpect(jsonPath("$.path.length()").value(1));
  }

  @Test
  void idWithHashIsReachable() throws Exception {
    long uid = TestFixtures.createHuman(baseDsl);
    mvc.perform(section("home#위젯-고르기", uid))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.id").value("home#위젯-고르기"));
  }

  @Test
  void adminChapterHiddenFromMember() throws Exception {
    long member = TestFixtures.createHuman(baseDsl);
    mvc.perform(section("agents.token", member))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.message").value("매뉴얼 절을 찾을 수 없습니다"))
        .andExpect(
            result ->
                assertThat(result.getResponse().getContentAsString()).doesNotContain("관리자 비밀"));
    mvc.perform(section("agents.token", admin()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.markdown").value("관리자 비밀 본문"));
  }

  @Test
  void unknownIdIs404() throws Exception {
    long uid = TestFixtures.createHuman(baseDsl);
    mvc.perform(section("no.such", uid))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.message").value("매뉴얼 절을 찾을 수 없습니다"));
  }

  @Test
  void emptyCatalogLoadsBundleOnFirstRequest() throws Exception {
    catalog.replace(new HelpBundle(List.of()));
    long uid = TestFixtures.createHuman(baseDsl);
    mvc.perform(section("home.widget", uid)).andExpect(status().isOk());
    mvc.perform(section("home#위젯-고르기", uid)).andExpect(status().isOk());
    // 두 요청에 읽기는 한 번
    assertThat(source.fetches.get()).isEqualTo(1);
  }

  @Test
  void bundleFetchFailureIs404NotServerError() throws Exception {
    catalog.replace(new HelpBundle(List.of()));
    source.failure = new IOException("웹이 아직 안 떴다");
    long uid = TestFixtures.createHuman(baseDsl);
    mvc.perform(section("home.widget", uid))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.message", containsString("매뉴얼 절")));
    // 웹이 돌아와도 재시도 대기(1분) 동안은 다시 읽지 않는다 — 요청마다 웹을 두드리지 않게
    source.failure = null;
    mvc.perform(section("home.widget", uid)).andExpect(status().isNotFound());
    assertThat(source.fetches.get()).isEqualTo(1);
  }

  @Test
  void anonymousIs401() throws Exception {
    mvc.perform(get("/api/v1/help/sections/home.widget")).andExpect(status().isUnauthorized());
  }
}
