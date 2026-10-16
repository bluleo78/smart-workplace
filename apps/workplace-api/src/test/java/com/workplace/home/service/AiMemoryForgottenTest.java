package com.workplace.home.service;

import static com.workplace.jooq.Tables.AI_MEMORY;
import static com.workplace.jooq.Tables.AI_MEMORY_FORGOTTEN;
import static com.workplace.jooq.Tables.HOME_SESSION;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.home.AiMemoryTestFixtures;
import com.workplace.home.dto.AiMemoryItem;
import com.workplace.home.dto.CreateAiMemoryRequest;
import com.workplace.home.dto.UndoAiMemoryRequest;
import com.workplace.home.repository.AiMemoryForgottenRepository;
import com.workplace.support.FakeTextEmbedder;
import com.workplace.support.FakeTextEmbedderConfig;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executor;
import java.util.function.Supplier;
import java.util.stream.IntStream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * WP-385 지운 기록 — 설정 지움·forget_memory·모두 지우기·결과 줄 「저장」 되돌리기가 남기고, 사용자당 500행, 직접 다시 기억하면 겹치는 기록(정규화
 * 같음은 즉시, 의미가 가까운 것은 커밋 뒤)을 지우며, 임베딩은 커밋 뒤·백필이 채운다. 커밋 뒤 작업을 호출 스레드에서 돌리려고 트랜잭션 없이(커밋) 돌린다.
 */
@Import(FakeTextEmbedderConfig.class)
class AiMemoryForgottenTest extends IntegrationTestBase {

  @Autowired AiMemoryService service;
  @Autowired AiMemoryUndoService undoService;
  @Autowired HomeSessionService sessions;
  @Autowired AiMemoryForgottenService forgotten;
  @Autowired AiMemoryForgottenRepository forgottenRepo;
  @Autowired TextEmbeddingService embeddingService;
  @Autowired TextEmbeddingBackfillScheduler backfill;
  @Autowired FakeTextEmbedder fake;

  private final List<Long> users = new ArrayList<>();
  private Executor prevForgotten;
  private Executor prevEmbedding;

  @BeforeEach
  void setUp() {
    fake.reset();
    prevForgotten = forgotten.useExecutorForTest(Runnable::run);
    prevEmbedding = embeddingService.useExecutorForTest(Runnable::run);
    TenantContext.set(1L);
  }

  @AfterEach
  void tearDown() {
    forgotten.useExecutorForTest(prevForgotten);
    embeddingService.useExecutorForTest(prevEmbedding);
    cleanupInTenant(
        1L,
        () -> {
          baseDsl
              .deleteFrom(AI_MEMORY_FORGOTTEN)
              .where(AI_MEMORY_FORGOTTEN.USER_ID.in(users))
              .execute();
          baseDsl.deleteFrom(AI_MEMORY).where(AI_MEMORY.USER_ID.in(users)).execute();
          baseDsl.deleteFrom(HOME_SESSION).where(HOME_SESSION.USER_ID.in(users)).execute();
        });
    baseDsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
    fake.reset();
    TenantContext.clear();
  }

  private <T> T inTenant(Supplier<T> work) {
    return new TransactionTemplate(txManager).execute(s -> work.get());
  }

  private long user() {
    long uid = TestFixtures.createHuman(baseDsl);
    users.add(uid);
    return uid;
  }

  /** AI 대행 저장(remember_memory 와 같은 경로). */
  private AiMemoryItem remember(long uid, String content) {
    return service.create(
        uid, new CreateAiMemoryRequest("PREFERENCE", content, "AI", null, null, null), true);
  }

  private List<String> forgottenOf(long uid) {
    return inTenant(() -> AiMemoryTestFixtures.forgottenContents(baseDsl, uid));
  }

  @Test
  void 설정에서_지우면_지운_기록이_남는다() {
    long uid = user();
    AiMemoryItem m = AiMemoryTestFixtures.createMemory(service, uid, "PREFERENCE", "보고서는 표로!");
    service.delete(uid, m.id(), false);
    assertThat(forgottenOf(uid)).containsExactly("보고서는 표로!");
    assertThat(
            inTenant(
                () ->
                    baseDsl
                        .select(AI_MEMORY_FORGOTTEN.NORMALIZED)
                        .from(AI_MEMORY_FORGOTTEN)
                        .where(AI_MEMORY_FORGOTTEN.USER_ID.eq(uid))
                        .fetchOne(AI_MEMORY_FORGOTTEN.NORMALIZED)))
        .isEqualTo("보고서는표로");
  }

  @Test
  void 대화에서_forget_memory_로_지워도_남는다() {
    long uid = user();
    AiMemoryItem m = remember(uid, "회의록은 영어로 쓴다");
    service.delete(uid, m.id(), true);
    assertThat(forgottenOf(uid)).containsExactly("회의록은 영어로 쓴다");
  }

