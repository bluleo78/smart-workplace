package com.workplace.home.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.startsWith;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.tenant.TenantContext;
import com.workplace.home.repository.TextEmbeddingRepository;
import com.workplace.home.service.AiMemoryRanker;
import com.workplace.home.service.HomeSessionService;
import com.workplace.support.FakeTextEmbedder;
import com.workplace.support.FakeTextEmbedderConfig;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.user.service.AiPreferenceService;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-384 search_conversations API — 키워드·의미(가짜 임베딩, 5초 대기)로 본인 대화만, 대화마다 대표 턴 하나, 지금 대화·지운 대화·남의 대화
 * 제외, 꺼짐이면 memoryEnabled=false, 빈 질의 400, limit 기본 5·최대 10, 질문 앞 200자·답 발췌 300자, 링크 "/?chat=<id>".
 */
@Transactional
@Import(FakeTextEmbedderConfig.class)
class HomeConversationSearchApiTest extends IntegrationTestBase {

  private static final String SEARCH = "/api/v1/home/sessions/search";
  private static final double MAX_DISTANCE = AiMemoryRanker.SEMANTIC_MAX_DISTANCE;

  /**
   * "고양이" 질의와 "냥이" 답을 같은 차원으로 — 질의의 조사 뗀 형태("고양")·답의 "냥이는"까지 묶어야 턴 입력("질문: …\n답: …")의 다른 낱말이 있어도 가짜
   * 임베딩 거리가 상한(0.5) 안에 든다.
   */
  private static final List<List<String>> SYNONYMS = List.of(List.of("고양이", "고양", "냥이", "냥이는"));

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired HomeSessionService sessions;
  @Autowired TextEmbeddingRepository embeddings;
  @Autowired AiPreferenceService preferences;
  @Autowired FakeTextEmbedder fake;

  @BeforeEach
  void setUp() {
    fake.reset();
  }

  @AfterEach
  void tearDown() {
    fake.reset();
  }

  private ResultActions call(long uid, MockHttpServletRequestBuilder rb) throws Exception {
    return mvc.perform(
        rb.with(authentication(new UsernamePasswordAuthenticationToken(uid, "n/a", List.of()))));
  }

  /** ai-agent 처럼 Internal + 대행 헤더로 부른다. 필터가 지운 테스트 스레드 TenantContext 를 되돌린다. */
  private ResultActions internal(long uid, MockHttpServletRequestBuilder rb) throws Exception {
    try {
      return mvc.perform(
          rb.header("Authorization", "Internal test-token")
              .header("X-On-Behalf-Of", String.valueOf(uid)));
    } finally {
      TenantContext.set(1L);
    }
  }

  /** 질문·답 한 턴을 만들고 답에 가짜 턴 임베딩을 바로 써 넣는다(@Transactional 이라 커밋 뒤 채우기가 돌지 않는다) → 대화 id. */
  private UUID embeddedTurn(long uid, String question, String answer) {
    UUID sid = sessions.create(uid).id();
    sessions.appendMessage(uid, sid, "USER", question, null, null, null);
    long id = sessions.appendMessage(uid, sid, "ASSISTANT", answer, null, null, null);
    embeddings.writeTurn(
        id,
        TextEmbeddingRepository.vectorLiteral(
            fake.expected(TextEmbeddingRepository.turnInput(question, answer))));
    return sid;
  }

  /** 질문·답 한 턴을 가진 대화를 만든다 → 대화 id. */
  private UUID turn(long uid, String question, String answer) {
    UUID sid = sessions.create(uid).id();
    sessions.appendMessage(uid, sid, "USER", question, null, null, null);
    sessions.appendMessage(uid, sid, "ASSISTANT", answer, null, null, null);
    return sid;
  }

  @Test
  void 키워드로_찾고_대화마다_대표_턴_하나로_묶는다() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    UUID cat = turn(uid, "고양이 사진 어디 둘까", "사진/고양이 폴더에 모으세요");
    sessions.appendMessage(uid, cat, "USER", "고양이 이름 추천해 줘", null, null, null);
    sessions.appendMessage(uid, cat, "ASSISTANT", "나비 어때요", null, null, null);
    turn(uid, "커피 추천", "디카페인 라떼");

    call(uid, get(SEARCH).param("q", "고양이"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.memoryEnabled").value(true))
        .andExpect(jsonPath("$.items", hasSize(1)))
        .andExpect(jsonPath("$.items[0].sessionId").value(cat.toString()))
        .andExpect(jsonPath("$.items[0].title").value("고양이 사진 어디 둘까"))
        .andExpect(jsonPath("$.items[0].link").value("/?chat=" + cat))
        .andExpect(jsonPath("$.items[0].question", startsWith("고양이")))
        .andExpect(jsonPath("$.items[0].lastMessageAt").isNotEmpty());
  }

  @Test
  void 지금_대화와_지운_대화와_남의_대화는_나오지_않는다() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    long other = TestFixtures.createHuman(dsl);
    UUID current = turn(uid, "고양이 얘기", "귀여워요");
    UUID deleted = turn(uid, "고양이 사료", "연어 맛");
    turn(other, "고양이 장난감", "낚싯대");
    sessions.delete(uid, deleted);

    call(uid, get(SEARCH).param("q", "고양이").param("excludeSessionId", current.toString()))
        .andExpect(jsonPath("$.items", hasSize(0)));
    call(uid, get(SEARCH).param("q", "고양이"))
        .andExpect(jsonPath("$.items", hasSize(1)))
        .andExpect(jsonPath("$.items[0].sessionId").value(current.toString()));
  }

