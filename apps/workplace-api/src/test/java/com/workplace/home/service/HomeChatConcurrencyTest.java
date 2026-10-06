package com.workplace.home.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.auth.exception.HomeAssistantNotConfiguredException;
import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.realtime.StreamingGenerationRegistry;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.tenant.TenantScopedRunner;
import com.workplace.home.dto.HomeChatActiveResponse;
import com.workplace.home.dto.HomeChatStartedResponse;
import com.workplace.home.dto.HomeMessageResponse;
import com.workplace.home.dto.HomeSessionSummary;
import com.workplace.home.exception.HomeChatConcurrencyLimitException;
import com.workplace.home.exception.HomeChatSessionBusyException;
import com.workplace.home.outbound.AiAgentChatClient;
import com.workplace.support.IntegrationTestBase;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * WP-190 홈 채팅 동시 생성 제한 — 대화당 1개(409)·사용자당 상한(429)·거절 시 무저장·생성 중 목록. 펌프는 테스트가 풀어 줄 때까지 붙잡아 "생성 중"
 * 상태를 만든다. @Transactional 을 쓰지 않는다(펌프 스레드 커밋 필요) — 만든 사용자는 @AfterEach 에서 회수(#512).
 */
@TestPropertySource(properties = "workplace.ai-agent.enabled=true")
class HomeChatConcurrencyTest extends IntegrationTestBase {

  @Autowired HomeChatService chatService;
  @Autowired HomeSessionService sessionService;
  @Autowired StreamingGenerationRegistry registry;
  @Autowired DSLContext dsl;
  @MockitoBean AiAgentChatClient chatClient;
  @MockitoBean AssistantResolver assistantResolver;
  @MockitoBean SseRegistry sseRegistry;
  @MockitoBean TenantScopedRunner tenantScopedRunner;

  private final List<Long> users = new ArrayList<>();
  private final CountDownLatch release = new CountDownLatch(1);

  @BeforeEach
  void stubs() throws Exception {
    when(assistantResolver.resolve(anyLong()))
        .thenReturn(new AssistantSpec(5L, "claude-sonnet-4-6", "NORMAL", 8, 60000));
    // 테스트가 풀어 줄 때까지 펌프를 붙잡는다(생성 중 상태). 취소 인터럽트면 즉시 빠진다.
    doAnswer(
            inv -> {
              try {
                release.await(10, TimeUnit.SECONDS);
              } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
              }
              return null;
            })
        .when(chatClient)
        .composeStream(any(), any(), any(), any(), any(), any(), any());
  }

  /** 펌프를 풀고 슬롯이 모두 빠질 때까지 기다린다 — 다음 테스트가 aiChatStreamExecutor(core 4) 대기열 뒤에 서지 않게. */
  @AfterEach
  void cleanup() throws Exception {
    release.countDown();
    for (long u : users) awaitTrue(() -> registry.active(u, HomeChatService.scope()).isEmpty());
    if (!users.isEmpty()) dsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
  }

  private static void awaitTrue(BooleanSupplier cond) throws InterruptedException {
    long deadline = System.currentTimeMillis() + 5000;
    while (!cond.getAsBoolean()) {
      if (System.currentTimeMillis() > deadline) throw new AssertionError("timeout");
      Thread.sleep(20);
    }
  }

  private long user() {
    String n = "conc" + System.nanoTime();
    long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, n)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, n)
            .set(USER.EMAIL, n + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    users.add(id);
    return id;
  }

  @Test
  void 같은_대화의_두번째_요청은_409_이고_질문을_저장하지_않는다() {
    long uid = user();
    UUID sid = sessionService.create(uid).id();
    chatService.startChat(uid, sid, "첫 질문");

    assertThatThrownBy(() -> chatService.startChat(uid, sid, "둘째 질문"))
        .isInstanceOf(HomeChatSessionBusyException.class);
    assertThat(sessionService.getMessages(uid, sid))
        .extracting(HomeMessageResponse::content)
        .containsExactly("첫 질문");
  }

  @Test
  void 네번째_대화는_429_이고_빈_세션을_만들지_않는다() {
    long uid = user();
    for (int i = 0; i < 3; i++) chatService.startChat(uid, null, "질문" + i);

    assertThatThrownBy(() -> chatService.startChat(uid, null, "넷째"))
        .isInstanceOf(HomeChatConcurrencyLimitException.class);
    assertThat(sessionService.list(uid, null, 10).items()).hasSize(3);
  }

  @Test
  void 다른_사용자의_생성은_상한에_세지_않는다() {
    long u1 = user();
    long u2 = user();
    for (int i = 0; i < 3; i++) chatService.startChat(u1, null, "질문" + i);
    assertThat(chatService.startChat(u2, null, "괜찮아?").correlationId()).isNotBlank();
  }

  /**
   * 상한·생성 중 목록은 워크스페이스(테넌트)별이다 — 여러 워크스페이스에 속한 사용자가 한 곳에서 상한을 채워도 다른 곳에선 세지 않고 보이지도 않는다. 두 번째 테넌트
   * 행·그 테넌트의 세션을 만들지 않으려고 워크스페이스 2 쪽은 예약(무저장 단계)까지만 확인한다.
   */
  @Test
  void 다른_워크스페이스의_생성은_상한에_세지도_목록에_보이지도_않는다() throws Exception {
    long uid = user();
    Long prev = TenantContext.get();
    try {
      TenantContext.set(1L);
      for (int i = 0; i < 3; i++) chatService.startChat(uid, null, "질문" + i);
      assertThat(chatService.active(uid).items()).hasSize(3);

      TenantContext.set(2L);
      assertThat(chatService.active(uid).items()).isEmpty();
      // 워크스페이스 1 이 상한(3)을 채웠어도 워크스페이스 2 의 예약은 거절되지 않는다(startChat 이 쓰는 것과 같은 scope 키).
      registry
          .reserve(
              uid,
              new StreamingGenerationRegistry.GenerationTag(
                  HomeChatService.scope(), UUID.randomUUID().toString()),
              3)
          .release();
    } finally {
      // 펌프를 풀고 워크스페이스 1 의 슬롯이 빠질 때까지 기다린 뒤 원래 컨텍스트로 — @AfterEach 는 현재 컨텍스트의 scope 만 본다.
      TenantContext.set(1L);
      release.countDown();
      awaitTrue(() -> registry.active(uid, HomeChatService.scope()).isEmpty());
      if (prev == null) TenantContext.clear();
      else TenantContext.set(prev);
    }
  }

  @Test
  void 시작_응답의_sessionId_는_새로_만든_세션이다() {
    long uid = user();
    HomeChatStartedResponse r = chatService.startChat(uid, null, "새 대화");
    assertThat(sessionService.list(uid, null, 10).items())
        .extracting(HomeSessionSummary::id)
        .containsExactly(r.sessionId());
  }

  @Test
  void active_는_호출자의_생성만_상한과_함께_돌려준다() {
    long u1 = user();
    long u2 = user();
    HomeChatStartedResponse mine = chatService.startChat(u1, null, "내 질문");
    chatService.startChat(u2, null, "남의 질문");

    HomeChatActiveResponse a = chatService.active(u1);
    assertThat(a.limit()).isEqualTo(3);
    assertThat(a.items())
        .singleElement()
        .satisfies(
            i -> {
              assertThat(i.sessionId()).isEqualTo(mine.sessionId());
              assertThat(i.correlationId()).isEqualTo(mine.correlationId());
              assertThat(i.startedAt()).isNotNull();
            });
  }

  @Test
  void 비서_미설정_503_이면_슬롯을_돌려주고_세션도_만들지_않는다() {
    long uid = user();
    when(assistantResolver.resolve(uid))
        .thenThrow(new HomeAssistantNotConfiguredException("비서 미설정"));

    assertThatThrownBy(() -> chatService.startChat(uid, null, "안녕"))
        .isInstanceOf(HomeAssistantNotConfiguredException.class);
    assertThat(registry.active(uid, HomeChatService.scope())).isEmpty();
    assertThat(sessionService.list(uid, null, 10).items()).isEmpty();
  }

  /** 예약 뒤 동기 구간(세션 조회·맥락 로드·USER 저장)에서 어떤 예외가 나도 슬롯이 새지 않는다 — 없는 대화 id 로 시작. */
  @Test
  void 예약_뒤_동기_구간_실패는_슬롯을_돌려준다() {
    long uid = user();
    assertThatThrownBy(() -> chatService.startChat(uid, UUID.randomUUID(), "없는 대화"))
        .isInstanceOf(RuntimeException.class);
    assertThat(registry.active(uid, HomeChatService.scope())).isEmpty();
  }

  /**
   * R4: aiChatStreamExecutor(core 4·queue 16)가 꽉 차 큐에서 기다리던 생성을 취소하면 태스크는 돌지 않는다 — 그래도 cancelled 가
   * 나가야 웹이 "생성 중" 에 갇히지 않는다.
   */
  @Test
  void 큐에서_기다리던_생성을_취소해도_cancelled_를_보낸다() {
    long u1 = user();
    long u2 = user();
    for (int i = 0; i < 3; i++) chatService.startChat(u1, null, "붙잡힌 질문" + i);
    chatService.startChat(u2, null, "붙잡힌 질문"); // core 4 스레드 모두 점유
    HomeChatStartedResponse queued = chatService.startChat(u2, null, "줄 서 있는 질문");

    chatService.cancelChat(queued.correlationId(), u2);

    verify(sseRegistry, timeout(2000))
        .fanOut(
            eq(Set.of(u2)),
            eq("home.chat.cancelled"),
            argThat(
                p ->
                    queued
                        .sessionId()
                        .toString()
                        .equals(((java.util.Map<?, ?>) p).get("sessionId"))));
    assertThat(registry.active(u2, HomeChatService.scope())).hasSize(1);
  }
}
