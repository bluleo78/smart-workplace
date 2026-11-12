package com.workplace.help.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import com.workplace.help.outbound.HelpBundle;
import com.workplace.help.outbound.HelpBundle.Chapter;
import com.workplace.help.outbound.HelpBundle.Section;
import com.workplace.help.service.HelpSearchService.HelpSearchMode;
import com.workplace.help.service.HelpSearchService.HelpSearchResult;
import com.workplace.support.FakeTextEmbedder;
import com.workplace.support.IntegrationTestBase;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** 도움말 검색 서비스 통합 시험(WP-1509) — 의미 순위·관리자 장 숨김·키워드 강등·미임베딩 절·발췌·상한. */
class HelpSearchServiceTest extends IntegrationTestBase {

  @Autowired HelpSearchService search;
  @Autowired HelpManualIndexer indexer;
  @Autowired FakeTextEmbedder fake;

  /** 고정 묶음 — 구성원 장(15·03)과 관리자 전용 장(16). */
  private static HelpBundle bundle() {
    return new HelpBundle(
        List.of(
            new Chapter(
                "03-home",
                "홈",
                List.of("member"),
                List.of(new Section("home.widget", "", "홈 위젯", "화면 첫머리에 위젯이 모입니다"))),
            new Chapter(
                "15-agents",
                "에이전트",
                List.of("member", "admin"),
                List.of(new Section("agents.token", "", "토큰 다시 넣기", "만료된 토큰을 새로 넣습니다"))),
            new Chapter(
                "16-admin",
                "관리",
                List.of("admin"),
                List.of(new Section("admin.sso", "", "SSO 연결", "회사 계정으로 로그인하게 연결합니다")))));
  }

  @BeforeEach
  void setUp() {
    fake.reset();
    baseDsl.execute("DELETE FROM help_manual_section");
    indexer.sync(bundle());
    indexer.embedMissing(50);
  }

  @Test
  void semanticSynonymRanksFirst() {
    fake.synonyms(List.of(List.of("만료", "유효기간")));
    // 가짜 코사인이 0.45 에 닿으려면 절 텍스트의 서로 다른 낱말이 적어야 한다 — 대상 절만 짧게 바꾼다(상수는 그대로).
    // 동의어 묶음은 색인 뒤에 정해졌으므로 임베딩도 다시 채운다.
    List<Chapter> chs = new ArrayList<>(bundle().chapters());
    chs.set(
        1,
        new Chapter(
            "15-agents",
            "안내",
            List.of("member", "admin"),
            List.of(new Section("agents.token", "만료", "만료", "만료"))));
    indexer.sync(new HelpBundle(chs));
    baseDsl.execute("UPDATE help_manual_section SET embedding = NULL");
    indexer.embedMissing(50);
    // 질의의 어떤 낱말도 어느 절의 이름·본문에 글자로 들어 있지 않다 — 동의어 임베딩만이 잇는다
    HelpSearchResult r = search.search("유효기간", false, 8);
    assertThat(r.mode()).isEqualTo(HelpSearchMode.SEMANTIC);
    assertThat(r.hits()).isNotEmpty();
    assertThat(r.hits().get(0).sectionId()).isEqualTo("agents.token");
    // 관계없는 절은 후보(유사도 0.45 미만, 낱말 없음)에도 들지 못한다
    assertThat(r.hits()).extracting("sectionId").containsExactly("agents.token");
  }

  @Test
  void memberDoesNotSeeAdminChapter() {
    assertThat(search.search("SSO", false, 8).hits())
        .extracting("chapter")
        .doesNotContain("16-admin");
    assertThat(search.search("SSO", true, 8).hits()).extracting("chapter").contains("16-admin");
  }

  @Test
  void keywordFallbackWhenEmbedFails() {
    fake.setFailing(true);
    HelpSearchResult r = search.search("토큰", false, 8);
    assertThat(r.mode()).isEqualTo(HelpSearchMode.KEYWORD);
    assertThat(r.hits().get(0).sectionId()).isEqualTo("agents.token");
  }

