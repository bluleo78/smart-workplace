package com.workplace.home.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.ai.AiMemoryLine;
import com.workplace.home.repository.AiMemoryRepository;
import com.workplace.home.repository.TextEmbeddingRepository;
import com.workplace.home.service.AiMemoryEvalSupport.Fixture;
import com.workplace.home.service.AiMemoryEvalSupport.Memory;
import com.workplace.home.service.AiMemoryEvalSupport.Question;
import com.workplace.support.FakeTextEmbedder;
import com.workplace.support.FakeTextEmbedderConfig;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.List;
import java.util.Map;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-383 평가 세트(스펙 3.9) — 질문 12개의 기대 메모리가 블록(고정 + 상위 20, 예산 안)에 드는 비율. 키워드 + 최신 경로는 0.7 이상이고 최신 20
 * 기준선(빈 질의)보다 나아야 하며, 가짜 임베딩(동의어)을 더하면 0.9 이상. 고정은 늘 들고 블록은 예산 안이다. 결과는 표준 출력으로 남긴다(완료 보고용).
 */
@Transactional
@Import(FakeTextEmbedderConfig.class)
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

  @Test
  void 가짜_임베딩을_더하면_의미로만_맞는_질문까지_찾는다() {
    long uid = TestFixtures.createHuman(dsl);
    Map<String, Long> ids = AiMemoryEvalSupport.seed(repo, uid, fixture);
    fake.synonyms(fixture.synonyms());
    for (Memory m : fixture.memories()) {
      embeddings.writeMemory(
          ids.get(m.key()),
          m.content(),
          TextEmbeddingRepository.vectorLiteral(fake.expected(m.content())));
    }

    double hybrid = AiMemoryEvalSupport.recall(fixture, ids, q -> chosen(uid, q, q.text()));

    System.out.printf("[WP-383 eval] recall@20 키워드+의미(가짜)+최신=%.2f%n", hybrid);
    assertThat(hybrid).isGreaterThanOrEqualTo(0.9);
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
