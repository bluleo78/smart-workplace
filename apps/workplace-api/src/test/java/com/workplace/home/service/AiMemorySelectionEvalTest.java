package com.workplace.home.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.ai.AiMemoryLine;
import com.workplace.home.repository.AiMemoryRepository;
import com.workplace.home.repository.TextEmbeddingRepository;
import com.workplace.home.service.AiMemoryEvalSupport.Fixture;
import com.workplace.home.service.AiMemoryEvalSupport.Memory;
import com.workplace.home.service.AiMemoryEvalSupport.Question;
import com.workplace.support.FakeTextEmbedder;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.List;
import java.util.Map;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-383 평가 세트(스펙 3.9) — 질문 12개의 기대 메모리가 블록(고정 + 상위 20, 예산 안)에 드는 비율. 키워드 + 최신 경로는 0.7 이상이고 최신 20
 * 기준선(빈 질의)보다 나아야 하며, 가짜 임베딩(동의어)을 더해도 키워드 + 최신보다 나빠지지 않는다(의미 갈래의 이득은 실제 모델 평가로 잰다). 고정은 늘 들고 블록은
 * 예산 안이다. 결과는 표준 출력으로 남긴다(완료 보고용).
 */
@Transactional
class AiMemorySelectionEvalTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired AiMemoryService service;
  @Autowired AiMemoryRepository repo;
  @Autowired TextEmbeddingRepository embeddings;
  @Autowired FakeTextEmbedder fake;

  private final Fixture fixture = AiMemoryEvalSupport.load();

  @BeforeEach
  void setUp() {
    fake.reset();
  }

  @AfterEach
  void tearDown() {
    fake.reset();
  }

  private List<Long> chosen(long uid, Question q, String text) {
    return service.loadForChat(uid, q.app(), text).items().stream().map(AiMemoryLine::id).toList();
  }

  @Test
  void 키워드와_최신만으로도_기준을_넘고_최신_20_기준선보다_낫다() {
    long uid = TestFixtures.createHuman(dsl);
    Map<String, Long> ids = AiMemoryEvalSupport.seed(repo, uid, fixture);
    fake.setEnabled(false); // 질의 임베딩 없음 — 키워드 + 최신

    double keyword = AiMemoryEvalSupport.recall(fixture, ids, q -> chosen(uid, q, q.text()));
    double baseline = AiMemoryEvalSupport.recall(fixture, ids, q -> chosen(uid, q, null));
    // 실제 도입 전 규칙(범위마다 최신 50 전부 주입)의 recall·주입 규모 — 이 픽스처는 범위당 50 이하라 전부 실려 1.0 이 된다.
    double legacy =
        AiMemoryEvalSupport.recall(
            fixture,
            ids,
            q -> AiMemoryEvalSupport.legacyKeys(fixture, q).stream().map(ids::get).toList());
    int legacyLines = 0;
    int legacyTokens = 0;
    int newLines = 0;
    int newTokens = 0;
    for (Question q : fixture.questions()) {
      int[] lt = AiMemoryEvalSupport.legacyLinesAndTokens(fixture, q);
      legacyLines += lt[0];
      legacyTokens += lt[1];
      AiMemoryService.ChatMemories m = service.loadForChat(uid, q.app(), q.text());
      newLines += m.items().size();
      newTokens += AiMemoryService.estimateBlockTokens(m);
    }
    int n = fixture.questions().size();
    System.out.printf(
        "[WP-383 eval] 도입 전 규칙(범위별 최신 50 전부) recall=%.2f, 질문당 평균 %d줄·%d토큰 / 도입 후 평균 %d줄·%d토큰%n",
        legacy, legacyLines / n, legacyTokens / n, newLines / n, newTokens / n);

    System.out.printf("[WP-383 eval] recall@20 최신20 기준선=%.2f 키워드+최신=%.2f%n", baseline, keyword);
    assertThat(keyword).isGreaterThanOrEqualTo(0.7).isGreaterThan(baseline);
  }

  /**
   * 가짜 임베딩을 더해도 키워드 + 최신보다 나빠지지 않는다. 가짜 임베딩(해시한 낱말 가방)에서는 관련 있는 질문·메모리도 거리가 0.6~0.8 이라 의미 거리
   * 상한(AiMemoryRanker.SEMANTIC_MAX_DISTANCE)이 대부분 거른다 — 그래서 의미 갈래의 실제 이득은 이 테스트가 아니라 실제 BGE-M3 평가
   * (AiMemorySelectionLiveEvalTest)로 잰다. 여기서는 임베딩이 채워져도 순위가 무너지지 않음(먼 행이 키워드 맞은 행을 밀어내지 않음)만 본다.
   */
  @Test
  void 가짜_임베딩을_더해도_키워드와_최신보다_나빠지지_않는다() {
    long uid = TestFixtures.createHuman(dsl);
    Map<String, Long> ids = AiMemoryEvalSupport.seed(repo, uid, fixture);
    fake.synonyms(fixture.synonyms());
    for (Memory m : fixture.memories()) {
      embeddings.writeMemory(
          ids.get(m.key()),
          m.content(),
          TextEmbeddingRepository.vectorLiteral(fake.expected(m.content())));
    }

    // 같은 데이터에서 질의 임베딩만 실패시키면 키워드 + 최신 경로다.
    fake.setFailing(true);
    double keywordOnly = AiMemoryEvalSupport.recall(fixture, ids, q -> chosen(uid, q, q.text()));
    fake.setFailing(false);
    double hybrid = AiMemoryEvalSupport.recall(fixture, ids, q -> chosen(uid, q, q.text()));

    System.out.printf(
        "[WP-383 eval] recall@20 키워드+최신=%.2f 키워드+의미(가짜)+최신=%.2f%n", keywordOnly, hybrid);
    assertThat(hybrid).isGreaterThanOrEqualTo(keywordOnly);
  }

  @Test
  void 고정은_늘_들어가고_블록은_예산_안이다() {
    long uid = TestFixtures.createHuman(dsl);
    Map<String, Long> ids = AiMemoryEvalSupport.seed(repo, uid, fixture);

    for (Question q : fixture.questions()) {
      AiMemoryService.ChatMemories m = service.loadForChat(uid, q.app(), q.text());
      List<Long> chosen = m.items().stream().map(AiMemoryLine::id).toList();
      for (String key : AiMemoryEvalSupport.pinnedKeys(fixture, q)) {
        assertThat(chosen).as("%s 고정 %s", q.key(), key).contains(ids.get(key));
      }
      assertThat(AiMemoryService.estimateBlockTokens(m))
          .as(q.key())
          .isLessThanOrEqualTo(AiMemoryService.MEMORY_BLOCK_TOKEN_BUDGET);
      assertThat(m.moreCount()).as(q.key()).isEqualTo(fixture.memories().size() - chosen.size());
    }
  }
}
