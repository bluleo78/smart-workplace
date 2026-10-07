package com.workplace.wiki.service;

import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.WIKI_PAGE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.dto.SavePageRequest;
import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.dto.WikiPageSummaryState;
import com.workplace.wiki.dto.WikiSpaceResponse;
import com.workplace.wiki.dto.WikiSummaryStatus;
import com.workplace.wiki.exception.WikiSpaceNotFoundException;
import com.workplace.wiki.exception.WikiSummaryFailedException;
import com.workplace.wiki.outbound.WikiAiAgentSummaryClient;
import com.workplace.wiki.repository.WikiPageRepository;
import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * WP-301 노트 AI 요약 통합 테스트. 실제 DB(Testcontainers)·실제 권한 검사, ai-agent 클라이언트와 비서 해석만 목.
 *
 * <p>클래스에 {@code @Transactional} 을 붙이지 않는다 — generate 는 AI 호출을 트랜잭션 밖에 두려고 TransactionTemplate 으로
 * 앞뒤를 나누므로, 테스트 트랜잭션으로 감싸면 그 경계를 검증하지 못한다.
 */
class WikiSummaryServiceTest extends IntegrationTestBase {
  @Autowired DSLContext dsl;
  @Autowired WikiSpaceService spaceService;
  @Autowired WikiPageService pageService;
  @Autowired WikiSummaryService summaryService;
  @Autowired WikiPageRepository pages;
  @MockitoBean WikiAiAgentSummaryClient agent;
  @MockitoBean AssistantResolver assistantResolver;

  private static final String LONG_BODY = "## 회의\n" + "결정 사항을 정리한다. ".repeat(40); // 400자 초과

