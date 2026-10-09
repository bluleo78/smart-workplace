package com.workplace.wiki;

import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static com.workplace.jooq.Tables.WIKI_PAGE;
import static com.workplace.jooq.Tables.WIKI_PAGE_BODY_HISTORY;
import static com.workplace.jooq.Tables.WIKI_PAGE_DOC;
import static com.workplace.jooq.Tables.WIKI_REVISION;
import static com.workplace.jooq.Tables.WIKI_SPACE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.hamcrest.Matchers.nullValue;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.exception.CollabUnavailableException;
import com.workplace.wiki.exception.WikiPageNotFoundException;
import com.workplace.wiki.outbound.CollabClient;
import com.workplace.wiki.outbound.CollabClient.CollabApplyResult;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiRevisionService;
import com.workplace.wiki.service.WikiSpaceService;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 노트 버전 기록 조회·복원 API(WP-297) — 목록(현재 판 + 최신순·편집자 이름·✦ 귀속), 단건, 권한(VIEWER 조회·EDITOR 복원·비멤버·타 테넌트),
 * 복원(동기화 서버 켜짐 = replace 위임 / 꺼짐 = 직접 저장).
 *
 * <p>비-@Transactional: 복원 위임은 트랜잭션 밖 호출을 요구하므로(행 잠금 금지 가드) 시드는 실제로 커밋하고 {@code @AfterEach} 에서
 * 정리한다(공간 삭제 → page·revision·doc CASCADE).
 */
@TestPropertySource(properties = "workplace.collab.enabled=true")
class WikiRevisionIntegrationTest extends IntegrationTestBase {
  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired WikiSpaceService spaceService;
  @Autowired WikiPageService pageService;
  @Autowired WikiRevisionService revisionService;
  @Autowired JwtTokenProvider jwt;

  @MockitoBean CollabClient collab;

  private final List<Long> seededUserIds = new ArrayList<>();
  private long ownerId;
  private long otherId;

  /** 시드 시각 기준 — 목록 순서·표시 시각 단언에 쓴다(마이크로초 절삭: timestamptz 정밀도). */
  private final OffsetDateTime base =
      OffsetDateTime.now(ZoneOffset.UTC).truncatedTo(ChronoUnit.SECONDS);

