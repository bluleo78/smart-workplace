package com.workplace.home.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.home.repository.TextEmbeddingRepository;
import com.workplace.support.FakeTextEmbedder;
import com.workplace.support.FakeTextEmbedderConfig;
import com.workplace.support.MemoryEmbeddingProbe;
import com.workplace.support.TestFixtures;
import java.util.UUID;
import java.util.concurrent.Executor;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

/**
 * WP-384 대화 턴 임베딩 — 완료된 답은 커밋 뒤 "질문: …\n답: …"(2,000자)로 채우고, 중단·실패 답과 사용자 메시지는 채우지 않으며, 놓친 완료 답은 백필이
 * 메모리 다음에 채운다. 커밋돼야 하므로 @Transactional 을 쓰지 않는다(AiMemoryRaceTestSupport 가 대화를 지운다).
 */
@Import(FakeTextEmbedderConfig.class)
class TurnEmbeddingTest extends AiMemoryRaceTestSupport {

  @Autowired HomeSessionService sessions;
  @Autowired TextEmbeddingService embeddingService;
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

  private UUID session(long uid) {
    return inTenant(() -> sessions.create(uid).id());
  }

  private long append(long uid, UUID sid, String role, String content, String status) {
    return inTenant(
        () -> sessions.appendMessage(uid, sid, role, content, null, null, null, status));
  }

  @Test
  void 완료된_답은_직전_질문과_함께_임베딩한다() {
    long uid = user();
    UUID sid = session(uid);
    append(uid, sid, "USER", "고양이 사진 어디 둘까", "COMPLETE");
    long answer = append(uid, sid, "ASSISTANT", "사진/고양이 폴더에 모으세요", "COMPLETE");

    assertThat(probe.turnEmbeddingIs(answer, "질문: 고양이 사진 어디 둘까\n답: 사진/고양이 폴더에 모으세요")).isTrue();
  }

  @Test
  void 중단_실패한_답과_사용자_메시지는_임베딩하지_않는다() {
    long uid = user();
    UUID sid = session(uid);
    long question = append(uid, sid, "USER", "질문", "COMPLETE");
    long stopped = append(uid, sid, "ASSISTANT", "중간까지", "STOPPED");
    long failed = append(uid, sid, "ASSISTANT", "실패", "FAILED");

    assertThat(fake.documentCalls()).isZero();
    assertThat(probe.turnEmbeddingEmpty(question)).isTrue();
    assertThat(probe.turnEmbeddingEmpty(stopped)).isTrue();
    assertThat(probe.turnEmbeddingEmpty(failed)).isTrue();
  }

  @Test
  void 놓친_완료_답은_백필이_채운다() {
    long uid = user();
    UUID sid = session(uid);
    fake.setEnabled(false);
    append(uid, sid, "USER", "주간 보고 마감", "COMPLETE");
    long answer = append(uid, sid, "ASSISTANT", "금요일 오후 4시예요", "COMPLETE");
    fake.setEnabled(true);

    for (int i = 0; i < 20 && backfill.backfillOnce() > 0; i++) {}

    assertThat(probe.turnEmbeddingIs(answer, "질문: 주간 보고 마감\n답: 금요일 오후 4시예요")).isTrue();
  }

  @Test
  void 턴_입력은_질문이_없어도_되고_2000자로_자른다() {
    assertThat(TextEmbeddingRepository.turnInput(null, "답만")).isEqualTo("질문: \n답: 답만");
    assertThat(TextEmbeddingRepository.turnInput("q", "가".repeat(3000)))
        .hasSize(TextEmbeddingRepository.TURN_INPUT_CHARS);
  }
}