  @Test
  void 낱말이_달라도_답의_뜻으로_찾고_대기는_5초다() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    fake.synonyms(SYNONYMS);
    UUID sid = embeddedTurn(uid, "반려동물 얘기", "냥이는 귀여워요");

    call(uid, get(SEARCH).param("q", "고양이"))
        .andExpect(jsonPath("$.items", hasSize(1)))
        .andExpect(jsonPath("$.items[0].sessionId").value(sid.toString()))
        .andExpect(jsonPath("$.items[0].answerExcerpt").value("냥이는 귀여워요"));
    assertThat(fake.lastQueryTimeout()).isEqualTo(Duration.ofSeconds(5));
  }

  @Test
  void 임베딩돼_있어도_뜻이_먼_대화는_돌려주지_않는다() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    fake.synonyms(SYNONYMS);
    UUID near = embeddedTurn(uid, "반려동물 얘기", "냥이는 귀여워요");
    List<List<String>> far =
        List.of(
            List.of("커피 추천", "디카페인 라떼"), List.of("회의 시간", "오전 열 시"), List.of("보고서 양식", "표로 정리하세요"));
    for (List<String> t : far) embeddedTurn(uid, t.get(0), t.get(1));
    // 전제: 가까운 답은 상한 안, 먼 답은 상한 밖(해시 충돌로 우연히 통과하지 않게). 먼 대화는 질의 낱말도 담지 않는다.
    assertThat(fake.distance("고양이", TextEmbeddingRepository.turnInput("반려동물 얘기", "냥이는 귀여워요")))
        .isLessThanOrEqualTo(MAX_DISTANCE);
    for (List<String> t : far) {
      assertThat(fake.distance("고양이", TextEmbeddingRepository.turnInput(t.get(0), t.get(1))))
          .isGreaterThan(MAX_DISTANCE);
    }

    // 상위 50 만으로 자르면 임베딩된 네 대화가 모두 나온다 — 거리 상한으로 가까운 대화만.
    call(uid, get(SEARCH).param("q", "고양이"))
        .andExpect(jsonPath("$.items", hasSize(1)))
        .andExpect(jsonPath("$.items[0].sessionId").value(near.toString()));
  }

  @Test
  void 꺼져_있으면_memoryEnabled_false_와_빈_목록() throws Exception {
    long uid = withMembership(TestFixtures.createHuman(dsl));
    turn(uid, "고양이 얘기", "귀여워요");
    preferences.update(uid, null, false);

    internal(uid, get(SEARCH).param("q", "고양이"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.memoryEnabled").value(false))
        .andExpect(jsonPath("$.items", hasSize(0)));
  }

  @Test
  void 빈_질의는_400() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    call(uid, get(SEARCH).param("q", " "))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("AI_MEMORY_INVALID"));
  }

  @Test
  void 개수는_기본_5_최대_10() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    for (int i = 0; i < 12; i++) turn(uid, "회의 " + i, "네");

    call(uid, get(SEARCH).param("q", "회의")).andExpect(jsonPath("$.items", hasSize(5)));
    call(uid, get(SEARCH).param("q", "회의").param("limit", "50"))
        .andExpect(jsonPath("$.items", hasSize(10)));
  }

  @Test
  void 질문은_앞_200자_답은_맞은_곳_주변() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    turn(uid, "고양이 " + "질".repeat(300), "가".repeat(500) + " 고양이 폴더 " + "나".repeat(500));

    call(uid, get(SEARCH).param("q", "고양이"))
        .andExpect(jsonPath("$.items[0].question", startsWith("고양이 질")))
        .andExpect(jsonPath("$.items[0].answerExcerpt", startsWith("…")));
  }

  @Test
  void 질문이_대표면_같은_턴의_답만_짝짓고_뒤_턴의_답이나_빈_답은_붙이지_않는다() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    UUID sid = sessions.create(uid).id();
    sessions.appendMessage(uid, sid, "USER", "수족관 위치 알려줘", null, null, null);
    sessions.appendMessage(uid, sid, "ASSISTANT", "", null, null, null, "STOPPED");
    sessions.appendMessage(uid, sid, "USER", "다음 질문이야", null, null, null);
    sessions.appendMessage(uid, sid, "ASSISTANT", "다음 턴의 답", null, null, null);

    call(uid, get(SEARCH).param("q", "수족관"))
        .andExpect(jsonPath("$.items", hasSize(1)))
        .andExpect(jsonPath("$.items[0].question", startsWith("수족관")))
        .andExpect(jsonPath("$.items[0].answerExcerpt").isEmpty());
  }

  @Test
  void 질문이_대표면_바로_다음_답을_짝짓는다() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    turn(uid, "수족관 위치 알려줘", "서울숲 옆이에요");

    call(uid, get(SEARCH).param("q", "수족관"))
        .andExpect(jsonPath("$.items[0].answerExcerpt").value("서울숲 옆이에요"));
  }

  @Test
  void 기호뿐인_질의는_200이고_와일드카드가_전부와_맞지_않는다() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    turn(uid, "고양이 얘기", "귀여워요");
    turn(uid, "커피 얘기", "라떼");

    for (String q : List.of("%_?", "%", "_", "\\")) {
      call(uid, get(SEARCH).param("q", q))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.items", hasSize(0)));
    }
  }
}
