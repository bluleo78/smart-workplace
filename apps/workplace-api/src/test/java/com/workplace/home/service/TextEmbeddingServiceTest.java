package com.workplace.home.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.home.AiMemoryTestFixtures;
import com.workplace.home.dto.UpdateAiMemoryRequest;
import com.workplace.home.repository.TextEmbeddingRepository;
import com.workplace.support.FakeTextEmbedder;
import com.workplace.support.MemoryEmbeddingProbe;
import com.workplace.support.TestFixtures;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executor;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * WP-383 메모리 임베딩 채우기 — 커밋 뒤 채움, 롤백이면 안 함, 내용이 바뀌면 같은 UPDATE 에서 비우고 새 내용으로 다시 채움, 범위만 바꾸면 그대로, 늦게 끝난
 * 옛 임베딩은 바뀐 내용을 덮지 않음, 백필(워커가 실패하면 멈추고 다음 주기). 각 단계가 실제로 커밋돼야 해 @Transactional 을 쓰지 않는다
 * (AiMemoryRaceTestSupport). 커밋 뒤 작업은 호출 스레드에서 바로 돌려(useExecutorForTest) 시간 대기 없이 확인한다.
 */
class TextEmbeddingServiceTest extends AiMemoryRaceTestSupport {

  @Autowired AiMemoryService service;
  @Autowired TextEmbeddingService embeddingService;
  @Autowired TextEmbeddingRepository embeddings;
  @Autowired TextEmbeddingBackfillScheduler backfill;
  @Autowired FakeTextEmbedder fake;

  private MemoryEmbeddingProbe probe;
  private Executor originalExecutor;

  @BeforeEach
  void setUp() {
    fake.reset();
    probe = new MemoryEmbeddingProbe(dsl, txManager, fake);
    originalExecutor = embeddingService.useExecutorForTest(Runnable::run);
  }

  /** 공유 Spring 컨텍스트 오염 방지 — 실행기와 가짜 상태를 되돌린다. */
  @AfterEach
  void tearDown() {
    embeddingService.useExecutorForTest(originalExecutor);
    fake.reset();
  }

  private long user() {
    long uid = TestFixtures.createHuman(dsl);
    users.add(uid);
    return uid;
  }

  private long create(long uid, String content) {
    return inTenant(
        () -> AiMemoryTestFixtures.createMemory(service, uid, "PREFERENCE", content).id());
  }

  private boolean embeddingIs(long id, String text) {
    return probe.embeddingIs(id, text);
  }

  private boolean embeddingEmptyHere(long id) {
    return probe.embeddingEmptyHere(id);
  }

  private static UpdateAiMemoryRequest content(String c) {
    UpdateAiMemoryRequest r = new UpdateAiMemoryRequest();
    r.setContent(c);
    return r;
  }

  private static UpdateAiMemoryRequest scope(String s) {
    UpdateAiMemoryRequest r = new UpdateAiMemoryRequest();
    r.setScope(s);
    return r;
  }

  @Test
  void 저장하면_커밋_뒤에_임베딩이_채워진다() {
    long id = create(user(), "고양이를 좋아한다");
    assertThat(embeddingIs(id, "고양이를 좋아한다")).isTrue();
  }