  @BeforeEach
  void setTenant() {
    TenantContext.set(1L);
    // 요약은 모든 독자가 공유하므로 공용(워크스페이스) 비서로만 만든다 — 호출자 개인 비서는 쓰지 않는다.
    when(assistantResolver.resolveWorkspaceOrEmpty())
        .thenReturn(Optional.of(new AssistantSpec(900L, "claude-test", "NORMAL", 3, 60_000)));
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "ws_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Ws" + s)
        .set(USER.EMAIL, "ws_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** 개인 공간에 본문이 있는 페이지를 만든다(version 2). */
  private WikiPageDetail pageWithBody(long owner, String body) {
    WikiSpaceResponse sp = spaceService.ensurePersonalSpace(owner);
    WikiPageDetail p = pageService.create(owner, sp.id(), new CreatePageRequest(null, "주간회의"));
    return pageService.save(owner, p.id(), new SavePageRequest("주간회의", body, p.version(), false));
  }

  @Test
  void get_noSummary_longBody_isMissing() {
    long u = seedUser();
    WikiPageDetail p = pageWithBody(u, LONG_BODY);

    WikiPageSummaryState s = summaryService.get(u, p.id());

    assertThat(s.status()).isEqualTo(WikiSummaryStatus.MISSING);
    assertThat(s.summary()).isNull();
    assertThat(s.pageVersion()).isEqualTo(p.version());
  }

  @Test
  void get_noSummary_shortBody_isTooShort() {
    long u = seedUser();
    WikiPageDetail p = pageWithBody(u, "짧은 메모");

    assertThat(summaryService.get(u, p.id()).status()).isEqualTo(WikiSummaryStatus.TOO_SHORT);
  }

  @Test
  void generate_savesSummary_thenReady() {
    long u = seedUser();
    WikiPageDetail p = pageWithBody(u, LONG_BODY);
    when(agent.summarize(any())).thenReturn(new WikiAiAgentSummaryClient.Res("  요약 문장.  "));

    WikiPageSummaryState s = summaryService.generate(u, p.id());

    assertThat(s.status()).isEqualTo(WikiSummaryStatus.READY);
    assertThat(s.summary()).isEqualTo("요약 문장.");
    assertThat(s.summaryVersion()).isEqualTo(p.version());
    assertThat(s.summarizedAt()).isNotNull();
    assertThat(summaryService.get(u, p.id()).status()).isEqualTo(WikiSummaryStatus.READY);
  }

  @Test
  void get_afterEdit_isStale() {
    long u = seedUser();
    WikiPageDetail p = pageWithBody(u, LONG_BODY);
    when(agent.summarize(any())).thenReturn(new WikiAiAgentSummaryClient.Res("요약"));
    summaryService.generate(u, p.id());

    pageService.save(u, p.id(), new SavePageRequest("주간회의", LONG_BODY + "추가", p.version(), false));

    WikiPageSummaryState s = summaryService.get(u, p.id());
    assertThat(s.status()).isEqualTo(WikiSummaryStatus.STALE);
    assertThat(s.summary()).isEqualTo("요약");
    assertThat(s.summaryVersion()).isEqualTo(p.version());
    assertThat(s.pageVersion()).isEqualTo(p.version() + 1);
  }

  /** 요약 생성은 노트 version·updated_at 을 바꾸지 않는다 — 생성 뒤에도 편집기가 들고 있던 version 으로 저장이 성공해야 한다. */
  @Test
  void generate_keepsVersionAndUpdatedAt() {
    long u = seedUser();
    WikiPageDetail p = pageWithBody(u, LONG_BODY);
    when(agent.summarize(any())).thenReturn(new WikiAiAgentSummaryClient.Res("요약"));
    OffsetDateTime before =
        dsl.select(WIKI_PAGE.UPDATED_AT)
            .from(WIKI_PAGE)
            .where(WIKI_PAGE.ID.eq(p.id()))
            .fetchOne(WIKI_PAGE.UPDATED_AT);

    summaryService.generate(u, p.id());

    var row = dsl.selectFrom(WIKI_PAGE).where(WIKI_PAGE.ID.eq(p.id())).fetchOne();
    assertThat(row.getVersion()).isEqualTo(p.version());
    assertThat(row.getUpdatedAt()).isEqualTo(before);
    assertThat(row.getAiLastAction()).isNull();
    // 편집기의 다음 자동저장이 충돌 없이 통과
    WikiPageDetail saved =
        pageService.save(
            u, p.id(), new SavePageRequest("주간회의", LONG_BODY + "!", p.version(), false));
    assertThat(saved.version()).isEqualTo(p.version() + 1);
  }

  /** 더 오래된 버전으로 만든 결과는 새 요약을 덮지 않는다. */
  @Test
  void generate_olderResultDoesNotOverwriteNewer() {
    long u = seedUser();
    WikiPageDetail p = pageWithBody(u, LONG_BODY);
    // 새 버전(v+1) 요약이 먼저 저장된 상황을 만든다.
    pages.saveSummaryIfNotOlder(p.id(), "새 요약", p.version() + 1, OffsetDateTime.now());

    int affected = pages.saveSummaryIfNotOlder(p.id(), "옛 요약", p.version(), OffsetDateTime.now());

    assertThat(affected).isZero();
    assertThat(pages.findSummary(p.id()).orElseThrow().summary()).isEqualTo("새 요약");
  }

  /** 짧은 노트는 ai-agent 를 호출하지 않는다. */
  @Test
  void generate_tooShort_skipsAgent() {
    long u = seedUser();
    WikiPageDetail p = pageWithBody(u, "짧은 메모");

    WikiPageSummaryState s = summaryService.generate(u, p.id());

    assertThat(s.status()).isEqualTo(WikiSummaryStatus.TOO_SHORT);
    verify(agent, never()).summarize(any());
  }

  /** 요약이 없고 공용 비서도 없으면 생성할 수 없으므로 UNAVAILABLE(카드 비노출). */
  @Test
  void get_noWorkspaceAssistant_isUnavailable() {
    long u = seedUser();
    WikiPageDetail p = pageWithBody(u, LONG_BODY);
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.empty());

    WikiPageSummaryState s = summaryService.get(u, p.id());

    assertThat(s.status()).isEqualTo(WikiSummaryStatus.UNAVAILABLE);
    assertThat(s.summary()).isNull();
  }

  /** 공용 비서가 없으면 POST 해도 ai-agent 를 부르지 않고 현재 상태를 돌려준다. */
  @Test
  void generate_noWorkspaceAssistant_skipsAgent() {
    long u = seedUser();
    WikiPageDetail p = pageWithBody(u, LONG_BODY);
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.empty());

    WikiPageSummaryState s = summaryService.generate(u, p.id());

