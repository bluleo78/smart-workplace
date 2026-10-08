package com.workplace.wiki;

import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static com.workplace.jooq.Tables.WIKI_PAGE;
import static com.workplace.jooq.Tables.WIKI_PAGE_BODY_HISTORY;
import static com.workplace.jooq.Tables.WIKI_REVISION;
import static com.workplace.jooq.Tables.WIKI_SPACE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.entry;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.after;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.http.MediaType.APPLICATION_JSON;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.dto.SavePageRequest;
import com.workplace.wiki.dto.StoreCollabDocRequest;
import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.exception.CollabBodyRejectedException;
import com.workplace.wiki.exception.CollabMergeFailedException;
import com.workplace.wiki.exception.CollabUnavailableException;
import com.workplace.wiki.exception.WikiForbiddenException;
import com.workplace.wiki.outbound.CollabClient;
import com.workplace.wiki.outbound.CollabClient.CollabApplyResult;
import com.workplace.wiki.outbound.CollabClient.MergeBase;
import com.workplace.wiki.repository.WikiBodyHistoryRepository;
import com.workplace.wiki.service.WikiBodyHistoryCleanupScheduler;
import com.workplace.wiki.service.WikiCollabDocService;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiSpaceService;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 동시 편집 도입 후 저장 규칙(WP-290 · WP-285) — 제목은 버전 무관 나중 값, 본문은 동기화 서버로 위임, 권한 변화는 커밋 후 연결 재검증.
 *
 * <p>비-@Transactional: 본문 위임이 행 잠금 없이 일어나는지(R1)와 AFTER_COMMIT 재검증 알림은 실제 커밋이 있어야 관찰된다. 시드는
 * {@code @AfterEach} 에서 직접 정리한다(공간 삭제 → page·doc CASCADE).
 */
@TestPropertySource(properties = "workplace.collab.enabled=true")
class WikiCollabSaveIntegrationTest extends IntegrationTestBase {
  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired WikiSpaceService spaceService;
  @Autowired WikiPageService pageService;
  @Autowired WikiCollabDocService docService;
  @Autowired JwtTokenProvider jwt;
  // 스파이 — 응답 판 기준본 기록에 실제 DB 오류를 끼워 넣는다(기본은 실제 동작 그대로).
  @MockitoSpyBean WikiBodyHistoryRepository bodies;
  @Autowired WikiBodyHistoryCleanupScheduler bodyCleanup;

  @MockitoBean CollabClient collab;

  private final List<Long> seededUserIds = new ArrayList<>();
  private long userId;
  private long otherUserId;

  @BeforeEach
  void seed() {
    tenant1();
    userId = seedUser();
    otherUserId = seedUser();
  }

  @AfterEach
  void cleanup() {
    cleanupInTenant(
        1L,
        () -> {
          dsl.deleteFrom(WIKI_SPACE).where(WIKI_SPACE.OWNER_ID.in(seededUserIds)).execute();
          dsl.deleteFrom(USER_ROLE).where(USER_ROLE.USER_ID.in(seededUserIds)).execute();
          dsl.deleteFrom(USER).where(USER.ID.in(seededUserIds)).execute();
        });
    seededUserIds.clear();
    TenantContext.clear();
  }

  @Test
  void titleOnlySaveIgnoresStaleVersion() {
    long pageId = seedPage("본문");
    pageService.save(userId, pageId, new SavePageRequest("새 제목", null, 999, false));
    tenant1();
    WikiPageDetail after = pageService.get(userId, pageId);
    assertThat(after.title()).isEqualTo("새 제목");
    assertThat(after.body()).isEqualTo("본문");
    verifyNoInteractions(collab);
  }

  @Test
  void bodySaveDelegatesToCollabAndReturnsCollabVersion() {
    long pageId = seedPage("본문");
    when(collab.applyMarkdown(
            eq(1L),
            eq(pageId),
            eq(new MergeBase("본문", null)),
            eq("새 본문"),
            eq(userId),
            anyString(),
            eq(false),
            eq(false)))
        .thenReturn(new CollabApplyResult(7, "새 본문"));
    WikiPageDetail saved =
        pageService.save(userId, pageId, new SavePageRequest(null, "새 본문", 1, false), false);
    String name = dsl.select(USER.NAME).from(USER).where(USER.ID.eq(userId)).fetchOne(USER.NAME);
    // R8: 응답 version 은 재조회가 아니라 동기화 서버가 돌려준 값.
    assertThat(saved.version()).isEqualTo(7);
    assertThat(saved.body()).isEqualTo("새 본문");
    verify(collab)
        .applyMarkdown(
            eq(1L),
            eq(pageId),
            eq(new MergeBase("본문", null)),
            eq("새 본문"),
            eq(userId),
            eq(name),
            eq(false),
            eq(false));
  }

