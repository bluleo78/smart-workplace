package com.workplace.wiki.service;

import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.WIKI_PAGE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.never;
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
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
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
    when(assistantResolver.resolve(anyLong()))
        .thenReturn(new AssistantSpec(900L, "claude-test", "NORMAL", 3, 60_000));
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

  /** Review Focus 2 — 요약 생성 뒤에도 편집기가 들고 있던 version 으로 저장이 성공해야 한다. */
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

  /** Review Focus 1 — 더 오래된 버전으로 만든 결과는 새 요약을 덮지 않는다. */
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

  /** Review Focus 4 — 짧은 노트는 ai-agent 를 호출하지 않는다. */
  @Test
  void generate_tooShort_skipsAgent() {
    long u = seedUser();
    WikiPageDetail p = pageWithBody(u, "짧은 메모");

    WikiPageSummaryState s = summaryService.generate(u, p.id());

    assertThat(s.status()).isEqualTo(WikiSummaryStatus.TOO_SHORT);
    verify(agent, never()).summarize(any());
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
