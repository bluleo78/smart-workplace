package com.workplace.help.controller;

import static org.hamcrest.Matchers.hasKey;
import static org.hamcrest.Matchers.not;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.help.outbound.HelpBundle;
import com.workplace.help.outbound.HelpBundle.Chapter;
import com.workplace.help.outbound.HelpBundle.Section;
import com.workplace.help.service.HelpManualCatalog;
import com.workplace.help.service.HelpManualIndexer;
import com.workplace.support.FakeTextEmbedder;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.test.web.servlet.MockMvc;

/** 도움말 검색 API 시험(WP-1509) — 응답 형태(score 없음)·화면 칸 경로(WP-1510)와 인증. */
class HelpSearchApiTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired HelpManualIndexer indexer;
  @Autowired HelpManualCatalog catalog;
  @Autowired FakeTextEmbedder fake;

  @BeforeEach
  void setUp() {
    fake.reset();
    baseDsl.execute("DELETE FROM help_manual_section");
    HelpBundle bundle =
        new HelpBundle(
            List.of(
                new Chapter(
                    "15-agents",
                    "에이전트",
                    List.of("member"),
                    List.of(
                        new Section(
                            "agents#_intro",
                            "에이전트 관리",
                            "에이전트",
                            null,
                            "구성원을 다룹니다",
                            List.of(),
                            List.of()),
                        new Section(
                            "agents.token",
                            "",
                            "토큰 다시 넣기",
                            "agents#_intro",
                            "만료된 토큰을 새로 넣습니다",
                            List.of(),
                            List.of())))));
    indexer.sync(bundle);
    // 절 목록은 색인기가 채우지 않는다(파드마다 HelpCatalogRefresher) — 경로 확인을 위해 같은 묶음을 직접 넣는다
    catalog.replace(bundle);
    indexer.embedMissing(50);
  }

  @Test
  void memberGetsResultsWithoutScore() throws Exception {
    long uid = TestFixtures.createHuman(baseDsl);
    mvc.perform(
            get("/api/v1/help/search")
                .param("q", "토큰")
                .with(
                    authentication(new UsernamePasswordAuthenticationToken(uid, "n/a", List.of()))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.mode").value("SEMANTIC"))
        .andExpect(jsonPath("$.results[0].sectionId").value("agents.token"))
        .andExpect(jsonPath("$.results[0]", not(hasKey("score"))));
  }

  @Test
  void searchResultsCarryLabelPath() throws Exception {
    long uid = TestFixtures.createHuman(baseDsl);
    // 장 최상위 → 그 절, 빈 label 은 title 로(WP-1510)
    mvc.perform(
            get("/api/v1/help/search")
                .param("q", "토큰")
                .with(
                    authentication(new UsernamePasswordAuthenticationToken(uid, "n/a", List.of()))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.results[0].sectionId").value("agents.token"))
        .andExpect(jsonPath("$.results[0].path[0]").value("에이전트 관리"))
        .andExpect(jsonPath("$.results[0].path[1]").value("토큰 다시 넣기"))
        .andExpect(jsonPath("$.results[0].path.length()").value(2));
  }

  @Test
  void anonymousIs401() throws Exception {
    mvc.perform(get("/api/v1/help/search").param("q", "토큰")).andExpect(status().isUnauthorized());
  }
}
