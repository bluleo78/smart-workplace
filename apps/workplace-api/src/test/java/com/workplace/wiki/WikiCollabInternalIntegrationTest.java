package com.workplace.wiki;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static com.workplace.jooq.Tables.WIKI_PAGE;
import static com.workplace.jooq.Tables.WIKI_PAGE_ATTACHMENT;
import static com.workplace.jooq.Tables.WIKI_PAGE_DOC;
import static com.workplace.jooq.Tables.WIKI_REVISION;
import static com.workplace.jooq.Tables.WIKI_SPACE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.http.MediaType.APPLICATION_JSON;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.dto.SavePageRequest;
import com.workplace.wiki.dto.WikiAttachmentResponse;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiPageUpdatedEvent;
import com.workplace.wiki.service.WikiAttachmentService;
import com.workplace.wiki.service.WikiHydrationService;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiSpaceService;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.stream.Collectors;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Record5;
import org.jooq.impl.DSL;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * 노트 동기화 서버(workplace-collab)가 쓰는 내부 엔드포인트 — 내부 토큰·테넌트 헤더로만 문서 상태를 읽고 쓴다(WP-286).
 *
 * <p>비-@Transactional: 다른 테넌트(999) 헤더로 요청하는 404 검증은 요청이 자기 트랜잭션을 열어 그 테넌트 GUC 로 조회해야 성립한다. 클래스
 * 레벨 @Transactional 이면 MockMvc 요청이 테넌트 1 GUC 가 박힌 테스트 트랜잭션에 합류해 행이 보여버린다. 대신 시드한 공간·유저를
 * {@code @AfterEach} 에서 직접 정리한다(공간 삭제 → page·doc·reference CASCADE).
 *
 * <p>주의: JwtAuthenticationFilter 와 내부 컨트롤러가 요청 끝에 TenantContext 를 비우므로, 요청 뒤 서비스를 직접 호출하는 단언 전에는
 * 테넌트를 다시 심는다({@link #tenant1()}).
 */
@RecordApplicationEvents
class WikiCollabInternalIntegrationTest extends IntegrationTestBase {
  @Autowired ApplicationEvents events;
  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired WikiSpaceService spaceService;
  @Autowired WikiPageService pageService;
  @Autowired WikiHydrationService hydrationService;
  @Autowired JwtTokenProvider jwt;
  @Autowired ObjectMapper objectMapper;
  @Autowired WikiAttachmentService attachmentService;

  private final List<Long> seededUserIds = new ArrayList<>();
  private final List<Long> seededFileIds = new ArrayList<>();
  private long userId;

  @BeforeEach
  void seed() {
    tenant1();
    userId = seedUser();
  }

  @AfterEach
  void cleanup() {
    cleanupInTenant(
        1L,
        () -> {
          if (!seededUserIds.isEmpty()) {
            // 공간 삭제 → wiki_space_member·wiki_page(→wiki_page_doc·wiki_reference) CASCADE.
            dsl.deleteFrom(WIKI_SPACE).where(WIKI_SPACE.OWNER_ID.in(seededUserIds)).execute();
            // 첨부 file 행은 페이지 CASCADE 대상이 아니다(매핑만 지워짐) — 유저 삭제 전에 직접 지운다.
            if (!seededFileIds.isEmpty()) {
              dsl.deleteFrom(FILE).where(FILE.ID.in(seededFileIds)).execute();
            }
            dsl.deleteFrom(USER_ROLE).where(USER_ROLE.USER_ID.in(seededUserIds)).execute();
            // membership 은 user 삭제 시 FK CASCADE.
            dsl.deleteFrom(USER).where(USER.ID.in(seededUserIds)).execute();
          }
        });
    seededUserIds.clear();
    seededFileIds.clear();
    TenantContext.clear();
  }

  @Test
  void rejectsMissingOrWrongInternalToken() throws Exception {
    long pageId = seedPage("본문");
    mvc.perform(get("/internal/wiki/pages/{id}/doc", pageId).header("X-Tenant-Id", "1"))
        .andExpect(status().isUnauthorized());
    mvc.perform(
            get("/internal/wiki/pages/{id}/doc", pageId)
                .header("Authorization", "Internal wrong")
                .header("X-Tenant-Id", "1"))
        .andExpect(status().isUnauthorized());
    mvc.perform(
            put("/internal/wiki/pages/{id}/doc", pageId)
                .header("Authorization", "Internal wrong")
                .header("X-Tenant-Id", "1")
                .contentType(APPLICATION_JSON)
                .content("{\"state\":\"AQ==\",\"body\":\"x\",\"editorIds\":[]}"))
        .andExpect(status().isUnauthorized());
  }

  @Test
  void missingTenantHeaderIsBadRequest() throws Exception {
    long pageId = seedPage("본문");
    mvc.perform(
            get("/internal/wiki/pages/{id}/doc", pageId)
                .header("Authorization", "Internal test-token"))
        .andExpect(status().isBadRequest());
  }

  @Test
  void loadReturnsBodyWithoutStateForUnmigratedPage() throws Exception {
    long pageId = seedPage("# 제목\n\n본문");
    mvc.perform(internal(get("/internal/wiki/pages/{id}/doc", pageId)))
        .andExpect(status().isOk())
        // state·bodyVersion 은 null 이면 키 자체를 생략한다(NON_NULL) — 키 부재를 문자열로 엄격히 확인.
        .andExpect(content().string(not(containsString("\"state\""))))
        .andExpect(content().string(not(containsString("\"bodyVersion\""))))
        .andExpect(jsonPath("$.body").value("# 제목\n\n본문"))
        .andExpect(jsonPath("$.version").value(currentVersion(pageId)));
  }

  @Test
  void storeSavesStateDerivesBodyBumpsVersionAndRefreshesBacklinks() throws Exception {
    long pageId = seedPage("old");
    long other = seedPage("target");
    int next = currentVersion(pageId) + 1;
    String state = Base64.getEncoder().encodeToString(new byte[] {1, 2, 3});
    mvc.perform(
            internal(put("/internal/wiki/pages/{id}/doc", pageId))
                .contentType(APPLICATION_JSON)
                .content(
                    "{\"state\":\""
                        + state
                        + "\",\"body\":\"see <#page:"
                        + other
                        + ">\",\"editorIds\":["
                        + userId
                        + "]}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.version").value(next));
    tenant1();
    var detail = pageService.get(userId, pageId);
    assertThat(detail.body()).isEqualTo("see <#page:" + other + ">");
    assertThat(detail.version()).isEqualTo(next);
    assertThat(detail.updatedBy()).isEqualTo(userId);
    mvc.perform(internal(get("/internal/wiki/pages/{id}/doc", pageId)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.state").value(state))
        .andExpect(jsonPath("$.version").value(next))
        .andExpect(jsonPath("$.bodyVersion").value(next));
    // 백링크가 파생 body 기준으로 갱신됐는지 — WikiPageController.backlinks 와 같은 경로.
    tenant1();
    assertThat(hydrationService.backlinks(userId, other).items())
        .extracting("pageId")
        .contains(pageId);
  }

  /**
   * WP-295 — 동시 편집에선 본문 저장이 동기화 서버의 파생 저장으로만 일어난다. 업로드 직후 임시(만료 예정) 첨부는 그 이미지를 담은 파생 저장에서 영구화되고, 이후
   * 파생 저장에서 참조가 빠지면 강등(만료 재무장)되며, 유예 안에 참조가 돌아오면 다시 영구화돼야 한다. 안 그러면 동시 편집 노트의 이미지가 임시 만료로 지워지거나, 지운
   * 이미지가 영원히 남는다.
   */
  @Test
  void derivedStorePromotesReferencedAttachmentAndDemotesItWhenDropped() throws Exception {
    long pageId = seedPage("본문");
    tenant1();
    var file = new MockMultipartFile("file", "a.png", "image/png", png());
    WikiAttachmentResponse att = attachmentService.upload(userId, pageId, file);
    seededFileIds.add(att.fileId());
    assertThat(expiresAtOf(att.fileId())).as("셋업: 업로드 직후엔 임시(만료 예정)").isNotNull();
    String image = "![a](" + WikiAttachmentResponse.urlOf(pageId, att.fileId()) + ")";

    storeBody(pageId, "본문 " + image);
    assertThat(expiresAtOf(att.fileId())).as("이미지를 담은 파생 저장이 영구화").isNull();
    assertThat(demotedAtOf(att.fileId())).isNull();

    storeBody(pageId, "본문");
    assertThat(expiresAtOf(att.fileId())).as("참조가 빠진 파생 저장이 만료를 다시 건다").isNotNull();
    assertThat(demotedAtOf(att.fileId())).as("강등 시각 기록").isNotNull();

    storeBody(pageId, "본문 다시 " + image);
    assertThat(expiresAtOf(att.fileId())).as("유예 안에 참조가 돌아오면 다시 영구화").isNull();
    assertThat(demotedAtOf(att.fileId())).isNull();
  }

  /**
   * 본문이 그대로인 파생 저장(커서 이동·서식 왕복·같은 글자 쳤다 지움 등) — 상태만 기록하고 version·updated_*·백링크·첨부·SSE 는 건드리지 않는다. 안
   * 그러면 열어 두기만 해도 version 이 계속 올라 낙관적 잠금·요약 낡음·최근 수정 순서가 흔들린다.
   */
  @Test
  void derivedStoreWithUnchangedBodyStoresStateOnly() throws Exception {
    long pageId = seedPage("그대로");
    int version = currentVersion(pageId);
    var updatedAt = updatedAtOf(pageId);
    long other = seedUser();
    events.clear();
    String state = Base64.getEncoder().encodeToString(new byte[] {4, 5, 6});
    mvc.perform(
            internal(put("/internal/wiki/pages/{id}/doc", pageId))
                .contentType(APPLICATION_JSON)
                .content(
                    "{\"state\":\"" + state + "\",\"body\":\"그대로\",\"editorIds\":[" + other + "]}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.version").value(version));

    tenant1();
    var detail = pageService.get(userId, pageId);
    assertThat(detail.version()).isEqualTo(version);
    assertThat(detail.updatedBy()).isEqualTo(userId);
    assertThat(updatedAtOf(pageId)).isEqualTo(updatedAt);
    assertThat(events.stream(WikiPageUpdatedEvent.class)).isEmpty();
    // 상태는 저장되고 body_version 은 현재 version — 다음 로드가 stale 로 보지 않는다.
    mvc.perform(internal(get("/internal/wiki/pages/{id}/doc", pageId)))
        .andExpect(jsonPath("$.state").value(state))
        .andExpect(jsonPath("$.bodyVersion").value(version));
  }

  // ── 버전 기록 스냅샷 정책(WP-297, 스펙 §6.1) ─────────────────────────────────────────────
  // 시간 규칙은 DB 에 남은 시각으로 판단하므로, 시간 경과는 body_changed_at·리비전 created_at 을 과거로 당겨 흉내 낸다.

  /** 빈 본문(막 만든 노트)의 첫 본문 저장은 복원할 게 없어 리비전을 남기지 않는다(판정 R6). */
  @Test
  void firstBodyOnEmptyPageLeavesNoRevision() throws Exception {
    tenant1();
    long spaceId = spaceService.ensurePersonalSpace(userId).id();
    long pageId = pageService.create(userId, spaceId, new CreatePageRequest(null, "빈")).id();
    storeBody(pageId, "첫 본문");
    assertThat(revisions(pageId)).isEmpty();
  }

  /**
   * 막 만든 노트 — 첫 저장(빈 본문이라 스냅샷 생략) 몇 초 뒤의 둘째 저장이 거의 빈 판을 PERIODIC 으로 남기지 않는다(리비전이 없으면 주기 규칙도 해당 없음).
   * 첫 판은 조용했다 다시 시작할 때 SESSION 으로 남는다.
   */
  @Test
  void newNoteDoesNotSnapshotNearEmptyBodyPeriodically() throws Exception {
    tenant1();
    long spaceId = spaceService.ensurePersonalSpace(userId).id();
    long pageId = pageService.create(userId, spaceId, new CreatePageRequest(null, "새")).id();
    storeBody(pageId, "a");
    storeBody(pageId, "ab");
    assertThat(revisions(pageId)).isEmpty();
    backdateBodyChangedAt(pageId, 6);
    storeBody(pageId, "abc");
    var revs = revisions(pageId);
    assertThat(revs).hasSize(1);
    assertThat(revs.getFirst().get(WIKI_REVISION.BODY)).isEqualTo("ab");
    assertThat(revs.getFirst().get(WIKI_REVISION.REASON)).isEqualTo("SESSION");
  }

  /** snapshotReason 은 AI·RESTORE(또는 생략)만 — 그 밖의 값은 잘못된 요청이고 아무것도 저장하지 않는다. */
  @Test
  void unknownSnapshotReasonIsBadRequest() throws Exception {
    long pageId = seedPage("본문");
    mvc.perform(
            internal(put("/internal/wiki/pages/{id}/doc", pageId))
                .contentType(APPLICATION_JSON)
                .content(
                    "{\"state\":\"AQ==\",\"body\":\"x\",\"editorIds\":[],\"snapshot\":true,"
                        + "\"snapshotReason\":\"MANUAL\"}"))
        .andExpect(status().isBadRequest());
    tenant1();
    assertThat(pageService.get(userId, pageId).body()).isEqualTo("본문");
    assertThat(revisions(pageId)).isEmpty();
  }

  /**
   * 기준 시각이 없는(동기화 서버 저장이 처음인) 기존 페이지는 첫 본문 저장에서 SESSION 1회 — 이관 직후 판을 남긴다. 그 판의 본문 변경 시각은
   * wiki_page.updated_at, 편집자는 직전 수정자.
   */
  @Test
  void firstCollabStoreOfExistingPageSnapshotsSession() throws Exception {
    long pageId = seedPage("기존 본문");
    var updatedAt = updatedAtOf(pageId);
    storeBody(pageId, "새 본문");
    var revs = revisions(pageId);
    assertThat(revs).hasSize(1);
    assertThat(revs.getFirst().get(WIKI_REVISION.BODY)).isEqualTo("기존 본문");
    assertThat(revs.getFirst().get(WIKI_REVISION.REASON)).isEqualTo("SESSION");
    assertThat(revs.getFirst().get(WIKI_REVISION.EDITED_AT)).isEqualTo(updatedAt);
    assertThat(revs.getFirst().get(WIKI_REVISION.EDITOR_IDS)).containsExactly(userId);
  }

  /** 5분 넘게 조용했다가 다시 저장되면 바뀌기 직전 판을 SESSION 으로 — 본문 변경 시각은 당겨 둔 body_changed_at, 편집자는 누적분. */
  @Test
  void storeAfterQuietGapSnapshotsSession() throws Exception {
    long pageId = primedPage("첫 본문");
    var changedAt = backdateBodyChangedAt(pageId, 6);
    storeBody(pageId, "다음 본문");
    var revs = revisions(pageId);
    assertThat(revs).hasSize(2);
    var last = revs.getLast();
    assertThat(last.get(WIKI_REVISION.BODY)).isEqualTo("첫 본문");
    assertThat(last.get(WIKI_REVISION.REASON)).isEqualTo("SESSION");
    assertThat(last.get(WIKI_REVISION.EDITED_AT)).isEqualTo(changedAt);
    assertThat(last.get(WIKI_REVISION.EDITOR_IDS)).containsExactly(userId);
    assertThat(last.get(WIKI_REVISION.AI_ACTOR_ID)).isNull();
  }

  /** 쉬지 않는 편집 — 마지막 리비전이 30분 넘으면 PERIODIC, 10분이면 남기지 않는다. */
  @Test
  void continuousEditingSnapshotsPeriodicallyEvery30Minutes() throws Exception {
    long pageId = primedPage("첫 본문");
    backdateBodyChangedAt(pageId, 1);
    backdateRevisions(pageId, 10);
    storeBody(pageId, "둘째 본문");
    assertThat(revisions(pageId)).hasSize(1);

    backdateBodyChangedAt(pageId, 1);
    backdateRevisions(pageId, 31);
    storeBody(pageId, "셋째 본문");
    var revs = revisions(pageId);
    assertThat(revs).hasSize(2);
    assertThat(revs.getLast().get(WIKI_REVISION.BODY)).isEqualTo("둘째 본문");
    assertThat(revs.getLast().get(WIKI_REVISION.REASON)).isEqualTo("PERIODIC");
  }

  /** 스냅샷 사이 편집자는 처음 등장 순·중복 없이 누적되고, 스냅샷 때 그 판으로 옮겨진 뒤 이번 저장 편집자로 다시 시작한다(판정 R4). */
  @Test
  void editorsAccumulateUntilSnapshotThenRestartWithCurrentEditor() throws Exception {
    long a = seedUser();
    long b = seedUser();
    long pageId = seedPage("첫 본문");
    store(pageId, "a1", List.of(a), "");
    store(pageId, "b1", List.of(b), "");
    store(pageId, "a2", List.of(a), "");
    assertThat(pendingEditors(pageId)).containsExactly(a, b);
    backdateBodyChangedAt(pageId, 6);
    store(pageId, "c1", List.of(userId), "");
    var last = revisions(pageId).getLast();
    assertThat(last.get(WIKI_REVISION.BODY)).isEqualTo("a2");
    assertThat(last.get(WIKI_REVISION.EDITOR_IDS)).containsExactly(a, b);
    assertThat(pendingEditors(pageId)).containsExactly(userId);
  }

  /** AI 적용 저장은 시간과 무관하게 직전 판을 AI 로, ✦ 귀속은 실어 보낸 요청자. */
  @Test
  void aiApplySnapshotsWithActorRegardlessOfTime() throws Exception {
    long actor = seedUser();
    long pageId = primedPage("사람 본문");
    store(
        pageId,
        "AI 본문",
        List.of(userId),
        ",\"snapshot\":true,\"snapshotReason\":\"AI\",\"aiActorId\":" + actor);
    var last = revisions(pageId).getLast();
    assertThat(revisions(pageId)).hasSize(2);
    assertThat(last.get(WIKI_REVISION.BODY)).isEqualTo("사람 본문");
    assertThat(last.get(WIKI_REVISION.REASON)).isEqualTo("AI");
    assertThat(last.get(WIKI_REVISION.AI_ACTOR_ID)).isEqualTo(actor);
  }

  /** 복원 적용 저장은 RESTORE — AI 귀속 없음. */
  @Test
  void restoreApplySnapshotsRestoreWithoutAiActor() throws Exception {
    long pageId = primedPage("복원 전 본문");
    store(
        pageId,
        "복원 본문",
        List.of(userId),
        ",\"snapshot\":true,\"snapshotReason\":\"RESTORE\",\"aiActorId\":" + userId);
    var last = revisions(pageId).getLast();
    assertThat(last.get(WIKI_REVISION.BODY)).isEqualTo("복원 전 본문");
    assertThat(last.get(WIKI_REVISION.REASON)).isEqualTo("RESTORE");
    assertThat(last.get(WIKI_REVISION.AI_ACTOR_ID)).isNull();
  }

  /** 사유를 싣지 않는 구버전 동기화 서버의 snapshot 은 AI 적용 — ✦ 귀속은 저장 편집자의 마지막 값(판정 R7). */
  @Test
  void legacySnapshotWithoutReasonIsAiAttributedToLastEditor() throws Exception {
    long other = seedUser();
    long pageId = primedPage("사람 본문");
    store(pageId, "AI 본문", List.of(userId, other), ",\"snapshot\":true");
    var last = revisions(pageId).getLast();
    assertThat(last.get(WIKI_REVISION.REASON)).isEqualTo("AI");
    assertThat(last.get(WIKI_REVISION.AI_ACTOR_ID)).isEqualTo(other);
  }

  /** 제목만 바꾸는 사용자 저장은 본문 기준 시각을 리셋하지 않는다 — 조용했던 뒤의 다음 본문 저장이 그대로 SESSION 을 남긴다. */
  @Test
  void titleOnlySaveDoesNotResetQuietReference() throws Exception {
    long pageId = primedPage("첫 본문");
    var changedAt = backdateBodyChangedAt(pageId, 6);
    tenant1();
    pageService.save(userId, pageId, new SavePageRequest("새 제목", null, null, false));
    assertThat(bodyChangedAt(pageId)).isEqualTo(changedAt);
    storeBody(pageId, "다음 본문");
    var last = revisions(pageId).getLast();
    assertThat(revisions(pageId)).hasSize(2);
    assertThat(last.get(WIKI_REVISION.REASON)).isEqualTo("SESSION");
  }

  /** 본문이 같은 저장(상태만 바뀜)은 리비전·기준 시각·누적 편집자를 건드리지 않는다. */
  @Test
  void unchangedBodyStoreLeavesRevisionPolicyStateAlone() throws Exception {
    long other = seedUser();
    long pageId = primedPage("그대로");
    var changedAt = backdateBodyChangedAt(pageId, 6);
    store(pageId, "그대로", List.of(other), "");
    assertThat(revisions(pageId)).hasSize(1);
    assertThat(bodyChangedAt(pageId)).isEqualTo(changedAt);
    assertThat(pendingEditors(pageId)).containsExactly(userId);
  }

  /** 동기화 서버가 꺼진 저장 경로도 같은 시간 규칙 — 기준 시각은 wiki_page.updated_at, 편집자는 직전 수정자. snapshot 플래그는 무시. */
  @Test
  void nonCollabSaveUsesSameTimeRules() throws Exception {
    long pageId = seedPage("첫 본문");
    tenant1();
    dsl.update(WIKI_PAGE)
        .set(WIKI_PAGE.UPDATED_AT, minutesAgo(6))
        .where(WIKI_PAGE.ID.eq(pageId))
        .execute();
    var updatedAt = updatedAtOf(pageId);
    pageService.save(
        userId, pageId, new SavePageRequest(null, "둘째", currentVersion(pageId), false));
    var revs = revisions(pageId);
    assertThat(revs).hasSize(1);
    assertThat(revs.getFirst().get(WIKI_REVISION.REASON)).isEqualTo("SESSION");
    assertThat(revs.getFirst().get(WIKI_REVISION.EDITED_AT)).isEqualTo(updatedAt);
    assertThat(revs.getFirst().get(WIKI_REVISION.EDITOR_IDS)).containsExactly(userId);
    // 이어지는 저장(방금 리비전·방금 수정) — snapshot=true 여도 남기지 않는다(판정 R8).
    tenant1();
    pageService.save(userId, pageId, new SavePageRequest(null, "셋째", currentVersion(pageId), true));
    assertThat(revisions(pageId)).hasSize(1);
  }

  @Test
  void storeWithoutEditorsKeepsPreviousUpdatedBy() throws Exception {
    // 생성 직후 페이지는 updated_by 가 NULL — 편집자 없는 저장(서버 내부 적용)이 언박싱 NPE 없이 직전 값(NULL)을 유지해야 한다.
    tenant1();
    long spaceId = spaceService.ensurePersonalSpace(userId).id();
    var created = pageService.create(userId, spaceId, new CreatePageRequest(null, "빈 페이지"));
    long pageId = created.id();
    assertThat(created.updatedBy()).isNull();
    mvc.perform(
            internal(put("/internal/wiki/pages/{id}/doc", pageId))
                .contentType(APPLICATION_JSON)
                .content("{\"state\":\"AQ==\",\"body\":\"서버 적용\",\"editorIds\":[]}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.version").value(created.version() + 1));
    tenant1();
    var detail = pageService.get(userId, pageId);
    assertThat(detail.body()).isEqualTo("서버 적용");
    assertThat(detail.updatedBy()).isNull();
  }

  @Test
  void stateOnlyStoreKeepsBodyVersionReferencesAndAttachmentsAndAlignsBodyVersion()
      throws Exception {
    // 처음 열린 노트의 이관 저장(편집 없음) — 상태만 저장하고 body·version·updated_*·백링크·첨부는 그대로여야 한다.
    // 재직렬화한 body 를 쓰면 원문 HTML·체크리스트 등이 손실되고 version 이 올라 최근 수정 순서·낙관적 잠금이 흔들린다.
    long other = seedPage("target");
    long pageId = seedPage("old");
    tenant1();
    var file = new MockMultipartFile("file", "a.png", "image/png", png());
    WikiAttachmentResponse att = attachmentService.upload(userId, pageId, file);
    seededFileIds.add(att.fileId());
    String body =
        "<span>raw</span> see <#page:"
            + other
            + "> ![a]("
            + WikiAttachmentResponse.urlOf(pageId, att.fileId())
            + ")";
    var saved =
        pageService.save(
            userId, pageId, new SavePageRequest(null, body, currentVersion(pageId), false));
    int version = saved.version();
    var updatedAt = updatedAtOf(pageId);
    assertThat(expiresAtOf(att.fileId())).as("셋업: 본문 참조로 승격됨").isNull();

    String state = Base64.getEncoder().encodeToString(new byte[] {7, 8, 9});
    mvc.perform(
            internal(put("/internal/wiki/pages/{id}/doc", pageId))
                .contentType(APPLICATION_JSON)
                .content("{\"state\":\"" + state + "\",\"bodyVersion\":" + version + "}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.version").value(version));

    tenant1();
    var detail = pageService.get(userId, pageId);
    assertThat(detail.body()).isEqualTo(body);
    assertThat(detail.version()).isEqualTo(version);
    assertThat(detail.updatedBy()).isEqualTo(userId);
    assertThat(updatedAtOf(pageId)).isEqualTo(updatedAt);
    assertThat(hydrationService.backlinks(userId, other).items())
        .extracting("pageId")
        .contains(pageId);
    assertThat(expiresAtOf(att.fileId())).isNull();
    assertThat(demotedAtOf(att.fileId())).isNull();
    // 상태는 저장되고 body_version 이 현재 version 과 같아 다음 로드가 stale 로 보지 않는다.
    mvc.perform(internal(get("/internal/wiki/pages/{id}/doc", pageId)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.state").value(state))
        .andExpect(jsonPath("$.body").value(body))
        .andExpect(jsonPath("$.version").value(version))
        .andExpect(jsonPath("$.bodyVersion").value(version));
  }

  @Test
  void stateOnlyStoreNeverClaimsABodyNewerThanTheOneItWasBuiltFrom() throws Exception {
    // 로드(version v) 뒤 collab 밖에서 body 가 바뀌어 v+1 이 됐다면, v 의 body 로 만든 상태를 v+1 로 표시하면 안 된다 —
    // 다음 로드가 stale 로 보고 최신 body 를 반영해야 한다(그렇지 않으면 다음 파생 저장이 바깥 변경을 덮어쓴다).
    long pageId = seedPage("v1");
    int built = currentVersion(pageId);
    tenant1();
    pageService.save(userId, pageId, new SavePageRequest(null, "v2", built, false));
    int current = currentVersion(pageId);
    mvc.perform(
            internal(put("/internal/wiki/pages/{id}/doc", pageId))
                .contentType(APPLICATION_JSON)
                .content("{\"state\":\"AQ==\",\"bodyVersion\":" + built + "}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.version").value(current));
    mvc.perform(internal(get("/internal/wiki/pages/{id}/doc", pageId)))
        .andExpect(jsonPath("$.body").value("v2"))
        .andExpect(jsonPath("$.bodyVersion").value(built));
  }

  @Test
  void stateOnlyStoreOnMissingOrOtherTenantPageIsNotFound() throws Exception {
    long pageId = seedPage("본문");
    mvc.perform(
            put("/internal/wiki/pages/{id}/doc", pageId)
                .header("Authorization", "Internal test-token")
                .header("X-Tenant-Id", "999")
                .contentType(APPLICATION_JSON)
                .content("{\"state\":\"AQ==\",\"bodyVersion\":1}"))
        .andExpect(status().isNotFound());
    // body 도 bodyVersion 도 없으면 어떤 저장인지 알 수 없다 — 잘못된 요청.
    mvc.perform(
            internal(put("/internal/wiki/pages/{id}/doc", pageId))
                .contentType(APPLICATION_JSON)
                .content("{\"state\":\"AQ==\"}"))
        .andExpect(status().isBadRequest());
  }

  @Test
  void otherTenantPageIsNotFound() throws Exception {
    long pageId = seedPage("본문");
    mvc.perform(
            get("/internal/wiki/pages/{id}/doc", pageId)
                .header("Authorization", "Internal test-token")
                .header("X-Tenant-Id", "999"))
        .andExpect(status().isNotFound());
    mvc.perform(
            put("/internal/wiki/pages/{id}/doc", pageId)
                .header("Authorization", "Internal test-token")
                .header("X-Tenant-Id", "999")
                .contentType(APPLICATION_JSON)
                .content("{\"state\":\"AQ==\",\"body\":\"침범\",\"editorIds\":[]}"))
        .andExpect(status().isNotFound());
    tenant1();
    assertThat(pageService.get(userId, pageId).body()).isEqualTo("본문");
  }

  @Test
  void collabAccessReturnsRoleTenantNameAndJwtExpForMember() throws Exception {
    long pageId = seedPage("본문");
    String token = jwt.generateAccessToken(userId, "user-" + userId, 1L);
    // 기대 exp 는 토큰 페이로드를 직접 디코드해 얻는다(구현과 같은 파서를 쓰면 동어반복).
    String payload =
        new String(Base64.getUrlDecoder().decode(token.split("\\.")[1]), StandardCharsets.UTF_8);
    long expectedExp = objectMapper.readTree(payload).get("exp").asLong();
    String name = dsl.select(USER.NAME).from(USER).where(USER.ID.eq(userId)).fetchOne(USER.NAME);
    mvc.perform(
            get("/api/v1/wiki/pages/{id}/collab-access", pageId)
                .header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.pageId").value(pageId))
        .andExpect(jsonPath("$.role").value("OWNER"))
        .andExpect(jsonPath("$.tenantId").value(1))
        .andExpect(jsonPath("$.userId").value(userId))
        .andExpect(jsonPath("$.name").value(name))
        .andExpect(jsonPath("$.tokenExp").value(expectedExp));
  }

  @Test
  void collabAccessTokenExpIsNullWhenNotJwtAuthenticated() throws Exception {
    long pageId = seedPage("본문");
    // 내부 토큰 + X-On-Behalf-Of(에이전트 경로) — JWT 가 아니므로 만료 시각을 알 수 없다 → tokenExp 는 null 로 존재.
    mvc.perform(
            get("/api/v1/wiki/pages/{id}/collab-access", pageId)
                .header("Authorization", "Internal test-token")
                .header("X-On-Behalf-Of", String.valueOf(userId)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.userId").value(userId))
        .andExpect(content().string(containsString("\"tokenExp\":null")))
        .andExpect(jsonPath("$.tokenExp").value(nullValue()));
  }

  @Test
  void collabAccessIsNotFoundForNonMemberOrMissingPage() throws Exception {
    long pageId = seedPage("본문");
    long stranger = seedUser();
    mvc.perform(
            get("/api/v1/wiki/pages/{id}/collab-access", pageId)
                .header("Authorization", "Bearer " + jwt.generateAccessToken(stranger, "s", 1L)))
        .andExpect(status().isNotFound());
    mvc.perform(
            get("/api/v1/wiki/pages/{id}/collab-access", Long.MAX_VALUE)
                .header("Authorization", "Bearer " + jwt.generateAccessToken(userId, "u", 1L)))
        .andExpect(status().isNotFound());
  }

  /** 편집자 userId 의 파생 저장(본문 변경). */
  private void storeBody(long pageId, String body) throws Exception {
    store(pageId, body, List.of(userId), "");
  }

  /** 파생 저장 — extraJson 은 추가 필드(앞에 쉼표 포함, 예: {@code ,"snapshot":true}). */
  private void store(long pageId, String body, List<Long> editorIds, String extraJson)
      throws Exception {
    String editors = editorIds.stream().map(String::valueOf).collect(Collectors.joining(","));
    mvc.perform(
            internal(put("/internal/wiki/pages/{id}/doc", pageId))
                .contentType(APPLICATION_JSON)
                .content(
                    "{\"state\":\"AQ==\",\"body\":\""
                        + body
                        + "\",\"editorIds\":["
                        + editors
                        + "]"
                        + extraJson
                        + "}"))
        .andExpect(status().isOk());
  }

  /**
   * 동기화 서버로 한 번 저장된 페이지 — 그 첫 저장이 기준 시각 없는 SESSION 리비전(이관 직후 판) 1개를 남기고 body_changed_at·누적
   * 편집자({userId})를 심는다. 반환 시점의 본문은 {@code body}.
   */
  private long primedPage(String body) throws Exception {
    long pageId = seedPage("이관 전 본문");
    storeBody(pageId, body);
    assertThat(revisions(pageId)).as("셋업: 이관 직후 판 1개").hasSize(1);
    return pageId;
  }

  /** 페이지 리비전(version 순). */
  private List<Record5<String, String, Long[], Long, OffsetDateTime>> revisions(long pageId) {
    tenant1();
    return dsl.select(
            WIKI_REVISION.BODY,
            WIKI_REVISION.REASON,
            WIKI_REVISION.EDITOR_IDS,
            WIKI_REVISION.AI_ACTOR_ID,
            WIKI_REVISION.EDITED_AT)
        .from(WIKI_REVISION)
        .where(WIKI_REVISION.PAGE_ID.eq(pageId))
        .orderBy(WIKI_REVISION.VERSION)
        .fetch();
  }

  /** body_changed_at 을 지금보다 minutes 분 전으로 당기고 저장된 값을 돌려준다(DB 정밀도 그대로 비교하려고). */
  private OffsetDateTime backdateBodyChangedAt(long pageId, int minutes) {
    tenant1();
    dsl.update(WIKI_PAGE_DOC)
        .set(WIKI_PAGE_DOC.BODY_CHANGED_AT, minutesAgo(minutes))
        .where(WIKI_PAGE_DOC.PAGE_ID.eq(pageId))
        .execute();
    return bodyChangedAt(pageId);
  }

  /** 페이지의 모든 리비전 적재 시각을 지금보다 minutes 분 전으로 당긴다. */
  private void backdateRevisions(long pageId, int minutes) {
    tenant1();
    dsl.update(WIKI_REVISION)
        .set(WIKI_REVISION.CREATED_AT, minutesAgo(minutes))
        .where(WIKI_REVISION.PAGE_ID.eq(pageId))
        .execute();
  }

  /** DB 시계 기준 minutes 분 전 — 비교 대상 시각을 DB 정밀도·시계로 맞춘다. */
  private static Field<OffsetDateTime> minutesAgo(int minutes) {
    return DSL.field("now() - make_interval(mins => {0})", OffsetDateTime.class, DSL.val(minutes));
  }

  private OffsetDateTime bodyChangedAt(long pageId) {
    tenant1();
    return dsl.select(WIKI_PAGE_DOC.BODY_CHANGED_AT)
        .from(WIKI_PAGE_DOC)
        .where(WIKI_PAGE_DOC.PAGE_ID.eq(pageId))
        .fetchOne(WIKI_PAGE_DOC.BODY_CHANGED_AT);
  }

  private List<Long> pendingEditors(long pageId) {
    tenant1();
    return List.of(
        dsl.select(WIKI_PAGE_DOC.PENDING_EDITOR_IDS)
            .from(WIKI_PAGE_DOC)
            .where(WIKI_PAGE_DOC.PAGE_ID.eq(pageId))
            .fetchOne(WIKI_PAGE_DOC.PENDING_EDITOR_IDS));
  }

  private int currentVersion(long pageId) {
    tenant1();
    return pageService.get(userId, pageId).version();
  }

  private MockHttpServletRequestBuilder internal(MockHttpServletRequestBuilder b) {
    return b.header("Authorization", "Internal test-token").header("X-Tenant-Id", "1");
  }

  private static byte[] png() {
    return new byte[] {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0, 0, 0, 0, 0};
  }

  private OffsetDateTime updatedAtOf(long pageId) {
    tenant1();
    return dsl.select(WIKI_PAGE.UPDATED_AT)
        .from(WIKI_PAGE)
        .where(WIKI_PAGE.ID.eq(pageId))
        .fetchOne(WIKI_PAGE.UPDATED_AT);
  }

  private OffsetDateTime expiresAtOf(long fileId) {
    tenant1();
    return dsl.select(FILE.EXPIRES_AT)
        .from(FILE)
        .where(FILE.ID.eq(fileId))
        .fetchOne(FILE.EXPIRES_AT);
  }

  private OffsetDateTime demotedAtOf(long fileId) {
    tenant1();
    return dsl.select(WIKI_PAGE_ATTACHMENT.DEMOTED_AT)
        .from(WIKI_PAGE_ATTACHMENT)
        .where(WIKI_PAGE_ATTACHMENT.FILE_ID.eq(fileId))
        .fetchOne(WIKI_PAGE_ATTACHMENT.DEMOTED_AT);
  }

  /** 테넌트 1 을 다시 심는다 — 요청 처리 끝의 TenantContext.clear() 이후 직접 서비스 호출용. */
  private static void tenant1() {
    TenantContext.set(1L);
  }

  /** 테넌트#1 ACTIVE 멤버 유저 — X-On-Behalf-Of 경로의 테넌트 해석이 단일 멤버십을 요구한다. */
  private long seedUser() {
    tenant1();
    long id = TestFixtures.createHuman(dsl);
    seededUserIds.add(id);
    return withMembership(id);
  }

  /** 호출자 개인 공간에 본문이 있는 페이지를 만든다(생성 + 본문 저장 1회). */
  private long seedPage(String body) {
    tenant1();
    long spaceId = spaceService.ensurePersonalSpace(userId).id();
    var created = pageService.create(userId, spaceId, new CreatePageRequest(null, "페이지"));
    pageService.save(
        userId, created.id(), new SavePageRequest(null, body, created.version(), false));
    return created.id();
  }
}