  /** version 없는 본문 저장은 기존 API 처럼 400 — 무엇을 기준으로 고쳤는지 모르는 본문으로 실시간 문서를 덮지 않는다. */
  @Test
  void bodySaveWithoutVersionIsBadRequestLikeBefore() throws Exception {
    long pageId = seedPage("본문");
    mvc.perform(
            put("/api/v1/wiki/pages/{id}", pageId)
                .header("Authorization", "Bearer " + jwt.generateAccessToken(userId, "u", 1L))
                .contentType(APPLICATION_JSON)
                .content("{\"body\":\"버전 없는 본문\",\"snapshot\":false}"))
        .andExpect(status().isBadRequest());
    verifyNoInteractions(collab);
  }

  /**
   * R1: 제목+본문 저장이 위임 중에 wiki_page 행 잠금을 잡고 있으면, 동기화 서버가 되돌려 호출하는 PUT /doc 이 같은 행을 갱신하다 막힌다. 스텁이 다른
   * 스레드·트랜잭션에서 실제 store 경로를 짧은 lock_timeout 으로 실행해 성공해야 한다.
   */
  @Test
  void titleAndBodySaveDoesNotHoldRowLockDuringDelegation() {
    long pageId = seedPage("본문");
    when(collab.applyMarkdown(
            anyLong(),
            eq(pageId),
            any(),
            anyString(),
            anyLong(),
            anyString(),
            anyBoolean(),
            anyBoolean()))
        .thenAnswer(
            inv -> {
              String body = inv.getArgument(3);
              int version =
                  CompletableFuture.supplyAsync(
                          () -> {
                            TenantContext.set(1L);
                            try {
                              TransactionTemplate tx = new TransactionTemplate(txManager);
                              tx.setPropagationBehavior(
                                  TransactionDefinition.PROPAGATION_REQUIRES_NEW);
                              return tx.execute(
                                  s -> {
                                    dsl.execute("SET LOCAL lock_timeout = '1s'");
                                    return docService.store(
                                        pageId,
                                        new StoreCollabDocRequest(
                                            "AQ==", body, List.of(userId), null, false));
                                  });
                            } finally {
                              TenantContext.clear();
                            }
                          })
                      .get(10, TimeUnit.SECONDS);
              return new CollabApplyResult(version, body);
            });

    WikiPageDetail saved =
        pageService.save(userId, pageId, new SavePageRequest("새 제목", "새 본문", 1, false), true);

    assertThat(saved.title()).isEqualTo("새 제목");
    assertThat(saved.body()).isEqualTo("새 본문");
    tenant1();
    WikiPageDetail stored = pageService.get(userId, pageId);
    assertThat(stored.title()).isEqualTo("새 제목");
    assertThat(stored.body()).isEqualTo("새 본문");
    assertThat(saved.version()).isEqualTo(stored.version());
  }

  /**
   * 본문 저장은 읽은 판의 기준본으로 동기화 서버에 병합을 맡기고, 응답 version 에는 병합본과 <b>제출 본문</b>을 함께 남긴다 — 다음 저장이 응답에서 이어
   * 쓰면(MCP·비서) 병합본이, 자기 본문에서 이어 쓰면(구버전 웹) 제출 본문이 맞는 기준이다. 그 version 으로 다시 저장하면 둘 다 동기화 서버로 간다.
   */
  @Test
  void bodySaveMergesAgainstReadBaseAndRecordsSubmittedBodyAtResponseVersion() {
    long pageId = seedPage("본문");
    tenant1();
    pageService.read(userId, pageId, true);
    when(collab.applyMarkdown(
            eq(1L),
            eq(pageId),
            eq(new MergeBase("본문", null)),
            eq("AI 본문"),
            eq(userId),
            anyString(),
            eq(true),
            eq(true)))
        .thenReturn(new CollabApplyResult(4, "AI 본문 + 사람 입력"));
    WikiPageDetail saved =
        pageService.save(userId, pageId, new SavePageRequest(null, "AI 본문", 1, false), true);
    assertThat(saved.version()).isEqualTo(4);
    assertThat(saved.body()).isEqualTo("AI 본문 + 사람 입력");
    WikiBodyHistoryRepository.BaseRow row = baseRow(pageId, 4);
    assertThat(row.body()).isEqualTo("AI 본문 + 사람 입력");
    assertThat(row.submittedBody()).isEqualTo("AI 본문");

    // 응답 version 으로 이어 저장 → 두 후보가 함께 간다(동기화 서버가 가까운 쪽을 고른다).
    advancePage(pageId, 4, "AI 본문 + 사람 입력");
    when(collab.applyMarkdown(
            anyLong(),
            anyLong(),
            any(),
            anyString(),
            anyLong(),
            anyString(),
            anyBoolean(),
            anyBoolean()))
        .thenReturn(new CollabApplyResult(5, "다음"));
    pageService.save(userId, pageId, new SavePageRequest(null, "AI 본문 둘째", 4, false), true);
    verify(collab)
        .applyMarkdown(
            eq(1L),
            eq(pageId),
            eq(new MergeBase("AI 본문 + 사람 입력", "AI 본문")),
            eq("AI 본문 둘째"),
            eq(userId),
            anyString(),
            eq(true),
            eq(true));
  }