  @Test
  void unembeddedSectionFoundByKeyword() {
    HelpBundle b = bundle();
    List<Chapter> chs = new ArrayList<>(b.chapters());
    chs.add(
        new Chapter(
            "17-new",
            "새 장",
            List.of("member"),
            List.of(new Section("new.one", "", "깜빡이등 설정", "본문"))));
    indexer.sync(new HelpBundle(chs)); // 임베딩 전
    HelpSearchResult r = search.search("깜빡이등", false, 8);
    assertThat(r.hits()).extracting("sectionId").contains("new.one");
  }

  @Test
  void unrelatedQueryReturnsEmpty() {
    // 낱말도 의미도 안 겹치면 SEMANTIC 이어도 0건(유사도 하한 미만)
    HelpSearchResult r = search.search("zzzqqq xxxyyy", true, 8);
    assertThat(r.mode()).isEqualTo(HelpSearchMode.SEMANTIC);
    assertThat(r.hits()).isEmpty();
  }

  @Test
  void blankAndLongQuery() {
    assertThat(search.search("   ", false, 8).hits()).isEmpty();
    assertThat(fake.queryCalls()).isZero();
    String longQ = "가".repeat(300);
    assertThat(search.search(longQ, false, 8)).isNotNull();
    assertThat(fake.lastQueryText()).hasSize(200);
  }

  @Test
  void snippetIs160Chars() {
    HelpBundle b =
        new HelpBundle(
            List.of(
                new Chapter(
                    "01",
                    "긴 장",
                    List.of("member"),
                    List.of(new Section("long.one", "", "긴절", "나".repeat(500))))));
    indexer.sync(b);
    HelpSearchResult r = search.search("긴절", false, 8);
    assertThat(r.hits().get(0).snippet()).hasSize(160);
  }

  @Test
  void limitCappedAt20() {
    List<Section> secs = new ArrayList<>();
    for (int i = 0; i < 30; i++) secs.add(new Section("many." + i, "", "공통어 " + i, "본문 " + i));
    indexer.sync(new HelpBundle(List.of(new Chapter("01", "많은 장", List.of("member"), secs))));
    assertThat(search.search("공통어", false, 100).hits()).hasSize(20);
    assertThat(search.search("공통어", false, 3).hits()).hasSize(3);
  }

  @Test
  void oneLetterQueryTokenDoesNotPullInSections() {
    // "토" 한 글자는 "토큰" 절의 이름·본문에 들어 있어도 보너스로 세지 않는다
    assertThat(search.search("토", false, 8).hits()).isEmpty();
    // 두 글자 이상 낱말은 그대로 일치로 잡힌다
    assertThat(search.search("토큰", false, 8).hits())
        .extracting("sectionId")
        .contains("agents.token");
  }

  @Test
  void particleIsStrippedForTitleBonus() {
    // 조사가 붙은 "토큰을" 도 조사를 뗀 "토큰" 으로 절 이름 "토큰 다시 넣기" 에 맞아 이름 보너스를 받는다(SearchTerms).
    // 키워드 모드라 점수는 보너스뿐 — 이름(0.15) + 본문 "토큰을"(0.05).
    fake.setFailing(true);
    HelpSearchResult r = search.search("토큰을", false, 8);
    assertThat(r.mode()).isEqualTo(HelpSearchMode.KEYWORD);
    assertThat(r.hits()).extracting("sectionId").containsExactly("agents.token");
    assertThat(r.hits().get(0).score())
        .isCloseTo(HelpSearchService.TITLE_BONUS + HelpSearchService.BODY_BONUS, within(1e-9));
  }

  @Test
  void longQueryIsCutByCodePoints() {
    // 이모지(서로게이트 쌍) 300개 — 200 코드포인트에서 자르면 UTF-16 으로 400 칸
    search.search("😀".repeat(300), false, 8);
    assertThat(fake.lastQueryText().codePointCount(0, fake.lastQueryText().length()))
        .isEqualTo(200);
    assertThat(fake.lastQueryText()).hasSize(400);
  }
}
