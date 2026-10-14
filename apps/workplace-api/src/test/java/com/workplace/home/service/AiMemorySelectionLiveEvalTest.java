package com.workplace.home.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.ai.AiMemoryLine;
import com.workplace.global.ai.TextEmbedder;
import com.workplace.home.repository.AiMemoryRepository;
import com.workplace.home.repository.TextEmbeddingRepository;
import com.workplace.home.service.AiMemoryEvalSupport.Fixture;
import com.workplace.home.service.AiMemoryEvalSupport.Memory;
import com.workplace.home.service.AiMemoryEvalSupport.Question;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-383 수동 평가(스펙 3.9) — 같은 픽스처를 실제 워커(BGE-M3)로 임베딩해 최신 20 기준선과 도입 후 recall@20 을 표로 찍는다. CI 에서는 돌지
 * 않는다 ({@code AI_MEMORY_EVAL_LIVE=1} 일 때만). 워커 주소·토큰은 환경변수로 받는다. 결과를 이슈 완료 보고에 남긴다.
 */
@Transactional
@EnabledIfEnvironmentVariable(named = "AI_MEMORY_EVAL_LIVE", matches = "1")
@TestPropertySource(
    properties = {
      "workplace.worker.enabled=true",
      "workplace.worker.embed.enabled=true",
      "workplace.worker.base-url=${AI_MEMORY_EVAL_WORKER_URL:http://localhost:6080}",
      "workplace.worker.internal-token=${INTERNAL_SERVICE_TOKEN:}"
    })
class AiMemorySelectionLiveEvalTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired AiMemoryService service;
  @Autowired AiMemoryRepository repo;
  @Autowired TextEmbeddingRepository embeddings;
  @Autowired TextEmbedder embedder;

  @Test
  void 실제_워커로_recall_을_잰다() {
    assertThat(embedder.enabled()).as("워커·임베딩이 켜져 있어야 한다").isTrue();
    Fixture f = AiMemoryEvalSupport.load();
    long uid = TestFixtures.createHuman(dsl);
    Map<String, Long> ids = AiMemoryEvalSupport.seed(repo, uid, f);
    for (Memory m : f.memories()) {
      float[] v = embedder.embedDocument(m.content()).orElseThrow();
      embeddings.writeMemory(
          ids.get(m.key()), m.content(), TextEmbeddingRepository.vectorLiteral(v));
    }
    // 질의 임베딩을 미리 받아 둔다(LRU 캐시) — 채팅 경로의 1.5초 대기가 콜드 스타트로 넘치지 않게.
    for (Question q : f.questions()) embedder.embedQuery(q.text(), Duration.ofSeconds(30));

    double baseline = AiMemoryEvalSupport.recall(f, ids, q -> ids(uid, q, null));
    double live = AiMemoryEvalSupport.recall(f, ids, q -> ids(uid, q, q.text()));

    System.out.println("[WP-383 live eval] 질문별 결과");
    for (Question q : f.questions()) {
      List<Long> chosen = ids(uid, q, q.text());
      List<String> missed =
          q.expected().stream().filter(k -> !chosen.contains(ids.get(k))).toList();
      System.out.printf(
          "  %s %-30s %s%n", q.key(), q.text(), missed.isEmpty() ? "OK" : "놓침 " + missed);
    }
    System.out.printf("[WP-383 live eval] recall@20 최신20 기준선=%.2f 도입 후=%.2f%n", baseline, live);
    assertThat(live).isGreaterThan(baseline);
  }

  private List<Long> ids(long uid, Question q, String text) {
    return service.loadForChat(uid, q.app(), text).items().stream().map(AiMemoryLine::id).toList();
  }
}