    assertThat(s.status()).isEqualTo(WikiSummaryStatus.UNAVAILABLE);
    verify(agent, never()).summarize(any());
    verify(assistantResolver, never()).resolve(anyLong());
  }

  /** 이미 현재 버전의 요약이 있으면(READY) 다시 POST 해도 ai-agent 를 부르지 않는다 — 중복 생성 비용 방지. */
  @Test
  void generate_alreadyReady_skipsAgent() {
    long u = seedUser();
    WikiPageDetail p = pageWithBody(u, LONG_BODY);
    when(agent.summarize(any())).thenReturn(new WikiAiAgentSummaryClient.Res("요약"));
    summaryService.generate(u, p.id());

    WikiPageSummaryState s = summaryService.generate(u, p.id());

    assertThat(s.status()).isEqualTo(WikiSummaryStatus.READY);
    assertThat(s.summary()).isEqualTo("요약");
    verify(agent, times(1)).summarize(any());
  }

  /** ai-agent 로 보내는 본문은 32,000자로 자르고, 단발 요약이라 maxTurns 는 1 로 고정한다. */
  @Test
  void generate_capsBodyAndUsesSingleTurn() {
    long u = seedUser();
    String huge = "가".repeat(40_000);
    WikiPageDetail p = pageWithBody(u, huge);
    when(agent.summarize(any())).thenReturn(new WikiAiAgentSummaryClient.Res("요약"));

    summaryService.generate(u, p.id());

    ArgumentCaptor<WikiAiAgentSummaryClient.Req> req =
        ArgumentCaptor.forClass(WikiAiAgentSummaryClient.Req.class);
    verify(agent).summarize(req.capture());
    assertThat(req.getValue().body()).hasSize(32_000);
    assertThat(req.getValue().maxTurns()).isEqualTo(1);
    assertThat(req.getValue().assistantAgentId()).isEqualTo(900L);
  }

  /** 자르는 경계에 이모지(서로게이트 쌍)가 걸리면 한 글자 덜 잘라 홀로 남은 high surrogate 를 보내지 않는다. */
  @Test
  void generate_capDoesNotSplitSurrogatePair() {
    long u = seedUser();
    // 31,999자 뒤에 이모지(2 char) — 32,000 번째 char 가 high surrogate 가 된다.
    String body = "가".repeat(31_999) + "😀" + "나".repeat(100);
    WikiPageDetail p = pageWithBody(u, body);
    when(agent.summarize(any())).thenReturn(new WikiAiAgentSummaryClient.Res("요약"));

    summaryService.generate(u, p.id());

    ArgumentCaptor<WikiAiAgentSummaryClient.Req> req =
        ArgumentCaptor.forClass(WikiAiAgentSummaryClient.Req.class);
    verify(agent).summarize(req.capture());
    String sent = req.getValue().body();
    assertThat(sent).hasSize(31_999);
    assertThat(Character.isHighSurrogate(sent.charAt(sent.length() - 1))).isFalse();
  }

  /** 낡은 요약(STALE)에서 공용 비서가 사라졌으면 "다시 요약"이 조용히 끝나지 않도록 실패로 알린다. */
  @Test
  void generate_staleWithoutWorkspaceAssistant_throwsSummaryFailed() {
    long u = seedUser();
    WikiPageDetail p = pageWithBody(u, LONG_BODY);
    when(agent.summarize(any())).thenReturn(new WikiAiAgentSummaryClient.Res("요약"));
    summaryService.generate(u, p.id());
    pageService.save(u, p.id(), new SavePageRequest("주간회의", LONG_BODY + "추가", p.version(), false));
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.empty());

    assertThatThrownBy(() -> summaryService.generate(u, p.id()))
        .isInstanceOf(WikiSummaryFailedException.class)
        .hasMessageContaining("공용 AI 비서가 없어");
    verify(agent, times(1)).summarize(any());
    assertThat(summaryService.get(u, p.id()).status()).isEqualTo(WikiSummaryStatus.STALE);
  }

  /** 요약이 이미 있으면 GET 은 공용 비서를 조회하지 않는다 — 노트를 열 때마다 드는 조회 비용을 아낀다. */
  @Test
  void get_withSummary_doesNotResolveAssistant() {
    long u = seedUser();
    WikiPageDetail p = pageWithBody(u, LONG_BODY);
    pages.saveSummaryIfNotOlder(p.id(), "요약", p.version(), OffsetDateTime.now());
    clearInvocations(assistantResolver);

    assertThat(summaryService.get(u, p.id()).status()).isEqualTo(WikiSummaryStatus.READY);
    verify(assistantResolver, never()).resolveWorkspaceOrEmpty();
  }

  /** 같은 노트에 동시에 들어온 생성 요청은 ai-agent 를 한 번만 부르고 결과를 함께 받는다. */
  @Test
  void generate_concurrentCallsShareOneAgentCall() throws Exception {
    long u = seedUser();
    WikiPageDetail p = pageWithBody(u, LONG_BODY);
    CountDownLatch entered = new CountDownLatch(1);
    CountDownLatch release = new CountDownLatch(1);
    when(agent.summarize(any()))
        .thenAnswer(
            inv -> {
              entered.countDown();
              assertThat(release.await(10, TimeUnit.SECONDS)).isTrue();
              return new WikiAiAgentSummaryClient.Res("동시 요약");
            });
    ExecutorService pool = Executors.newFixedThreadPool(2);
    try {
      Callable<WikiPageSummaryState> call =
          () -> {
            TenantContext.set(1L); // RLS 테넌트는 스레드 로컬이라 작업 스레드에도 넣는다.
            try {
              return summaryService.generate(u, p.id());
            } finally {
              TenantContext.clear();
            }
          };
      Future<WikiPageSummaryState> first = pool.submit(call);
      assertThat(entered.await(10, TimeUnit.SECONDS)).isTrue(); // 리더가 AI 호출 중
      AtomicReference<Thread> secondThread = new AtomicReference<>();
      Future<WikiPageSummaryState> second =
          pool.submit(
              () -> {
                secondThread.set(Thread.currentThread());
                return call.call();
              });
      // 두 번째 요청이 진행 중 생성을 기다리며 멈출 때까지(=스냅샷을 MISSING 으로 본 뒤) 기다린 다음 리더를 풀어 준다.
      long deadline = System.currentTimeMillis() + 10_000;
      while (System.currentTimeMillis() < deadline) {
        Thread t = secondThread.get();
        if (t != null && t.getState() == Thread.State.WAITING) break;
        Thread.sleep(20);
      }
      release.countDown();

      assertThat(first.get(10, TimeUnit.SECONDS).summary()).isEqualTo("동시 요약");
      assertThat(second.get(10, TimeUnit.SECONDS).summary()).isEqualTo("동시 요약");
      verify(agent, times(1)).summarize(any());
    } finally {
      release.countDown();
      pool.shutdownNow();
    }
  }

  /** 본문을 400자 이하로 줄이면 옛 요약이 있어도 TOO_SHORT 이고 summary 는 null — 웹 카드가 숨는다. */
  @Test
  void get_shortenedBodyWithOldSummary_isTooShortWithoutSummary() {
    long u = seedUser();
    WikiPageDetail p = pageWithBody(u, LONG_BODY);
    when(agent.summarize(any())).thenReturn(new WikiAiAgentSummaryClient.Res("요약"));
    summaryService.generate(u, p.id());

    pageService.save(u, p.id(), new SavePageRequest("주간회의", "", p.version(), false));

    WikiPageSummaryState s = summaryService.get(u, p.id());
    assertThat(s.status()).isEqualTo(WikiSummaryStatus.TOO_SHORT);
    assertThat(s.summary()).isNull();
    assertThat(s.summarizedAt()).isNull();
  }

  @Test
  void generate_agentFailure_throwsSummaryFailed() {
    long u = seedUser();
    WikiPageDetail p = pageWithBody(u, LONG_BODY);
    when(agent.summarize(any()))
        .thenThrow(new WikiSummaryFailedException("노트 요약 AI 요청에 실패했습니다.", null));

    assertThatThrownBy(() -> summaryService.generate(u, p.id()))
        .isInstanceOf(WikiSummaryFailedException.class);
    assertThat(pages.findSummary(p.id()).orElseThrow().summary()).isNull();
  }

  @Test
  void generate_blankSummary_throwsSummaryFailed() {
    long u = seedUser();
    WikiPageDetail p = pageWithBody(u, LONG_BODY);
    when(agent.summarize(any())).thenReturn(new WikiAiAgentSummaryClient.Res("   "));

    assertThatThrownBy(() -> summaryService.generate(u, p.id()))
        .isInstanceOf(WikiSummaryFailedException.class);
  }

  @Test
  void viewer_canGetAndGenerate() {
    long owner = seedUser();
    long viewer = withMembership(seedUser());
    WikiSpaceResponse team = spaceService.createTeamSpace(owner, "팀-" + UUID.randomUUID());
    spaceService.addMember(owner, team.id(), viewer, "VIEWER");
    WikiPageDetail p = pageService.create(owner, team.id(), new CreatePageRequest(null, "팀 노트"));
    p = pageService.save(owner, p.id(), new SavePageRequest("팀 노트", LONG_BODY, p.version(), false));
    when(agent.summarize(any())).thenReturn(new WikiAiAgentSummaryClient.Res("요약"));

    assertThat(summaryService.generate(viewer, p.id()).status()).isEqualTo(WikiSummaryStatus.READY);
    assertThat(summaryService.get(viewer, p.id()).summary()).isEqualTo("요약");
  }

  @Test
  void nonMember_isNotFound() {
    long owner = seedUser();
    long stranger = seedUser();
    WikiPageDetail p = pageWithBody(owner, LONG_BODY);

    assertThatThrownBy(() -> summaryService.get(stranger, p.id()))
        .isInstanceOf(WikiSpaceNotFoundException.class);
    assertThatThrownBy(() -> summaryService.generate(stranger, p.id()))
        .isInstanceOf(WikiSpaceNotFoundException.class);
    verify(agent, never()).summarize(any());
  }
}