  @BeforeEach
  void seed() {
    tenant1();
    ownerId = seedUser("김철수");
    otherId = seedUser("이영희");
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

  /**
   * 목록: 최신순(created_at DESC), 편집자 이름 해석, 옛 행은 author_id 로 대체, AI 판의 aiActor, 현재 판 블록(pending 편집자).
   */
  @Test
  void listReturnsNewestFirstWithNamesAiActorAndCurrent() throws Exception {
    long pageId = seedPageWithRevisions(personalSpace());
    seedDoc(pageId, List.of(otherId), base.minusMinutes(3));

    as(ownerId, get("/api/v1/wiki/pages/{id}/revisions", pageId))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.current.version").value(5))
        .andExpect(jsonPath("$.current.editors.length()").value(1))
        .andExpect(jsonPath("$.current.editors[0].id").value(otherId))
        .andExpect(jsonPath("$.current.editors[0].name").value("이영희"))
        .andExpect(jsonPath("$.items.length()").value(3))
        // 최신순
        .andExpect(jsonPath("$.items[0].version").value(4))
        .andExpect(jsonPath("$.items[1].version").value(3))
        .andExpect(jsonPath("$.items[2].version").value(2))
        // AI 판 — ✦ 귀속
        .andExpect(jsonPath("$.items[0].reason").value("AI"))
        .andExpect(jsonPath("$.items[0].aiActor.id").value(otherId))
        .andExpect(jsonPath("$.items[0].aiActor.name").value("이영희"))
        // 세션 판 — 편집자 둘(누적 순서 그대로), aiActor 없음
        .andExpect(jsonPath("$.items[1].reason").value("SESSION"))
        .andExpect(jsonPath("$.items[1].editors[0].name").value("김철수"))
        .andExpect(jsonPath("$.items[1].editors[1].name").value("이영희"))
        .andExpect(jsonPath("$.items[1].aiActor").value(nullValue()))
        .andExpect(jsonPath("$.items[1].title").value("제목 v3"))
        // WP-297 이전 행 — reason null, editor_ids 비어 author_id 로 대체
        .andExpect(jsonPath("$.items[2].reason").value(nullValue()))
        .andExpect(jsonPath("$.items[2].editors.length()").value(1))
        .andExpect(jsonPath("$.items[2].editors[0].id").value(ownerId))
        // 목록엔 본문을 싣지 않는다
        .andExpect(jsonPath("$.items[0].body").doesNotExist());

    // 시각 대체 규칙: editedAt = edited_at ?? created_at, current.editedAt = body_changed_at.
    tenant1();
    var res = revisionService.list(ownerId, pageId);
    assertThat(res.current().editedAt().toInstant()).isEqualTo(base.minusMinutes(3).toInstant());
    assertThat(res.items().get(1).editedAt().toInstant())
        .isEqualTo(base.minusMinutes(130).toInstant());
    assertThat(res.items().get(2).editedAt().toInstant())
        .isEqualTo(res.items().get(2).createdAt().toInstant());
  }

  /** wiki_page_doc 이 없으면(동기화 서버 저장 전) 현재 판 편집자는 updated_by, 시각은 updated_at. */
  @Test
  void currentFallsBackToUpdatedByWithoutDoc() {
    long pageId = seedPageWithRevisions(personalSpace());
    tenant1();
    var res = revisionService.list(ownerId, pageId);
    assertThat(res.current().editors()).extracting(p -> p.id()).containsExactly(ownerId);
    OffsetDateTime updatedAt =
        inTxGet(
            () ->
                dsl.select(WIKI_PAGE.UPDATED_AT)
                    .from(WIKI_PAGE)
                    .where(WIKI_PAGE.ID.eq(pageId))
                    .fetchOne(WIKI_PAGE.UPDATED_AT));
    assertThat(res.current().editedAt().toInstant()).isEqualTo(updatedAt.toInstant());
  }

  /** 본문이 빈 옛 판은 복원하지 않는다 — 노트를 비우지 않게 위임 전에 400(collab 호출 없음, 리비전·본문 불변). */
  @Test
  void restoreOfBlankRevisionIs400() throws Exception {
    long pageId = seedPageWithRevisions(personalSpace());
    blankRevision(pageId, 2);
    as(ownerId, post("/api/v1/wiki/pages/{id}/revisions/{v}/restore", pageId, 2))
        .andExpect(status().isBadRequest());
    verify(collab, never())
        .replaceMarkdown(anyLong(), anyLong(), anyString(), anyLong(), anyString());
  }

  @Test
  void getReturnsTitleAndBodyAnd404ForMissingVersion() throws Exception {
    long pageId = seedPageWithRevisions(personalSpace());
    as(ownerId, get("/api/v1/wiki/pages/{id}/revisions/{v}", pageId, 3))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.version").value(3))
        .andExpect(jsonPath("$.title").value("제목 v3"))
        .andExpect(jsonPath("$.body").value("본문 v3"))
        .andExpect(jsonPath("$.reason").value("SESSION"))
        .andExpect(jsonPath("$.editors.length()").value(2));
    as(ownerId, get("/api/v1/wiki/pages/{id}/revisions/{v}", pageId, 99))
        .andExpect(status().isNotFound());
    as(ownerId, post("/api/v1/wiki/pages/{id}/revisions/{v}/restore", pageId, 99))
        .andExpect(status().isNotFound());
    verifyNoInteractions(collab);
  }

  /** VIEWER 는 목록·단건 200, 복원 403. 비멤버는 존재를 드러내지 않게 404. */
  @Test
  void viewerCanReadButNotRestoreAndNonMemberGets404() throws Exception {
    long spaceId = seedTeamSpaceWithMember(otherId, "VIEWER");
    long pageId = seedPageWithRevisions(spaceId);
    as(otherId, get("/api/v1/wiki/pages/{id}/revisions", pageId)).andExpect(status().isOk());
    as(otherId, get("/api/v1/wiki/pages/{id}/revisions/{v}", pageId, 3)).andExpect(status().isOk());
    as(otherId, post("/api/v1/wiki/pages/{id}/revisions/{v}/restore", pageId, 3))
        .andExpect(status().isForbidden());

    long stranger = seedUser("박외부");
    as(stranger, get("/api/v1/wiki/pages/{id}/revisions", pageId)).andExpect(status().isNotFound());
    as(stranger, get("/api/v1/wiki/pages/{id}/revisions/{v}", pageId, 3))
        .andExpect(status().isNotFound());
    as(stranger, post("/api/v1/wiki/pages/{id}/revisions/{v}/restore", pageId, 3))
        .andExpect(status().isNotFound());
    // 멤버 추가가 연결 재검증(revalidate)을 보내므로 복원 위임만 없음을 확인한다.
    verify(collab, never())
        .replaceMarkdown(anyLong(), anyLong(), anyString(), anyLong(), anyString());
  }

  /** 다른 테넌트 컨텍스트에서는 RLS 로 페이지 자체가 보이지 않는다 — 404. */
  @Test
  void otherTenantCannotSeeRevisions() {
    long pageId = seedPageWithRevisions(personalSpace());
    TenantContext.set(2L);
    try {
      assertThatThrownBy(() -> revisionService.list(ownerId, pageId))
          .isInstanceOf(WikiPageNotFoundException.class);
      assertThatThrownBy(() -> revisionService.get(ownerId, pageId, 3))
          .isInstanceOf(WikiPageNotFoundException.class);
      assertThatThrownBy(() -> revisionService.restore(ownerId, pageId, 3))
          .isInstanceOf(WikiPageNotFoundException.class);
    } finally {
      tenant1();
    }
    verifyNoInteractions(collab);
  }

  /**
   * 복원(동기화 서버 켜짐): 그 판 본문으로 replace 위임 → 응답 version 은 동기화 서버 값, 응답 판 기준본 기록. 복원 직전 스냅샷은 동기화 서버의
   * RESTORE 저장이 남기므로 API 는 리비전을 직접 남기지 않는다.
   */
  @Test
  void restoreDelegatesReplaceToCollab() throws Exception {
    long pageId = seedPageWithRevisions(personalSpace());
    when(collab.replaceMarkdown(1L, pageId, "본문 v3", ownerId, "김철수"))
        .thenReturn(new CollabApplyResult(12, "본문 v3"));

    as(ownerId, post("/api/v1/wiki/pages/{id}/revisions/{v}/restore", pageId, 3))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.id").value(pageId))
        .andExpect(jsonPath("$.version").value(12))
        .andExpect(jsonPath("$.body").value("본문 v3"))
        // 복원은 본문만 — 제목은 그대로(판정 R5)
        .andExpect(jsonPath("$.title").value("현재 제목"));

    verify(collab).replaceMarkdown(1L, pageId, "본문 v3", ownerId, "김철수");
    tenant1();
    inTx(
        () -> {
          var hist =
              dsl.selectFrom(WIKI_PAGE_BODY_HISTORY)
                  .where(
                      WIKI_PAGE_BODY_HISTORY
                          .PAGE_ID
                          .eq(pageId)
                          .and(WIKI_PAGE_BODY_HISTORY.VERSION.eq(12)))
                  .fetchOne();
          assertThat(hist).isNotNull();
          assertThat(hist.getBody()).isEqualTo("본문 v3");
          assertThat(hist.getSubmittedBody()).isEqualTo("본문 v3");
          assertThat(dsl.fetchCount(WIKI_REVISION, WIKI_REVISION.PAGE_ID.eq(pageId))).isEqualTo(3);
        });
  }

  /** 동기화 서버 장애는 503 — 아무것도 기록하지 않는다. */
  @Test
  void restoreCollabUnavailableIs503() throws Exception {
    long pageId = seedPageWithRevisions(personalSpace());
    when(collab.replaceMarkdown(eq(1L), eq(pageId), anyString(), anyLong(), anyString()))
        .thenThrow(new CollabUnavailableException("잠시 후 다시 시도해 주세요.", null));
    as(ownerId, post("/api/v1/wiki/pages/{id}/revisions/{v}/restore", pageId, 3))
        .andExpect(status().isServiceUnavailable());
    tenant1();
    inTx(
        () ->
            assertThat(
                    dsl.fetchCount(
                        WIKI_PAGE_BODY_HISTORY, WIKI_PAGE_BODY_HISTORY.PAGE_ID.eq(pageId)))
                .isZero());
  }

  /** 동기화 서버가 꺼진 경로(테스트·비상) — 한 트랜잭션에서 RESTORE 스냅샷 + 직접 본문 저장(version+1). */
  // inheritProperties=false — 바깥 클래스의 enabled=true 가 병합 때 이기지 않도록 상속을 끊는다(별도 컨텍스트).
  @Nested
  @TestPropertySource(properties = "workplace.collab.enabled=false", inheritProperties = false)
  class CollabOff {
    // 이 클래스의 컨텍스트(collab 꺼짐) 빈 — 바깥 필드(mvc 등)는 바깥 컨텍스트(collab 켜짐)에서 주입된다. 시드는 같은 DB 라 바깥 빈을 그대로 쓴다.
    @Autowired MockMvc offMvc;
    @MockitoBean CollabClient offCollab;

    private ResultActions restoreAs(long userId, long pageId, int version) throws Exception {
      return offMvc.perform(
          post("/api/v1/wiki/pages/{id}/revisions/{v}/restore", pageId, version)
              .header("Authorization", "Bearer " + jwt.generateAccessToken(userId, "u", 1L)));
    }

    @Test
    void restoreSavesDirectlyWithRestoreSnapshot() throws Exception {
      long pageId = seedPageWithRevisions(personalSpace());

      restoreAs(ownerId, pageId, 3)
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.version").value(6))
          .andExpect(jsonPath("$.body").value("본문 v3"))
          .andExpect(jsonPath("$.title").value("현재 제목"));

      verifyNoInteractions(offCollab);
      tenant1();
      inTx(
          () -> {
            var restore =
                dsl.selectFrom(WIKI_REVISION)
                    .where(WIKI_REVISION.PAGE_ID.eq(pageId).and(WIKI_REVISION.REASON.eq("RESTORE")))
                    .fetch();
            assertThat(restore).hasSize(1);
            assertThat(restore.get(0).getVersion()).isEqualTo(5);
            assertThat(restore.get(0).getBody()).isEqualTo("현재 본문");
            assertThat(dsl.fetchCount(WIKI_REVISION, WIKI_REVISION.PAGE_ID.eq(pageId)))
                .isEqualTo(4);
            var page = dsl.selectFrom(WIKI_PAGE).where(WIKI_PAGE.ID.eq(pageId)).fetchOne();
            assertThat(page.getBody()).isEqualTo("본문 v3");
            assertThat(page.getVersion()).isEqualTo(6);
          });
    }

    /** 본문이 빈 옛 판 — 꺼진 경로도 같은 400, 본문·version·리비전 불변. */
    @Test
    void restoreOfBlankRevisionIs400() throws Exception {
      long pageId = seedPageWithRevisions(personalSpace());
      blankRevision(pageId, 2);
      restoreAs(ownerId, pageId, 2).andExpect(status().isBadRequest());
      tenant1();
      inTx(
          () -> {
            var page = dsl.selectFrom(WIKI_PAGE).where(WIKI_PAGE.ID.eq(pageId)).fetchOne();
            assertThat(page.getBody()).isEqualTo("현재 본문");
            assertThat(page.getVersion()).isEqualTo(5);
            assertThat(dsl.fetchCount(WIKI_REVISION, WIKI_REVISION.PAGE_ID.eq(pageId)))
                .isEqualTo(3);
          });
    }

    /** 이미 같은 본문이면 저장하지 않는다 — version 이 오르지 않고 스냅샷도 남지 않는다. */
    @Test
    void restoreOfSameBodyIsNoop() throws Exception {
      long pageId = seedPageWithRevisions(personalSpace());
      tenant1();
      inTx(
          () ->
              dsl.update(WIKI_PAGE)
                  .set(WIKI_PAGE.BODY, "본문 v3")
                  .where(WIKI_PAGE.ID.eq(pageId))
                  .execute());
      restoreAs(ownerId, pageId, 3)
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.version").value(5));
      tenant1();
      inTx(
          () ->
              assertThat(dsl.fetchCount(WIKI_REVISION, WIKI_REVISION.PAGE_ID.eq(pageId)))
                  .isEqualTo(3));
    }
  }

  // ---- 헬퍼 ----

  private ResultActions as(
      long userId, org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder req)
      throws Exception {
    return mvc.perform(
        req.header("Authorization", "Bearer " + jwt.generateAccessToken(userId, "u", 1L)));
  }

  private static void tenant1() {
    TenantContext.set(1L);
  }

  private <T> T inTxGet(java.util.function.Supplier<T> r) {
    return new TransactionTemplate(txManager).execute(s -> r.get());
  }

  /** 그 판의 본문을 공백으로 바꾼다 — WP-297 이전의 빈 본문 옛 행 재현. */
  private void blankRevision(long pageId, int version) {
    tenant1();
    inTx(
        () ->
            dsl.update(WIKI_REVISION)
                .set(WIKI_REVISION.BODY, "  ")
                .where(WIKI_REVISION.PAGE_ID.eq(pageId).and(WIKI_REVISION.VERSION.eq(version)))
                .execute());
  }

  private void inTx(Runnable r) {
    new TransactionTemplate(txManager).executeWithoutResult(s -> r.run());
  }

  private long seedUser(String name) {
    tenant1();
    long id = TestFixtures.createHuman(dsl);
    dsl.update(USER).set(USER.NAME, name).where(USER.ID.eq(id)).execute();
    seededUserIds.add(id);
    return withMembership(id);
  }

  private long personalSpace() {
    tenant1();
    return spaceService.ensurePersonalSpace(ownerId).id();
  }

  /** ownerId 소유 팀 공간에 member 를 role 로 추가한다. */
  private long seedTeamSpaceWithMember(long member, String role) {
    tenant1();
    long spaceId = spaceService.createTeamSpace(ownerId, "버전팀-" + UUID.randomUUID()).id();
    tenant1();
    spaceService.addMember(ownerId, spaceId, member, role);
    tenant1();
    return spaceId;
  }

  /**
   * 현재 판 version 5("현재 제목"/"현재 본문", updated_by=owner)와 리비전 3개를 직접 넣는다.
   *
   * <ul>
   *   <li>v2: WP-297 이전 행 — editor_ids 비어 있음, author_id=owner, reason·edited_at NULL, 3시간 전
   *   <li>v3: SESSION — 편집자 owner·other, edited_at 2시간 10분 전, 2시간 전 적재
   *   <li>v4: AI — 편집자 owner, ai_actor_id=other, 1시간 전 적재
   * </ul>
   */
  private long seedPageWithRevisions(long spaceId) {
    tenant1();
    long id = pageService.create(ownerId, spaceId, new CreatePageRequest(null, "현재 제목")).id();
    tenant1();
    inTx(
        () -> {
          dsl.update(WIKI_PAGE)
              .set(WIKI_PAGE.BODY, "현재 본문")
              .set(WIKI_PAGE.VERSION, 5)
              .set(WIKI_PAGE.UPDATED_BY, ownerId)
              .where(WIKI_PAGE.ID.eq(id))
              .execute();
          // 생성이 남긴 빈 본문 기준본은 지운다 — 응답 판 기준본 단언이 섞이지 않게.
          dsl.deleteFrom(WIKI_PAGE_BODY_HISTORY)
              .where(WIKI_PAGE_BODY_HISTORY.PAGE_ID.eq(id))
              .execute();
          insertRevision(id, 2, new Long[0], null, null, null, base.minusHours(3));
          insertRevision(
              id,
              3,
              new Long[] {ownerId, otherId},
              null,
              "SESSION",
              base.minusMinutes(130),
              base.minusHours(2));
          insertRevision(
              id,
              4,
              new Long[] {ownerId},
              otherId,
              "AI",
              base.minusMinutes(70),
              base.minusHours(1));
        });
    return id;
  }

  private void insertRevision(
      long pageId,
      int version,
      Long[] editorIds,
      Long aiActorId,
      String reason,
      OffsetDateTime editedAt,
      OffsetDateTime createdAt) {
    dsl.insertInto(WIKI_REVISION)
        .set(WIKI_REVISION.PAGE_ID, pageId)
        .set(WIKI_REVISION.VERSION, version)
        .set(WIKI_REVISION.TITLE, "제목 v" + version)
        .set(WIKI_REVISION.BODY, "본문 v" + version)
        .set(WIKI_REVISION.AUTHOR_ID, ownerId)
        .set(WIKI_REVISION.EDITOR_IDS, editorIds)
        .set(WIKI_REVISION.AI_ACTOR_ID, aiActorId)
        .set(WIKI_REVISION.REASON, reason)
        .set(WIKI_REVISION.EDITED_AT, editedAt)
        .set(WIKI_REVISION.CREATED_AT, createdAt)
        .execute();
  }

  /** 동기화 서버 저장 흔적 — 마지막 스냅샷 이후 편집자와 마지막 본문 변경 시각. */
  private void seedDoc(long pageId, List<Long> pending, OffsetDateTime bodyChangedAt) {
    tenant1();
    inTx(
        () ->
            dsl.insertInto(WIKI_PAGE_DOC)
                .set(WIKI_PAGE_DOC.PAGE_ID, pageId)
                .set(WIKI_PAGE_DOC.STATE, new byte[] {1})
                .set(WIKI_PAGE_DOC.BODY_VERSION, 5)
                .set(WIKI_PAGE_DOC.BODY_CHANGED_AT, bodyChangedAt)
                .set(WIKI_PAGE_DOC.PENDING_EDITOR_IDS, pending.toArray(Long[]::new))
                .execute());
  }
}