  /** 읽은 뒤 실시간 문서가 앞서 나가도(파생 저장으로 version 상승) 기준본이 살아 있으면 409 가 아니라 병합한다. */
  @Test
  void olderVersionWithFreshBaseMergesInsteadOfConflict() {
    long pageId = seedPage("본문");
    tenant1();
    pageService.read(userId, pageId, true);
    advancePage(pageId, 3, "다른 사람이 고친 본문");
    when(collab.applyMarkdown(
            anyLong(),
            anyLong(),
            any(),
            anyString(),
            anyLong(),
            anyString(),
            anyBoolean(),
            anyBoolean()))
        .thenReturn(new CollabApplyResult(4, "합친 본문"));
    pageService.save(userId, pageId, new SavePageRequest(null, "AI 본문", 1, false), true);
    verify(collab)
        .applyMarkdown(
            eq(1L),
            eq(pageId),
            eq(new MergeBase("본문", null)),
            eq("AI 본문"),
            eq(userId),
            anyString(),
            eq(true),
            eq(true));
  }

  /** 기준본이 만료(1시간)됐고 현재 version 도 아니면 409 + 다시 읽기 안내. 제목도 커밋하지 않고 동기화 서버도 부르지 않는다. */
  @Test
  void expiredBaseIsConflictWithReReadGuidanceAndCommitsNothing() throws Exception {
    long pageId = seedPage("본문");
    tenant1();
    pageService.read(userId, pageId, true);
    ageBase(pageId, 1, Duration.ofHours(2));
    advancePage(pageId, 3, "새 본문");
    mvc.perform(
            put("/api/v1/wiki/pages/{id}", pageId)
                .header("Authorization", "Bearer " + jwt.generateAccessToken(userId, "u", 1L))
                .contentType(APPLICATION_JSON)
                .content(
                    "{\"title\":\"바뀐 제목\",\"body\":\"낡은 본문\",\"version\":1,\"snapshot\":false}"))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("다시 읽")));
    tenant1();
    assertThat(pageService.get(userId, pageId).title()).isEqualTo("페이지");
    verifyNoInteractions(collab);
  }

  /** 기록이 아예 없는 낡은 version 도(정리됨·다른 경로) 만료와 같이 409. */
  @Test
  void missingBaseForOldVersionIsConflict() {
    long pageId = seedPage("본문");
    advancePage(pageId, 3, "새 본문");
    tenant1();
    assertThatThrownBy(
            () ->
                pageService.save(
                    userId, pageId, new SavePageRequest(null, "낡은 본문", 2, false), true))
        .isInstanceOf(com.workplace.wiki.exception.WikiBaseExpiredException.class);
    verifyNoInteractions(collab);
  }

  /** 현재 version 이면 기록이 없어도(배포 전에 읽은 구버전 웹) 현재 본문이 곧 그 판의 기준본이다. */
  @Test
  void currentVersionWithoutRecordedBaseUsesCurrentBody() {
    long pageId = seedPage("본문");
    when(collab.applyMarkdown(
            anyLong(),
            anyLong(),
            any(),
            anyString(),
            anyLong(),
            anyString(),
            anyBoolean(),
            anyBoolean()))
        .thenReturn(new CollabApplyResult(2, "새 본문"));
    pageService.save(userId, pageId, new SavePageRequest(null, "새 본문", 1, false), false);
    verify(collab)
        .applyMarkdown(
            eq(1L),
            eq(pageId),
            eq(new MergeBase("본문", null)),
            eq("새 본문"),
            eq(userId),
            anyString(),
            eq(false),
            eq(false));
  }

  /** 현재 version 의 기준본은 오래됐어도 쓴다 — 오래 열어 둔 구버전 웹의 제출 본문 후보가 사라져 남의 수정을 지우지 않게. */
  @Test
  void currentVersionUsesItsRecordedBaseEvenWhenOld() {
    long pageId = seedPage("병합된 본문");
    recordWritten(pageId, 1, "병합된 본문", "예전에 보낸 본문");
    ageBase(pageId, 1, Duration.ofHours(2));
    when(collab.applyMarkdown(
            anyLong(),
            anyLong(),
            any(),
            anyString(),
            anyLong(),
            anyString(),
            anyBoolean(),
            anyBoolean()))
        .thenReturn(new CollabApplyResult(2, "x"));
    pageService.save(userId, pageId, new SavePageRequest(null, "이어 쓴 본문", 1, false), false);
    verify(collab)
        .applyMarkdown(
            eq(1L),
            eq(pageId),
            eq(new MergeBase("병합된 본문", "예전에 보낸 본문")),
            eq("이어 쓴 본문"),
            eq(userId),
            anyString(),
            eq(false),
            eq(false));
  }

  /** 제목만 저장(LWW)은 기준본을 남기지 않는다 — 제목 저장마다 본문 전체 사본을 쓰지 않게(이어 저장할 판이 현재면 현재 본문이 기준이다). */
  @Test
  void titleOnlySavesRecordNoBase() {
    long pageId = seedPage("본문");
    for (int i = 0; i < 3; i++) {
      pageService.save(userId, pageId, new SavePageRequest("새 제목 " + i, null, 999, false));
    }
    assertThat(bases(pageId)).isEmpty();
  }

  /** 사람(구버전 웹)의 명시 snapshot 요청은 위임 경로에서도 버리지 않는다 — 동기화 서버 적용 저장이 리비전을 남기도록 싣는다. */
  @Test
  void explicitHumanSnapshotIsForwardedToCollab() {
    long pageId = seedPage("본문");
    when(collab.applyMarkdown(
            anyLong(),
            anyLong(),
            any(),
            anyString(),
            anyLong(),
            anyString(),
            anyBoolean(),
            anyBoolean()))
        .thenReturn(new CollabApplyResult(2, "새 본문"));
    pageService.save(userId, pageId, new SavePageRequest(null, "새 본문", 1, true), false);
    verify(collab)
        .applyMarkdown(
            eq(1L), eq(pageId), any(), eq("새 본문"), eq(userId), anyString(), eq(false), eq(true));
  }

  /** 기준본 409 문구는 사유별로 정확하다 — 없는/현재보다 새 판, 기록 없음, 만료. 모두 다시 읽기 안내. */
  @Test
  void baseConflictMessagesNameTheActualCause() {
    long pageId = seedPage("본문");
    tenant1();
    pageService.read(userId, pageId, true);
    advancePage(pageId, 3, "새 본문");
    // 현재(3)보다 새 판.
    assertThatThrownBy(
            () -> pageService.save(userId, pageId, new SavePageRequest(null, "x", 9, false), true))
        .isInstanceOf(com.workplace.wiki.exception.WikiBaseExpiredException.class)
        .hasMessageContaining("현재 판")
        .hasMessageNotContaining("1시간")
        .hasMessageContaining("다시 읽");
    // 기록이 없는 낡은 판.
    assertThatThrownBy(
            () -> pageService.save(userId, pageId, new SavePageRequest(null, "x", 2, false), true))
        .isInstanceOf(com.workplace.wiki.exception.WikiBaseExpiredException.class)
        .hasMessageContaining("찾을 수 없")
        .hasMessageContaining("다시 읽");
    // 읽은 지 1시간이 지난 판.
    ageBase(pageId, 1, Duration.ofHours(2));
    assertThatThrownBy(
            () -> pageService.save(userId, pageId, new SavePageRequest(null, "x", 1, false), true))
        .isInstanceOf(com.workplace.wiki.exception.WikiBaseExpiredException.class)
        .hasMessageContaining("1시간")
        .hasMessageContaining("다시 읽");
    verifyNoInteractions(collab);
  }

  /**
   * 응답 판 기준본 기록은 동기화 서버가 이미 저장한 뒤라 최선 노력이다 — 실제 DB 오류(트랜잭션 중단)가 나도 저장 성공과 동기화 서버 version 으로 답한다.
   */
  @Test
  void failingAppliedBaseRecordStillAnswersTheSavedVersion() {
    long pageId = seedPage("본문");
    when(collab.applyMarkdown(
            anyLong(),
            anyLong(),
            any(),
            anyString(),
            anyLong(),
            anyString(),
            anyBoolean(),
            anyBoolean()))
        .thenReturn(new CollabApplyResult(6, "병합본"));
    doAnswer(
            inv -> {
              dsl.execute("select 1/0");
              return null;
            })
        .when(bodies)
        .recordApplied(anyLong(), anyInt(), anyString(), any());
    WikiPageDetail saved =
        pageService.save(userId, pageId, new SavePageRequest("새 제목", "AI 본문", 1, false), true);
    assertThat(saved.version()).isEqualTo(6);
    assertThat(saved.body()).isEqualTo("병합본");
    assertThat(saved.title()).isEqualTo("새 제목");
  }

  /**
   * 동기화 서버가 적용은 했지만 즉시 저장이 시간 안에 끝나지 않았다(persisted=false) — 호출자에겐 정상 성공(재시도하면 같은 변경을 다시 보낸다). 돌려받은
   * version 은 적용분이 없는 판이라 그 판을 이 본문의 기준본으로 남기지 않는다.
   */
  @Test
  void unpersistedApplyIsSuccessWithoutRecordingItsVersionAsBase() {
    long pageId = seedPage("본문");
    when(collab.applyMarkdown(
            anyLong(),
            anyLong(),
            any(),
            anyString(),
            anyLong(),
            anyString(),
            anyBoolean(),
            anyBoolean()))
        .thenReturn(new CollabApplyResult(1, "AI 본문", false));
    WikiPageDetail saved =
        pageService.save(userId, pageId, new SavePageRequest(null, "AI 본문", 1, false), true);
    assertThat(saved.version()).isEqualTo(1);
    assertThat(saved.body()).isEqualTo("AI 본문");
    assertThat(bases(pageId)).isEmpty();
  }

  /** 동기화 서버가 snapshot 을 실어 저장하면(AI 적용) 편집 세션 간격과 무관하게 직전 본문을 리비전으로 남긴다(스펙 §6.1). */
  @Test
  void storeWithSnapshotFlagAlwaysSnapshotsPreviousBody() {
    long pageId = seedPage("사람 본문");
    tenant1();
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            s ->
                dsl.insertInto(WIKI_REVISION)
                    .set(WIKI_REVISION.PAGE_ID, pageId)
                    .set(WIKI_REVISION.VERSION, 0)
                    .set(WIKI_REVISION.TITLE, "페이지")
                    .set(WIKI_REVISION.BODY, "")
                    .execute());
    tenant1();
    docService.store(
        pageId, new StoreCollabDocRequest("AQ==", "AI 적용 본문", List.of(userId), null, true));
    tenant1();
    String snapshotted =
        new TransactionTemplate(txManager)
            .execute(
                s ->
                    dsl.select(WIKI_REVISION.BODY)
                        .from(WIKI_REVISION)
                        .where(WIKI_REVISION.PAGE_ID.eq(pageId).and(WIKI_REVISION.VERSION.eq(1)))
                        .fetchOne(WIKI_REVISION.BODY));
    assertThat(snapshotted).isEqualTo("사람 본문");
  }

  /** AGENT 주체(MCP·비서 계정)의 저장은 적용 주체 이름으로 에이전트 자신의 이름을 싣는다(스펙 Q3). */
  @Test
  void agentPrincipalUsesAgentOwnNameAsActor() {
    tenant1();
    long agentId = TestFixtures.createAgentNoToken(dsl);
    seededUserIds.add(agentId);
    withMembership(agentId);
    long spaceId = seedTeamSpaceWithMember(agentId, "EDITOR");
    long pageId = seedPageIn(spaceId, "본문");
    String agentName =
        dsl.select(USER.NAME).from(USER).where(USER.ID.eq(agentId)).fetchOne(USER.NAME);
    when(collab.applyMarkdown(
            anyLong(),
            anyLong(),
            any(),
            anyString(),
            anyLong(),
            anyString(),
            anyBoolean(),
            anyBoolean()))
        .thenReturn(new CollabApplyResult(2, "x"));
    tenant1();
    pageService.save(agentId, pageId, new SavePageRequest(null, "x", 1, false), true);
    verify(collab)
        .applyMarkdown(
            eq(1L), eq(pageId), any(), eq("x"), eq(agentId), eq(agentName), eq(true), eq(true));
  }

  /** 동기화 서버 상태 매핑(WP-289 계약) — 본문 거부 400 → 400, 병합 계산 실패 500 → 502. 둘 다 기준본을 남기지 않는다. */
  @Test
  void collabBodyRejectionIsBadRequestAndMergeFailureIsBadGateway() throws Exception {
    long pageId = seedPage("본문");
    String token = "Bearer " + jwt.generateAccessToken(userId, "u", 1L);
    String req = "{\"body\":\"x\",\"version\":1,\"snapshot\":false}";
    when(collab.applyMarkdown(
            anyLong(),
            anyLong(),
            any(),
            anyString(),
            anyLong(),
            anyString(),
            anyBoolean(),
            anyBoolean()))
        .thenThrow(new CollabBodyRejectedException("노트 본문을 적용할 수 없습니다: empty body", null))
        .thenThrow(new CollabMergeFailedException("병합 실패", null));
    mvc.perform(
            put("/api/v1/wiki/pages/{id}", pageId)
                .header("Authorization", token)
                .contentType(APPLICATION_JSON)
                .content(req))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("empty body")));
    mvc.perform(
            put("/api/v1/wiki/pages/{id}", pageId)
                .header("Authorization", token)
                .contentType(APPLICATION_JSON)
                .content(req))
        .andExpect(status().isBadGateway());
    assertThat(bases(pageId)).isEmpty();
  }

  /**
   * 바뀐 것이 없는 AI 병합(no-op)은 동기화 서버가 현재 판을 그대로 돌려준다. 그 판에 이미 구버전 웹 저장의 제출 본문이 있으면 AI 본문으로 덮지 않는다 — 그
   * 웹의 다음 저장이 기준을 잃지 않게.
   */
  @Test
  void noOpMergeDoesNotOverwriteAnotherSavesSubmittedBody() {
    long pageId = seedPage("병합본");
    recordWritten(pageId, 1, "병합본", "웹이 보낸 본문");
    when(collab.applyMarkdown(
            anyLong(),
            anyLong(),
            any(),
            anyString(),
            anyLong(),
            anyString(),
            anyBoolean(),
            anyBoolean()))
        .thenReturn(new CollabApplyResult(1, "병합본"));
    pageService.save(userId, pageId, new SavePageRequest(null, "병합본", 1, false), true);
    assertThat(baseRow(pageId, 1).submittedBody()).isEqualTo("웹이 보낸 본문");
  }

  /** 동기화 서버 장애 — 본문은 조용히 버리지 않고 503, 먼저 커밋된 제목은 남는다. */
  @Test
  void collabFailureIsServiceUnavailableAndTitleStays() throws Exception {
    long pageId = seedPage("본문");
    when(collab.applyMarkdown(
            anyLong(),
            anyLong(),
            any(),
            anyString(),
            anyLong(),
            anyString(),
            anyBoolean(),
            anyBoolean()))
        .thenThrow(new CollabUnavailableException("down", null));
    mvc.perform(
            put("/api/v1/wiki/pages/{id}", pageId)
                .header("Authorization", "Bearer " + jwt.generateAccessToken(userId, "u", 1L))
                .contentType(APPLICATION_JSON)
                .content(
                    "{\"title\":\"바뀐 제목\",\"body\":\"새 본문\",\"version\":1,\"snapshot\":false}"))
        .andExpect(status().isServiceUnavailable());
    tenant1();
    WikiPageDetail after = pageService.get(userId, pageId);
    assertThat(after.title()).isEqualTo("바뀐 제목");
    assertThat(after.body()).isEqualTo("본문");
    // 결과를 모르는 실패(타임아웃 포함) — 새 판의 기준본을 남기지 않는다.
    assertThat(bases(pageId)).doesNotContainKey(2);
  }

  /** ai 플래그 — 브라우저 JWT 는 사람(false), 채팅 비서의 Internal on-behalf-of 는 AI(true). */
  @Test
  void aiFlagFollowsAuthenticationMethod() throws Exception {
    long pageId = seedPage("본문");
    when(collab.applyMarkdown(
            anyLong(),
            anyLong(),
            any(),
            anyString(),
            anyLong(),
            anyString(),
            anyBoolean(),
            anyBoolean()))
        .thenReturn(new CollabApplyResult(5, "x"));
    String req = "{\"body\":\"x\",\"version\":1,\"snapshot\":false}";

    mvc.perform(
            put("/api/v1/wiki/pages/{id}", pageId)
                .header("Authorization", "Bearer " + jwt.generateAccessToken(userId, "u", 1L))
                .contentType(APPLICATION_JSON)
                .content(req))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.version").value(5));
    verify(collab)
        .applyMarkdown(
            eq(1L), eq(pageId), any(), eq("x"), eq(userId), anyString(), eq(false), eq(false));

    mvc.perform(
            put("/api/v1/wiki/pages/{id}", pageId)
                .header("Authorization", "Internal test-token")
                .header("X-On-Behalf-Of", String.valueOf(userId))
                .contentType(APPLICATION_JSON)
                .content(req))
        .andExpect(status().isOk());
    verify(collab)
        .applyMarkdown(
            eq(1L), eq(pageId), any(), eq("x"), eq(userId), anyString(), eq(true), eq(true));
  }

  @Test
  void viewerCannotSaveTitle() {
    long spaceId = seedTeamSpaceWithMember(otherUserId, "VIEWER");
    long pageId = seedPageIn(spaceId, "본문");
    assertThatThrownBy(
            () -> pageService.save(otherUserId, pageId, new SavePageRequest("x", null, 1, false)))
        .isInstanceOf(WikiForbiddenException.class);
    tenant1();
    assertThat(pageService.get(userId, pageId).title()).isEqualTo("페이지");
    // (멤버 추가 시드가 revalidate 를 부르므로 위임 여부만 본다)
    verify(collab, never())
        .applyMarkdown(
            anyLong(),
            anyLong(),
            any(),
            anyString(),
            anyLong(),
            anyString(),
            anyBoolean(),
            anyBoolean());
  }

  @Test
  void membershipChangesRevalidateCollabConnectionsAfterCommit() {
    long spaceId = seedTeamSpaceWithMember(otherUserId, "EDITOR");
    verify(collab, timeout(2000))
        .revalidate(
            argThat(
                r ->
                    r.tenantId() == 1L
                        && r.spaceId() == spaceId
                        && r.userId() == otherUserId
                        && r.pageIds() == null));
    clearInvocations(collab);

    tenant1();
    spaceService.changeRole(userId, spaceId, otherUserId, "VIEWER");
    verify(collab, timeout(2000))
        .revalidate(argThat(r -> r.spaceId() == spaceId && r.userId() == otherUserId));
    clearInvocations(collab);

    tenant1();
    spaceService.removeMember(userId, spaceId, otherUserId);
    verify(collab, timeout(2000))
        .revalidate(
            argThat(
                r -> r.tenantId() == 1L && r.spaceId() == spaceId && r.userId() == otherUserId));
  }

  @Test
  void rolledBackMembershipChangeDoesNotRevalidate() {
    long spaceId = seedTeamSpaceWithMember(otherUserId, "EDITOR");
    verify(collab, timeout(2000)).revalidate(any());
    clearInvocations(collab);

    inRollbackTx(soft -> spaceService.removeMember(userId, spaceId, otherUserId));
    verify(collab, after(500).never()).revalidate(any());
  }

  /** 페이지 삭제 — 자식까지 CASCADE 로 사라지므로 서브트리 전체 id 로 재검증한다. */
  @Test
  void deletingPageRevalidatesWholeSubtreeAfterCommit() {
    long parentId = seedPage("부모");
    tenant1();
    long spaceId = spaceService.ensurePersonalSpace(userId).id();
    long childId = pageService.create(userId, spaceId, new CreatePageRequest(parentId, "자식")).id();
    clearInvocations(collab);

    tenant1();
    pageService.delete(userId, parentId);
    verify(collab, timeout(2000))
        .revalidate(
            argThat(
                r ->
                    r.tenantId() == 1L
                        && r.spaceId() == spaceId
                        && r.userId() == null
                        && r.pageIds() != null
                        && r.pageIds().containsAll(List.of(parentId, childId))
                        && r.pageIds().size() == 2));
    verify(collab, never())
        .applyMarkdown(
            anyLong(),
            anyLong(),
            any(),
            anyString(),
            anyLong(),
            anyString(),
            anyBoolean(),
            anyBoolean());
  }

  /** 페이지 상세 조회는 기본으로 기준본을 남기고(MCP·구버전 웹), 새 웹 에디터의 ?base=false 는 남기지 않는다(스펙 §3.3). */
  @Test
  void pageGetRecordsBaseByDefaultButNotWithBaseFalse() throws Exception {
    long pageId = seedPage("본문");
    String auth = "Bearer " + jwt.generateAccessToken(userId, "u", 1L);
    mvc.perform(
            get("/api/v1/wiki/pages/{id}", pageId)
                .param("base", "false")
                .header("Authorization", auth))
        .andExpect(status().isOk());
    assertThat(bases(pageId)).isEmpty();
    mvc.perform(get("/api/v1/wiki/pages/{id}", pageId).header("Authorization", auth))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.version").value(1));
    assertThat(bases(pageId)).containsExactly(entry(1, "본문"));
  }

  /** 같은 판을 여러 번 읽어도 (page_id, version) 한 행만 남는다 — 조회마다 행이 늘지 않는다. */
  @Test
  void repeatedReadsOfTheSameVersionKeepOneRow() throws Exception {
    long pageId = seedPage("본문");
    String auth = "Bearer " + jwt.generateAccessToken(userId, "u", 1L);
    for (int i = 0; i < 5; i++) {
      mvc.perform(get("/api/v1/wiki/pages/{id}", pageId).header("Authorization", auth))
          .andExpect(status().isOk());
    }
    assertThat(bases(pageId)).containsExactly(entry(1, "본문"));
    // 판이 올라가면 그 판의 행이 하나 더 생길 뿐이다.
    advancePage(pageId, 2, "본문2");
    for (int i = 0; i < 3; i++) {
      mvc.perform(get("/api/v1/wiki/pages/{id}", pageId).header("Authorization", auth))
          .andExpect(status().isOk());
    }
    assertThat(bases(pageId)).containsOnly(entry(1, "본문"), entry(2, "본문2"));
  }

  /** 생성 응답의 version 으로 바로 본문을 저장해도(create_wiki_page → update_wiki_page) 기준본이 있다. */
  @Test
  void createRecordsTheEmptyBodyAsBase() {
    tenant1();
    long spaceId = spaceService.ensurePersonalSpace(userId).id();
    tenant1();
    long pageId = pageService.create(userId, spaceId, new CreatePageRequest(null, "새 페이지")).id();
    assertThat(bases(pageId)).containsExactly(entry(1, ""));
  }

  /** 다시 읽으면 보관 시간만 연장된다 — 저장 응답이 남긴 제출 본문을 지우지 않는다(Task 5 참조). */
  @Test
  void rereadRefreshesReadAtButKeepsTheSubmittedBody() {
    long pageId = seedPage("본문");
    recordWritten(pageId, 1, "본문", "제출본");
    ageBase(pageId, 1, Duration.ofHours(2));
    tenant1();
    pageService.read(userId, pageId, true);
    WikiBodyHistoryRepository.BaseRow row = baseRow(pageId, 1);
    assertThat(row.body()).isEqualTo("본문");
    assertThat(row.submittedBody()).isEqualTo("제출본");
    assertThat(row.readAt()).isAfter(OffsetDateTime.now().minus(WikiBodyHistoryRepository.TTL));
  }

  /** 정리: 1시간 지난 기준본은 지우되 그 페이지의 현재 version 행은 남긴다(오래 열어 둔 구버전 웹의 다음 저장 기준). */
  @Test
  void cleanupDeletesExpiredBasesButKeepsTheCurrentVersion() {
    long pageId = seedPage("본문");
    recordWritten(pageId, 1, "v1", null);
    recordWritten(pageId, 2, "v2", null);
    recordWritten(pageId, 3, "v3", null);
    advancePage(pageId, 3, "v3");
    ageBase(pageId, 1, Duration.ofHours(2));
    ageBase(pageId, 3, Duration.ofHours(2));
    bodyCleanup.sweepAllTenants();
    assertThat(bases(pageId)).containsOnlyKeys(2, 3);
  }

  /** 테넌트 격리 — tenant#1 에 남긴 기준본은 다른 테넌트 컨텍스트에서 보이지도, 지워지지도 않는다(RLS fail-closed). */
  @Test
  void basesAreInvisibleToOtherTenants() {
    long pageId = seedPage("본문");
    recordWritten(pageId, 1, "본문", null);
    ageBase(pageId, 1, Duration.ofHours(2));
    advancePage(pageId, 2, "본문2");
    long otherTenant = 999_999L;
    TenantContext.set(otherTenant);
    try {
      TransactionTemplate tx = new TransactionTemplate(txManager);
      Optional<WikiBodyHistoryRepository.BaseRow> seen = tx.execute(s -> bodies.find(pageId, 1));
      Integer deleted = tx.execute(s -> bodies.deleteExpired(Duration.ZERO));
      assertThat(seen).isEmpty();
      assertThat(deleted).isZero();
    } finally {
      TenantContext.clear();
    }
    // 양성 대조 — tenant#1 에선 그대로 보인다.
    assertThat(baseRow(pageId, 1).body()).isEqualTo("본문");
  }

  // ── 시드 헬퍼 ──

  private static void tenant1() {
    TenantContext.set(1L);
  }

  private long seedUser() {
    tenant1();
    long id = TestFixtures.createHuman(dsl);
    seededUserIds.add(id);
    return withMembership(id);
  }

  /** 호출자 개인 공간에 페이지를 만든다. 본문은 저장 경로(=동기화 서버 위임)를 거치지 않고 직접 넣는다. */
  private long seedPage(String body) {
    tenant1();
    return seedPageIn(spaceService.ensurePersonalSpace(userId).id(), body);
  }

  private long seedPageIn(long spaceId, String body) {
    tenant1();
    long id = pageService.create(userId, spaceId, new CreatePageRequest(null, "페이지")).id();
    tenant1();
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            s -> {
              dsl.update(WIKI_PAGE).set(WIKI_PAGE.BODY, body).where(WIKI_PAGE.ID.eq(id)).execute();
              // 생성이 빈 본문으로 남긴 기준본을 지운다 — 시드는 저장 경로를 거치지 않으므로.
              dsl.deleteFrom(WIKI_PAGE_BODY_HISTORY)
                  .where(WIKI_PAGE_BODY_HISTORY.PAGE_ID.eq(id))
                  .execute();
            });
    return id;
  }

  /** userId 소유 팀 공간에 member 를 role 로 추가한다. */
  private long seedTeamSpaceWithMember(long member, String role) {
    tenant1();
    long spaceId = spaceService.createTeamSpace(userId, "협업팀-" + UUID.randomUUID()).id();
    tenant1();
    spaceService.addMember(userId, spaceId, member, role);
    tenant1();
    return spaceId;
  }

  /** 페이지의 기준본 행 — version → 본문. */
  private Map<Integer, String> bases(long pageId) {
    tenant1();
    return new TransactionTemplate(txManager)
        .execute(
            s ->
                dsl.select(WIKI_PAGE_BODY_HISTORY.VERSION, WIKI_PAGE_BODY_HISTORY.BODY)
                    .from(WIKI_PAGE_BODY_HISTORY)
                    .where(WIKI_PAGE_BODY_HISTORY.PAGE_ID.eq(pageId))
                    .fetchMap(WIKI_PAGE_BODY_HISTORY.VERSION, WIKI_PAGE_BODY_HISTORY.BODY));
  }

  /** 기준본을 age 만큼 오래된 것으로 만든다(만료 시나리오). */
  private void ageBase(long pageId, int version, Duration age) {
    tenant1();
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            s ->
                dsl.update(WIKI_PAGE_BODY_HISTORY)
                    .set(WIKI_PAGE_BODY_HISTORY.READ_AT, OffsetDateTime.now().minus(age))
                    .where(
                        WIKI_PAGE_BODY_HISTORY
                            .PAGE_ID
                            .eq(pageId)
                            .and(WIKI_PAGE_BODY_HISTORY.VERSION.eq(version)))
                    .execute());
  }

  /** 동기화 서버의 파생 저장이 몇 번 지나간 상태 흉내 — version·본문을 직접 올린다. */
  private void advancePage(long pageId, int version, String body) {
    tenant1();
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            s ->
                dsl.update(WIKI_PAGE)
                    .set(WIKI_PAGE.VERSION, version)
                    .set(WIKI_PAGE.BODY, body)
                    .where(WIKI_PAGE.ID.eq(pageId))
                    .execute());
  }

  /** 기준본 직접 기록(트랜잭션·테넌트 포함). submitted 는 null 가능. */
  private void recordWritten(long pageId, int version, String body, String submitted) {
    tenant1();
    new TransactionTemplate(txManager)
        .executeWithoutResult(s -> bodies.recordApplied(pageId, version, body, submitted));
  }

  /** 기준본 한 행 읽기(트랜잭션·테넌트 포함). */
  private WikiBodyHistoryRepository.BaseRow baseRow(long pageId, int version) {
    tenant1();
    return new TransactionTemplate(txManager)
        .execute(s -> bodies.find(pageId, version).orElseThrow());
  }
}
