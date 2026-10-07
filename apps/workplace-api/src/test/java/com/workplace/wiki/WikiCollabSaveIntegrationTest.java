package com.workplace.wiki;

import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static com.workplace.jooq.Tables.WIKI_PAGE;
import static com.workplace.jooq.Tables.WIKI_REVISION;
import static com.workplace.jooq.Tables.WIKI_SPACE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.after;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.http.MediaType.APPLICATION_JSON;
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
import com.workplace.wiki.exception.CollabUnavailableException;
import com.workplace.wiki.exception.WikiForbiddenException;
import com.workplace.wiki.outbound.CollabClient;
import com.workplace.wiki.outbound.CollabClient.CollabApplyResult;
import com.workplace.wiki.service.WikiCollabDocService;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiSpaceService;
import java.util.ArrayList;
import java.util.List;
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
    when(collab.applyMarkdown(eq(1L), eq(pageId), eq("새 본문"), eq(userId), anyString(), eq(false)))
        .thenReturn(new CollabApplyResult(7, "새 본문"));
    WikiPageDetail saved =
        pageService.save(userId, pageId, new SavePageRequest(null, "새 본문", 1, false), false);
    String name = dsl.select(USER.NAME).from(USER).where(USER.ID.eq(userId)).fetchOne(USER.NAME);
    // R8: 응답 version 은 재조회가 아니라 동기화 서버가 돌려준 값.
    assertThat(saved.version()).isEqualTo(7);
    assertThat(saved.body()).isEqualTo("새 본문");
    verify(collab).applyMarkdown(eq(1L), eq(pageId), eq("새 본문"), eq(userId), eq(name), eq(false));
  }

  /**
   * 3-way 병합(WP-289) 전까지의 임시 규칙 — 본문 저장의 version 이 현재와 다르면 낡은 읽기로 만든 본문이 실시간 문서를 통째로 덮으므로 기존 낙관적
   * 저장과 같은 409 로 거절한다. 제목도 커밋하지 않고 동기화 서버도 부르지 않는다.
   */
  @Test
  void staleVersionBodySaveIsConflictLikeBefore() throws Exception {
    long pageId = seedPage("본문");
    tenant1();
    int version = pageService.get(userId, pageId).version();
    mvc.perform(
            put("/api/v1/wiki/pages/{id}", pageId)
                .header("Authorization", "Bearer " + jwt.generateAccessToken(userId, "u", 1L))
                .contentType(APPLICATION_JSON)
                .content(
                    "{\"title\":\"바뀐 제목\",\"body\":\"낡은 본문\",\"version\":"
                        + (version - 1)
                        + ",\"snapshot\":false}"))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.message").value("다른 사용자가 먼저 수정했습니다: page=" + pageId));
    tenant1();
    assertThat(pageService.get(userId, pageId).title()).isEqualTo("페이지");
    verifyNoInteractions(collab);
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
   * AI(MCP·채팅 비서)의 본문 덮어쓰기는 편집 세션 간격과 무관하게 항상 직전 본문을 리비전으로 남긴다 — AI 결과가 틀려도 되돌릴 수 있게. 동기화 서버가 저장하기
   * 전(위임 전)에 남겨야 덮이기 전 본문이 된다.
   */
  @Test
  void aiBodySaveAlwaysSnapshotsPreviousBody() {
    long pageId = seedPage("사람 본문");
    // 방금 리비전이 있어도(같은 편집 세션) AI 덮어쓰기 전에는 남긴다.
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
    int version = pageService.get(userId, pageId).version();
    when(collab.applyMarkdown(anyLong(), eq(pageId), anyString(), anyLong(), anyString(), eq(true)))
        .thenReturn(new CollabApplyResult(version + 1, "AI 본문"));
    pageService.save(userId, pageId, new SavePageRequest(null, "AI 본문", version, false), true);
    tenant1();
    assertThat(
            dsl.select(WIKI_REVISION.BODY)
                .from(WIKI_REVISION)
                .where(WIKI_REVISION.PAGE_ID.eq(pageId).and(WIKI_REVISION.VERSION.eq(version)))
                .fetchOne(WIKI_REVISION.BODY))
        .isEqualTo("사람 본문");
  }

  /**
   * R1: 제목+본문 저장이 위임 중에 wiki_page 행 잠금을 잡고 있으면, 동기화 서버가 되돌려 호출하는 PUT /doc 이 같은 행을 갱신하다 막힌다. 스텁이 다른
   * 스레드·트랜잭션에서 실제 store 경로를 짧은 lock_timeout 으로 실행해 성공해야 한다.
   */
  @Test
  void titleAndBodySaveDoesNotHoldRowLockDuringDelegation() {
    long pageId = seedPage("본문");
    when(collab.applyMarkdown(
            anyLong(), eq(pageId), anyString(), anyLong(), anyString(), anyBoolean()))
        .thenAnswer(
            inv -> {
              String body = inv.getArgument(2);
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
                                            "AQ==", body, List.of(userId), null));
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

  /** 동기화 서버 장애 — 본문은 조용히 버리지 않고 503, 먼저 커밋된 제목은 남는다. */
  @Test
  void collabFailureIsServiceUnavailableAndTitleStays() throws Exception {
    long pageId = seedPage("본문");
    when(collab.applyMarkdown(
            anyLong(), anyLong(), anyString(), anyLong(), anyString(), anyBoolean()))
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
  }

  /** ai 플래그 — 브라우저 JWT 는 사람(false), 채팅 비서의 Internal on-behalf-of 는 AI(true). */
  @Test
  void aiFlagFollowsAuthenticationMethod() throws Exception {
    long pageId = seedPage("본문");
    when(collab.applyMarkdown(
            anyLong(), anyLong(), anyString(), anyLong(), anyString(), anyBoolean()))
        .thenReturn(new CollabApplyResult(5, "x"));
    String req = "{\"body\":\"x\",\"version\":1,\"snapshot\":false}";

    mvc.perform(
            put("/api/v1/wiki/pages/{id}", pageId)
                .header("Authorization", "Bearer " + jwt.generateAccessToken(userId, "u", 1L))
                .contentType(APPLICATION_JSON)
                .content(req))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.version").value(5));
    verify(collab).applyMarkdown(eq(1L), eq(pageId), eq("x"), eq(userId), anyString(), eq(false));

    mvc.perform(
            put("/api/v1/wiki/pages/{id}", pageId)
                .header("Authorization", "Internal test-token")
                .header("X-On-Behalf-Of", String.valueOf(userId))
                .contentType(APPLICATION_JSON)
                .content(req))
        .andExpect(status().isOk());
    verify(collab).applyMarkdown(eq(1L), eq(pageId), eq("x"), eq(userId), anyString(), eq(true));
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
        .applyMarkdown(anyLong(), anyLong(), anyString(), anyLong(), anyString(), anyBoolean());
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
        .applyMarkdown(anyLong(), anyLong(), anyString(), anyLong(), anyString(), anyBoolean());
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
            s ->
                dsl.update(WIKI_PAGE)
                    .set(WIKI_PAGE.BODY, body)
                    .where(WIKI_PAGE.ID.eq(id))
                    .execute());
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
}