  @Test
  void 롤백된_저장은_임베딩하지_않는다() {
    long uid = user();
    TenantContext.set(1L);
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            s -> {
              AiMemoryTestFixtures.createMemory(service, uid, "PREFERENCE", "버릴 것");
              s.setRollbackOnly();
            });
    assertThat(fake.documentCalls()).isZero();
  }

  @Test
  void 내용을_고치면_같은_UPDATE_에서_비우고_커밋_뒤_새_내용으로_채운다() {
    long uid = user();
    long id = create(uid, "고양이를 좋아한다");
    boolean emptyInTx =
        inTenant(
            () -> {
              service.update(uid, id, content("강아지를 좋아한다"), false);
              return embeddingEmptyHere(id);
            });
    assertThat(emptyInTx).isTrue();
    assertThat(embeddingIs(id, "강아지를 좋아한다")).isTrue();
  }

  @Test
  void 범위만_옮기면_임베딩은_그대로다() {
    long uid = user();
    long id = create(uid, "이슈 목록은 짧게");
    int calls = fake.documentCalls();
    inTenant(() -> service.update(uid, id, scope("ISSUE"), false));
    assertThat(embeddingIs(id, "이슈 목록은 짧게")).isTrue();
    assertThat(fake.documentCalls()).isEqualTo(calls);
  }

  @Test
  void 늦게_끝난_옛_임베딩은_바뀐_내용을_덮지_않는다() {
    long uid = user();
    fake.setEnabled(false);
    long id = create(uid, "첫 내용");
    inTenant(() -> service.update(uid, id, content("새 내용"), false));
    String old = TextEmbeddingRepository.vectorLiteral(fake.expected("첫 내용"));
    String fresh = TextEmbeddingRepository.vectorLiteral(fake.expected("새 내용"));
    assertThat(inTenant(() -> embeddings.writeMemory(id, "첫 내용", old))).isZero();
    assertThat(inTenant(() -> embeddings.writeMemory(id, "새 내용", fresh))).isEqualTo(1);
    // 이미 채워졌으면 다시 쓰지 않는다(커밋 뒤 작업과 백필의 경쟁, 판정 14).
    assertThat(inTenant(() -> embeddings.writeMemory(id, "새 내용", fresh))).isZero();
  }

  @Test
  void 백필은_워커가_실패하면_멈추고_다음_주기에_채운다() {
    long uid = user();
    fake.setEnabled(false);
    long a = create(uid, "백필 하나");
    long b = create(uid, "백필 둘");
    fake.setEnabled(true);
    fake.setFailing(true);

    backfill.backfillOnce();
    assertThat(embeddingIs(a, "백필 하나")).isFalse();

    fake.setFailing(false);
    // 다른 테스트가 남긴 빈 행이 앞에 있을 수 있어 0 이 될 때까지(최대 20 주기) 돌린다.
    for (int i = 0; i < 20 && backfill.backfillOnce() > 0; i++) {}
    assertThat(embeddingIs(a, "백필 하나")).isTrue();
    assertThat(embeddingIs(b, "백필 둘")).isTrue();
  }

  @Test
  void 늘_실패하는_행_하나가_뒤_행을_막지_않는다() {
    long uid = user();
    fake.setEnabled(false);
    long poison = create(uid, "워커가 거절하는 내용");
    long ok = create(uid, "정상 내용");
    fake.setEnabled(true);
    fake.failOn("워커가 거절하는 내용");

    for (int i = 0; i < 20 && backfill.backfillOnce() > 0; i++) {}

    assertThat(embeddingIs(ok, "정상 내용")).isTrue();
    assertThat(embeddingIs(poison, "워커가 거절하는 내용")).isFalse();
  }

  @Test
  void 늘_실패하는_행이_연달아_있어도_다음_주기에는_다른_행을_먼저_채운다() {
    long uid = user();
    fake.setEnabled(false);
    // 연속 실패 상한만큼의 독성 행이 정상 행보다 앞(id 오름차순)에 있다 — 예전엔 매 주기 여기서 멈춰 뒤 행(다른 테넌트 포함)을 영영 못 채웠다.
    List<Long> poison = new ArrayList<>();
    for (int i = 0; i < TextEmbeddingBackfillScheduler.MAX_CONSECUTIVE_FAILURES; i++) {
      String text = "워커가 거절하는 내용 " + i;
      poison.add(create(uid, text));
      fake.failOn(text);
    }
    long ok = create(uid, "정상 내용");
    fake.setEnabled(true);

    // 한 주기가 멈추면 0 을 돌려주므로 "> 0 인 동안" 이 아니라 정상 행이 채워질 때까지(최대 20 주기) 돌린다.
    for (int i = 0; i < 20 && !embeddingIs(ok, "정상 내용"); i++) backfill.backfillOnce();

    assertThat(embeddingIs(ok, "정상 내용")).isTrue();
    for (int i = 0; i < poison.size(); i++) {
      assertThat(embeddingIs(poison.get(i), "워커가 거절하는 내용 " + i)).isFalse();
    }
  }

  @Test
  void 임베딩이_꺼져_있으면_백필은_아무것도_하지_않는다() {
    fake.setEnabled(false);
    create(user(), "꺼짐");
    assertThat(backfill.backfillOnce()).isZero();
    assertThat(fake.documentCalls()).isZero();
  }
}
