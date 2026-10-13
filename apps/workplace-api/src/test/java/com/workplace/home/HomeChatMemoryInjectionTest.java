package com.workplace.home;

import static com.workplace.jooq.Tables.AI_MEMORY;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.workplace.home.outbound.ChatMessages.ChatMemory;
import com.workplace.home.outbound.ChatMessages.ChatRequest;
import com.workplace.home.service.AiMemoryService;
import com.workplace.user.service.AiPreferenceService;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * WP-55: 홈 채팅 펌프가 매 턴 메모리를 ChatRequest 에 싣고, 메모리 블록 추정만큼 이전 대화 몫을 줄인다. HomeAttachmentTestSupport 와
 * 같은 컨텍스트(예산 400 · 목)를 쓴다 — 펌프가 다른 스레드에서 커밋하므로 @Transactional 없이 정리한다.
 */
class HomeChatMemoryInjectionTest extends HomeAttachmentTestSupport {

  @Autowired AiMemoryService memoryService;
  @Autowired AiPreferenceService preferences;

  /** 하위 클래스 @AfterEach 가 먼저 돈다 — 사용자 삭제(상위 정리) 전에 tenant 트랜잭션으로 메모리를 지운다. */
  @AfterEach
  void cleanupMemories() {
    if (users.isEmpty()) return;
    cleanupInTenant(
        1L, () -> dsl.deleteFrom(AI_MEMORY).where(AI_MEMORY.USER_ID.in(users)).execute());
  }

  /**
   * 비용 50(한글 46자 + 오버헤드 4) 메시지 4건 = 200. 턴 뒤 합계도 trigger(300) 아래라 비동기 요약이 끼어들지 않는다 — 요약·축소가 일어났다면
   * 그것은 이번 턴의 동기 예산 맞춤 때문이다.
   */
  private UUID seedHistory(long uid) {
    UUID sid = sessionService.create(uid).id();
    for (int i = 1; i <= 2; i++) {
      sessionService.appendMessage(uid, sid, "USER", body("질문" + i), null, null, null);
      sessionService.appendMessage(uid, sid, "ASSISTANT", body("답변" + i), null, null, null);
    }
    return sid;
  }

  private static String body(String label) {
    return label + "가".repeat(46 - label.length());
  }

  @Test
  void 켜져_있으면_최신순_메모리와_사용_여부를_보낸다() throws Exception {
    long uid = user();
    memoryService.create(uid, "PREFERENCE", "짧은 목록으로 보여 준다");
    memoryService.create(uid, "CONTEXT", "백엔드 팀이다");
    CountDownLatch latch = stubDone("네");

    chatService.startChat(uid, null, "이슈 보여줘");
    assertThat(latch.await(5, TimeUnit.SECONDS)).isTrue();

    ChatRequest req = sentRequest();
    assertThat(req.memoryEnabled()).isTrue();
    assertThat(req.memories())
        .extracting(ChatMemory::content)
        .containsExactly("백엔드 팀이다", "짧은 목록으로 보여 준다");
    assertThat(req.memories().get(0).kind()).isEqualTo("CONTEXT");
    assertThat(req.memories().get(0).id()).isPositive();
  }

  @Test
  void 꺼져_있으면_빈_목록과_꺼짐을_보낸다() throws Exception {
    long uid = user();
    memoryService.create(uid, "PREFERENCE", "짧은 목록으로 보여 준다");
    preferences.update(uid, null, false);
    CountDownLatch latch = stubDone("네");

    chatService.startChat(uid, null, "이슈 보여줘");
    assertThat(latch.await(5, TimeUnit.SECONDS)).isTrue();

    ChatRequest req = sentRequest();
    assertThat(req.memoryEnabled()).isFalse();
    assertThat(req.memories()).isEmpty();
  }

  @Test
  void 메모리가_없으면_예산_안의_이력을_그대로_보낸다() throws Exception {
    long uid = user();
    UUID sid = seedHistory(uid);
    CountDownLatch latch = stubDone("네");

    chatService.startChat(uid, sid, "다음");
    assertThat(latch.await(5, TimeUnit.SECONDS)).isTrue();

    ChatRequest req = sentRequest();
    assertThat(req.contextSummary()).isNull();
    assertThat(req.recentContext()).hasSize(4);
    verify(summaryClient, never()).summarize(any());
  }

  /**
   * 블록 추정 = 120 + 200 + 12 = 332 → 남은 예산 68 < 이력 200. 이력(200)이 요약 목표(200) 안이라 접을 것이 없으므로 요약은 돌지 않고,
   * 이번 턴만 최신 원문부터 68 안에 드는 것(50 짜리 1건)만 보낸다 — 판정 16 의 "작은 예산" 경로를 그대로 고정한다.
   */
  @Test
  void 메모리_블록_추정만큼_이전_대화_몫이_줄어든다() throws Exception {
    long uid = user();
    UUID sid = seedHistory(uid);
    memoryService.create(uid, "CONTEXT", "가".repeat(200));
    CountDownLatch latch = stubDone("네");

    chatService.startChat(uid, sid, "다음");
    assertThat(latch.await(5, TimeUnit.SECONDS)).isTrue();

    ChatRequest req = sentRequest();
    assertThat(req.recentContext()).hasSize(1);
    assertThat(req.recentContext().get(0).content()).startsWith("답변2");
    verify(summaryClient, never()).summarize(any());
    assertThat(sessionService.getMessages(uid, sid)).hasSizeGreaterThanOrEqualTo(4); // DB 이력은 그대로
  }
}