  @Test
  void 모두_지우기는_지운_내용을_모두_남긴다() {
    long uid = user();
    remember(uid, "가");
    remember(uid, "나");
    service.clear(uid);
    assertThat(forgottenOf(uid)).containsExactlyInAnyOrder("가", "나");
  }

  @Test
  void 채팅_결과_줄_저장_되돌리기도_지운_기록에_넣는다() {
    long uid = user();
    AiMemoryItem m = remember(uid, "WP 프로젝트 배포 일을 맡고 있다");
    long messageId =
        inTenant(
            () ->
                AiMemoryTestFixtures.assistantMessageWithMemory(
                    sessions,
                    uid,
                    AiMemoryTestFixtures.memoryBlock(
                        "saved", m.id(), "PREFERENCE", m.content(), null, "AI")));

    undoService.undo(uid, new UndoAiMemoryRequest(messageId, 0));

    assertThat(forgottenOf(uid)).containsExactly("WP 프로젝트 배포 일을 맡고 있다");
  }

  @Test
  void 사용자당_500개를_넘으면_오래된_것부터_지운다() {
    long uid = user();
    List<String> many = IntStream.rangeClosed(1, 501).mapToObj(i -> "기록 " + i).toList();
    inTenant(() -> forgottenRepo.insertAll(uid, many));
    inTenant(() -> forgottenRepo.trimToCap(uid));
    List<String> left = forgottenOf(uid);
    assertThat(left).hasSize(AiMemoryForgottenRepository.USER_CAP);
    assertThat(left).doesNotContain("기록 1").contains("기록 2", "기록 501");
  }

  @Test
  void 직접_다시_기억하면_정규화가_같은_지운_기록을_지운다() {
    long uid = user();
    AiMemoryItem m = remember(uid, "보고서는 표로!");
    service.delete(uid, m.id(), true);
    assertThat(forgottenOf(uid)).hasSize(1);

    remember(uid, "보고서는 표로");

    assertThat(forgottenOf(uid)).isEmpty();
  }

  @Test
  void 의미가_가까운_지운_기록은_커밋_뒤에_지운다() {
    long uid = user();
    // 조사가 붙은 형태도 같은 차원으로 모은다(가짜 임베딩은 SearchTerms 낱말 — 원형과 조사 뗀 형태를 모두 센다).
    fake.synonyms(List.of(List.of("고양이", "냥이"), List.of("고양이를", "냥이를")));
    AiMemoryItem m = remember(uid, "고양이를 좋아한다");
    service.delete(uid, m.id(), true); // 커밋 뒤 FORGOTTEN 임베딩이 호출 스레드에서 채워진다
    assertThat(fake.distance("고양이를 좋아한다", "냥이를 좋아한다"))
        .isLessThanOrEqualTo(AiMemoryRanker.SEMANTIC_MAX_DISTANCE);

    remember(uid, "냥이를 좋아한다");

    assertThat(forgottenOf(uid)).isEmpty();
  }

  @Test
  void 겹침_판정은_정규화_같음_또는_임베딩_거리로_한다() {
    long uid = user();
    AiMemoryItem m = remember(uid, "배포는 API 먼저 한다");
    service.delete(uid, m.id(), true);

    assertThat(inTenant(() -> forgotten.isForgotten(uid, "배포는 api 먼저 한다.", null))).isTrue();
    assertThat(
            inTenant(
                () -> forgotten.isForgotten(uid, "API 먼저 배포한다", fake.expected("배포는 API 먼저 한다"))))
        .isTrue();
    assertThat(inTenant(() -> forgotten.isForgotten(uid, "메일은 짧게 쓴다", null))).isFalse();
    assertThat(inTenant(() -> forgotten.isForgotten(uid, "메일은 짧게 쓴다", fake.expected("메일은 짧게 쓴다"))))
        .isFalse();
  }

  @Test
  void 임베딩_백필은_지운_기록도_채운다() {
    long uid = user();
    fake.setEnabled(false); // 커밋 뒤 채우기를 막아 빈 임베딩을 남긴다
    AiMemoryItem m = remember(uid, "답은 존댓말로 한다");
    service.delete(uid, m.id(), true);
    fake.setEnabled(true);

    // 다른 테스트가 남긴 빈 행이 앞에 있을 수 있어 더 채울 게 없을 때까지(최대 20 주기) 돌린다.
    for (int i = 0; i < 20 && backfill.backfillOnce() > 0; i++) {}

    assertThat(
            inTenant(
                () ->
                    baseDsl.fetchCount(
                        AI_MEMORY_FORGOTTEN,
                        AI_MEMORY_FORGOTTEN
                            .USER_ID
                            .eq(uid)
                            .and(AI_MEMORY_FORGOTTEN.EMBEDDING.isNotNull()))))
        .isEqualTo(1);
  }
}
