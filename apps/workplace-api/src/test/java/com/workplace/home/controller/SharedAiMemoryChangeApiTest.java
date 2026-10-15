package com.workplace.home.controller;

import static com.workplace.home.SharedMemoryFixtures.addProjectMember;
import static com.workplace.home.SharedMemoryFixtures.addWikiMember;
import static com.workplace.home.SharedMemoryFixtures.grantAdmin;
import static com.workplace.home.SharedMemoryFixtures.project;
import static com.workplace.home.SharedMemoryFixtures.teamWiki;
import static com.workplace.home.SharedMemoryFixtures.user;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.tenant.TenantContext;
import com.workplace.home.repository.SharedAiMemoryChangeRepository;
import com.workplace.home.repository.SharedAiMemoryChangeRepository.NewChange;
import com.workplace.home.repository.SharedAiMemoryForgottenRepository;
import com.workplace.home.repository.SharedAiMemoryRepository;
import com.workplace.home.repository.SharedAiMemoryRepository.Row;
import com.workplace.home.service.SharedAiMemoryChangeLog;
import com.workplace.home.service.SharedAiMemoryChangeService;
import com.workplace.home.service.SharedAiMemoryForgottenService;
import com.workplace.home.service.SharedAiMemoryService;
import com.workplace.home.service.SharedMemorySnapshot;
import com.workplace.home.service.SharedMemorySpaces;
import com.workplace.home.service.SharedSpace.SpaceKey;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.FakeTextEmbedderConfig;
import com.workplace.support.IntegrationTestBase;
import com.workplace.wiki.service.WikiSpaceService;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-386 공간 기록·되돌리기 — 행위자 표시, 권한(관리 권한자·본인), ADDED·UPDATED·MERGED·DELETED 규칙, 409 두 종, 90일 보관, 프로젝트
 * 삭제 정리.
 */
@Transactional
@Import(FakeTextEmbedderConfig.class)
class SharedAiMemoryChangeApiTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired ProjectService projectService;
  @Autowired ProjectMemberRepository projectMembers;
  @Autowired SharedAiMemoryRepository repo;
  @Autowired SharedAiMemoryChangeRepository changes;
  @Autowired SharedAiMemoryChangeLog changeLog;
  @Autowired SharedAiMemoryForgottenRepository forgottenRepo;
  @Autowired SharedAiMemoryService service;
  @Autowired SharedAiMemoryForgottenService forgotten;
  @Autowired WikiSpaceService wikiService;
  @Autowired SharedAiMemoryChangeService changeService;
  @Autowired com.fasterxml.jackson.databind.ObjectMapper om;

  long owner;
  long member;
  long projectId;
  String projectKey;
  SpaceKey k;
  final OffsetDateTime t0 = OffsetDateTime.of(2026, 10, 15, 0, 0, 0, 0, ZoneOffset.UTC);

  @BeforeEach
  void seed() {
    owner = user(dsl);
    member = user(dsl);
    var p = project(projectService, owner, "CHG", "TEAM");
    projectId = p.id();
    projectKey = p.key();
    addProjectMember(projectMembers, projectId, member);
    k = SpaceKey.of("PROJECT", projectId);
  }

  /** 사람 요청으로 꾸민다. 오류 응답을 거치면 필터가 테스트 스레드의 테넌트를 지우므로 요청마다 되돌려 놓는다. */
  private static RequestPostProcessor as(long uid) {
    RequestPostProcessor auth =
        authentication(new UsernamePasswordAuthenticationToken(uid, "n/a", List.of()));
    return req -> {
      TenantContext.set(1L);
      return auth.postProcessRequest(req);
    };
  }

  /** AI 가 새로 기억한 항목 + 그 기록(배경 추출과 같은 모양 — 행위자 없음). */
  private long aiAdded(String content) {
    Row r = repo.insert(k, content, "AI_EXTRACTED", null, null, t0);
    return changeLog.record(
        k,
        UUID.randomUUID(),
        SharedAiMemoryChangeLog.ADDED,
        null,
        r.id(),
        List.of(),
        SharedMemorySnapshot.of(r),
        t0);
  }

  private long lastChangeId() {
    return changes.page(k, null, 1).get(0).id();
  }

  @Test
  void 기록은_최신순이고_AI_행위자는_이름이_없다() throws Exception {
    aiAdded("배포는 API 먼저 한다");
    service.add(member, "PROJECT", projectId, "스프린트는 2주 단위다");
    mvc.perform(
            get("/api/v1/shared-ai-memories/changes")
                .param("spaceType", "PROJECT")
                .param("spaceId", String.valueOf(projectId))
                .with(as(owner)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[0].action").value("ADDED"))
        .andExpect(jsonPath("$.items[0].actor.kind").value("USER"))
        .andExpect(jsonPath("$.items[0].actor.name").exists())
        .andExpect(jsonPath("$.items[0].memory.origin").value("USER_ADDED"))
        .andExpect(jsonPath("$.items[1].actor.kind").value("AI"))
        .andExpect(jsonPath("$.items[1].actor.name").doesNotExist())
        .andExpect(jsonPath("$.items[1].memory.authorUserId").doesNotExist())
        .andExpect(jsonPath("$.items[1].undoable").value(true));
  }

  @Test
  void 구성원은_AI_기록을_되돌리지_못하고_소유자는_되돌려_지운_기록에_남긴다() throws Exception {
    long ch = aiAdded("PR 설명에는 캡처를 붙인다");
    mvc.perform(
            get("/api/v1/shared-ai-memories/changes")
                .param("spaceType", "PROJECT")
                .param("spaceId", String.valueOf(projectId))
                .with(as(member)))
        .andExpect(jsonPath("$.items[0].undoable").value(false));
    mvc.perform(post("/api/v1/shared-ai-memories/changes/" + ch + "/undo").with(as(member)))
        .andExpect(status().isForbidden());
    mvc.perform(post("/api/v1/shared-ai-memories/changes/" + ch + "/undo").with(as(owner)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.change.undoneAt").exists())
        .andExpect(jsonPath("$.change.undoable").value(false));
    assertThat(repo.count(k)).isZero();
    assertThat(forgottenRepo.contents(k)).containsExactly("PR 설명에는 캡처를 붙인다");
    // 되돌림도 기록에 남는다(행위자 = 소유자).
    var last = changes.page(k, null, 1).get(0);
    assertThat(last.action()).isEqualTo("RESTORED");
    assertThat(last.actorUserId()).isEqualTo(owner);
    // 두 번째는 409.
    mvc.perform(post("/api/v1/shared-ai-memories/changes/" + ch + "/undo").with(as(owner)))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.code").value("SHARED_MEMORY_CHANGE_UNDONE"));
    // 되돌릴 권한이 없는 구성원에게도 이미 되돌린 기록은 403 이 아니라 409 다(되돌림 여부를 권한보다 먼저 본다).
    mvc.perform(post("/api/v1/shared-ai-memories/changes/" + ch + "/undo").with(as(member)))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.code").value("SHARED_MEMORY_CHANGE_UNDONE"));
  }

  @Test
  void 본인이_추가한_기록은_본인이_되돌리고_지운_기록에_넣지_않는다() throws Exception {
    service.add(member, "PROJECT", projectId, "회의록은 노트에 남긴다");
    long ch = lastChangeId();
    mvc.perform(post("/api/v1/shared-ai-memories/changes/" + ch + "/undo").with(as(member)))
        .andExpect(status().isOk());
    assertThat(repo.count(k)).isZero();
    assertThat(forgottenRepo.contents(k)).isEmpty();
  }

  @Test
  void 고침_뒤에_또_바뀌었으면_409_CHANGED() throws Exception {
    var added = service.add(member, "PROJECT", projectId, "첫 문장");
    service.update(member, added.id(), "두 번째 문장");
    long ch = lastChangeId();
    service.update(member, added.id(), "세 번째 문장");
    mvc.perform(post("/api/v1/shared-ai-memories/changes/" + ch + "/undo").with(as(owner)))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.code").value("SHARED_MEMORY_CHANGED"));
  }

  @Test
  void 고침을_되돌리면_이전_내용으로() throws Exception {
    var added = service.add(member, "PROJECT", projectId, "첫 문장");
    service.update(member, added.id(), "두 번째 문장");
    long ch = lastChangeId();
    mvc.perform(post("/api/v1/shared-ai-memories/changes/" + ch + "/undo").with(as(member)))
        .andExpect(status().isOk());
    assertThat(repo.findById(added.id()).orElseThrow().content()).isEqualTo("첫 문장");
    // 사람이 한 고침을 되돌린 것은 AI 결과의 거절이 아니라 지운 기록에 남기지 않는다.
    assertThat(forgottenRepo.contents(k)).isEmpty();
  }

  /**
   * AI 의 고침을 사람이 되돌리면 AI 가 낸 문장을 지운 기록에 남겨, 배경 추출이 같은 고침을 되풀이하지 못하게 한다(WP-385 rememberRejected).
   */
  @Test
  void AI_고침을_되돌리면_거절한_문장이_지운_기록에_남는다() {
    Row before = repo.insert(k, "배포는 금요일에 한다", "AI_EXTRACTED", null, null, t0);
    Row after = repo.update(before.id(), "배포는 목요일에 한다", "AI_CLEANED", null, t0.plusMinutes(1));
    long ch =
        changeLog.record(
            k,
            UUID.randomUUID(),
            SharedAiMemoryChangeLog.UPDATED,
            null,
            before.id(),
            List.of(SharedMemorySnapshot.of(before)),
            SharedMemorySnapshot.of(after),
            t0);
    changeService.undo(owner, ch);
    assertThat(repo.findById(before.id()).orElseThrow().content()).isEqualTo("배포는 금요일에 한다");
    assertThat(forgottenRepo.contents(k)).containsExactly("배포는 목요일에 한다");
    assertThat(forgotten.isForgotten(k, "배포는 목요일에 한다.", null)).isTrue();
  }

  /** AI 출처 스냅숏으로 되돌리면 되돌린 사람이 아니라 AI 소유(updated_by 없음)로 복원돼, 이후 AI 정리가 다시 손댈 수 있다(WP-386 A1). */
  @Test
  void AI_고침을_되돌린_행은_수정자가_비어_AI_가_다시_고칠_수_있다() {
    Row before = repo.insert(k, "배포는 금요일에 한다", "AI_EXTRACTED", null, null, t0);
    Row after = repo.update(before.id(), "배포는 목요일에 한다", "AI_CLEANED", null, t0.plusMinutes(1));
    long ch =
        changeLog.record(
            k,
            UUID.randomUUID(),
            SharedAiMemoryChangeLog.UPDATED,
            null,
            before.id(),
            List.of(SharedMemorySnapshot.of(before)),
            SharedMemorySnapshot.of(after),
            t0);
    changeService.undo(owner, ch);
    Row restored = repo.findById(before.id()).orElseThrow();
    assertThat(restored.updatedBy()).isNull();
    assertThat(SharedMemorySpaces.aiOwned(restored.origin(), restored.updatedBy())).isTrue();
  }

  /** 사람이 지운 AI 항목을 되살려도 AI 소유로 돌아온다 — 사람 출처 스냅숏(아래 고침 되돌리기)은 되돌린 사람이 수정자다. */
  @Test
  void 지운_AI_항목을_되살리면_수정자가_비고_사람_항목은_되돌린_사람이_수정자다() throws Exception {
    Row ai = repo.insert(k, "AI 가 기억한 규칙", "AI_EXTRACTED", null, null, t0);
    long aiChange =
        changeLog.record(
            k,
            null,
            SharedAiMemoryChangeLog.DELETED,
            owner,
            ai.id(),
            List.of(SharedMemorySnapshot.of(ai)),
            null,
            t0);
    repo.delete(ai.id());
    changeService.undo(owner, aiChange);
    assertThat(repo.findById(ai.id()).orElseThrow().updatedBy()).isNull();

    var added = service.add(member, "PROJECT", projectId, "첫 문장");
    service.update(member, added.id(), "두 번째 문장");
    changeService.undo(member, lastChangeId());
    assertThat(repo.findById(added.id()).orElseThrow().updatedBy()).isEqualTo(member);
  }

  /** 되돌린 뒤에도 남는 문장과 정규화로 같은 결과(범위만 바꾼 고침)는 거절한 말이 아니므로 남기지 않는다. */
  @Test
  void AI_고침_결과가_이전_문장과_같은_말이면_지운_기록에_넣지_않는다() {
    Row before = repo.insert(k, "배포는 금요일에 한다", "AI_EXTRACTED", null, null, t0);
    Row after = repo.update(before.id(), "배포는 금요일에 한다.", "AI_CLEANED", null, t0.plusMinutes(1));
    long ch =
        changeLog.record(
            k,
            UUID.randomUUID(),
            SharedAiMemoryChangeLog.UPDATED,
            null,
            before.id(),
            List.of(SharedMemorySnapshot.of(before)),
            SharedMemorySnapshot.of(after),
            t0);
    changeService.undo(owner, ch);
    assertThat(forgottenRepo.contents(k)).isEmpty();
  }

  /** 지운 항목의 작성자가 그 뒤 사라졌으면 작성자 없이 되살린다 — 외래키 위반 500 이 아니다. */
  @Test
  void 지움을_되돌릴_때_작성자가_사라졌으면_작성자_없이_되살린다() throws Exception {
    Row gone = repo.insert(k, "작성자가 떠난 규칙", "USER_ADDED", member, member, t0);
    repo.delete(gone.id());
    // 존재하지 않는 사용자 id 를 작성자로 가진 스냅숏(탈퇴 삭제 뒤의 기록과 같은 모양).
    SharedMemorySnapshot ghostAuthored =
        new SharedMemorySnapshot(gone.id(), gone.content(), gone.origin(), 9_000_000_000_000L);
    long ch =
        changeLog.record(
            k,
            null,
            SharedAiMemoryChangeLog.DELETED,
            owner,
            gone.id(),
            List.of(ghostAuthored),
            null,
            t0);
    mvc.perform(post("/api/v1/shared-ai-memories/changes/" + ch + "/undo").with(as(owner)))
        .andExpect(status().isOk());
    Row back = repo.findById(gone.id()).orElseThrow();
    assertThat(back.content()).isEqualTo("작성자가 떠난 규칙");
    assertThat(back.authorUserId()).isNull();
  }

  @Test
  void 지움을_되돌리면_원래_id_로_되살린다() throws Exception {
    var added = service.add(member, "PROJECT", projectId, "되살릴 규칙");
    service.delete(member, added.id());
    long ch = lastChangeId();
    mvc.perform(post("/api/v1/shared-ai-memories/changes/" + ch + "/undo").with(as(member)))
        .andExpect(status().isOk());
    Row back = repo.findById(added.id()).orElseThrow();
    assertThat(back.content()).isEqualTo("되살릴 규칙");
    assertThat(back.origin()).isEqualTo("USER_ADDED");
    assertThat(back.authorUserId()).isEqualTo(member);
  }

  @Test
  void 지움을_되돌릴_때_가득이면_409_CHANGED() throws Exception {
    var added = service.add(member, "PROJECT", projectId, "되살릴 규칙");
    service.delete(member, added.id());
    long ch = lastChangeId();
    for (int i = 0; i < 50; i++) repo.insert(k, "채움 " + i, "USER_ADDED", owner, owner, t0);
    mvc.perform(post("/api/v1/shared-ai-memories/changes/" + ch + "/undo").with(as(owner)))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.code").value("SHARED_MEMORY_CHANGED"));
  }

  @Test
  void 합침을_되돌리면_첫_대상은_이전으로_나머지는_되살린다() throws Exception {
    Row a = repo.insert(k, "표로 정리한다", "AI_EXTRACTED", null, null, t0);
    Row b = repo.insert(k, "요약은 표로", "AI_EXTRACTED", null, null, t0);
    Row merged = repo.update(a.id(), "보고서와 요약은 표로 정리한다", "AI_CLEANED", null, t0.plusMinutes(1));
    repo.delete(b.id());
    long ch =
        changeLog.record(
            k,
            UUID.randomUUID(),
            SharedAiMemoryChangeLog.MERGED,
            null,
            a.id(),
            List.of(SharedMemorySnapshot.of(a), SharedMemorySnapshot.of(b)),
            SharedMemorySnapshot.of(merged),
            t0);
    mvc.perform(post("/api/v1/shared-ai-memories/changes/" + ch + "/undo").with(as(owner)))
        .andExpect(status().isOk());
    assertThat(repo.findById(a.id()).orElseThrow().content()).isEqualTo("표로 정리한다");
    assertThat(repo.findById(a.id()).orElseThrow().origin()).isEqualTo("AI_EXTRACTED");
    assertThat(repo.findById(b.id()).orElseThrow().content()).isEqualTo("요약은 표로");
    // AI 의 합침을 되돌렸으니 거절한 합친 문장은 지운 기록에 남는다.
    assertThat(forgottenRepo.contents(k)).containsExactly("보고서와 요약은 표로 정리한다");
  }

  @Test
  void 되돌림_기록은_되돌리지_않는다() throws Exception {
    service.add(member, "PROJECT", projectId, "규칙");
    long ch = lastChangeId();
    changeService.undo(owner, ch);
    long restored = lastChangeId();
    mvc.perform(post("/api/v1/shared-ai-memories/changes/" + restored + "/undo").with(as(owner)))
        .andExpect(status().isBadRequest());
  }

  @Test
  void 남의_공간_기록은_404() throws Exception {
    long ch = aiAdded("숨은 규칙");
    long outsider = user(dsl);
    mvc.perform(post("/api/v1/shared-ai-memories/changes/" + ch + "/undo").with(as(outsider)))
        .andExpect(status().isNotFound());
  }

  @Test
  void 프로젝트를_지우면_공용_메모리도_함께_지운다() {
    service.add(member, "PROJECT", projectId, "남지 않을 규칙");
    forgotten.remember(k, List.of("지워진 AI 규칙"));
    // 다른 프로젝트의 공용 메모리는 남아야 한다.
    var other = project(projectService, owner, "OTH", "TEAM");
    SpaceKey otherKey = SpaceKey.of("PROJECT", other.id());
    service.add(owner, "PROJECT", other.id(), "다른 프로젝트 규칙");
    assertThat(forgottenRepo.contents(k)).containsExactly("지워진 AI 규칙");

    projectService.softDelete(owner, projectKey);

    assertThat(repo.count(k)).isZero();
    assertThat(changes.page(k, null, 10)).isEmpty();
    assertThat(forgottenRepo.contents(k)).isEmpty();
    assertThat(repo.count(otherKey)).isEqualTo(1);
    assertThat(changes.page(otherKey, null, 10)).hasSize(1);
  }

  @Test
  void 기록_저장소는_90일_지난_것만_지운다() {
    Row r = repo.insert(k, "오래된", "USER_ADDED", owner, owner, t0);
    OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
    long old =
        changeLog.record(
            k,
            null,
            SharedAiMemoryChangeLog.ADDED,
            owner,
            r.id(),
            List.of(),
            SharedMemorySnapshot.of(r),
            now.minusDays(91));
    long recent =
        changeLog.record(
            k,
            null,
            SharedAiMemoryChangeLog.UPDATED,
            owner,
            r.id(),
            List.of(),
            SharedMemorySnapshot.of(r),
            now.minusDays(89));
    // 테넌트 전체 삭제라 개수는 단언하지 않고 이 테스트가 넣은 행만 본다.
    changes.deleteOlderThan(now.minusDays(90));
    assertThat(changes.find(old)).isEmpty();
    assertThat(changes.find(recent)).isPresent();
  }

  @Test
  void 지움을_되돌리면_지운_기록에서도_풀린다() {
    Row ai = repo.insert(k, "AI 가 기억한 규칙", "AI_EXTRACTED", null, null, t0);
    service.delete(owner, ai.id());
    assertThat(forgottenRepo.contents(k)).containsExactly("AI 가 기억한 규칙");
    changeService.undo(owner, lastChangeId());
    assertThat(repo.findById(ai.id())).isPresent();
    assertThat(forgottenRepo.contents(k)).isEmpty();
  }

  @Test
  void 기록은_같은_밀리초_행도_빠지지_않고_페이지를_넘긴다() throws Exception {
    OffsetDateTime same = OffsetDateTime.now(ZoneOffset.UTC).minusMinutes(5);
    for (int i = 0; i < 5; i++) {
      Row r = repo.insert(k, "규칙 " + i, "USER_ADDED", owner, owner, same);
      changeLog.record(
          k,
          null,
          SharedAiMemoryChangeLog.ADDED,
          owner,
          r.id(),
          List.of(),
          SharedMemorySnapshot.of(r),
          same);
    }
    var seen = new java.util.ArrayList<Long>();
    String cursor = null;
    for (int guard = 0; guard < 5; guard++) {
      var req =
          get("/api/v1/shared-ai-memories/changes")
              .param("spaceType", "PROJECT")
              .param("spaceId", String.valueOf(projectId))
              .param("size", "2")
              .with(as(owner));
      if (cursor != null) req = req.param("cursor", cursor);
      var node =
          om.readTree(
              mvc.perform(req)
                  .andExpect(status().isOk())
                  .andReturn()
                  .getResponse()
                  .getContentAsString());
      node.path("items").forEach(i -> seen.add(i.path("id").asLong()));
      if (node.path("nextCursor").isMissingNode()) break;
      cursor = node.path("nextCursor").asText();
    }
    assertThat(seen).hasSize(5).doesNotHaveDuplicates();
  }

  @Test
  void 숫자가_아닌_커서는_첫_페이지로() throws Exception {
    aiAdded("규칙 하나");
    String bad =
        java.util.Base64.getUrlEncoder()
            .withoutPadding()
            .encodeToString(
                "1760000000000:not-a-number".getBytes(java.nio.charset.StandardCharsets.UTF_8));
    mvc.perform(
            get("/api/v1/shared-ai-memories/changes")
                .param("spaceType", "PROJECT")
                .param("spaceId", String.valueOf(projectId))
                .param("cursor", bad)
                .with(as(owner)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[0].action").value("ADDED"));
  }

  @Test
  void 기록_저장소는_시각을_밀리초로_자른다() {
    long id =
        changes.insert(
            new NewChange(
                k,
                null,
                SharedAiMemoryChangeLog.ADDED,
                owner,
                SharedAiMemoryChangeLog.ACTOR_USER,
                1L,
                "[]",
                null,
                OffsetDateTime.of(2026, 10, 15, 0, 0, 0, 123_456_000, ZoneOffset.UTC)));
    var row = changes.find(id).orElseThrow();
    assertThat(row.createdAt().getNano()).isEqualTo(123_000_000);
  }

  @Test
  void 읽을_수_없는_공간의_기록은_404() throws Exception {
    long outsider = user(dsl);
    mvc.perform(
            get("/api/v1/shared-ai-memories/changes")
                .param("spaceType", "PROJECT")
                .param("spaceId", String.valueOf(projectId))
                .with(as(outsider)))
        .andExpect(status().isNotFound());
  }

  @Test
  void 에이전트_내부_토큰으로는_되돌리지_못한다() throws Exception {
    long ch = aiAdded("내부 토큰이 못 되돌린다");
    try {
      mvc.perform(
              post("/api/v1/shared-ai-memories/changes/" + ch + "/undo")
                  .header("Authorization", "Internal test-token")
                  .header("X-On-Behalf-Of", String.valueOf(owner)))
          .andExpect(status().isForbidden())
          .andExpect(jsonPath("$.errors.code").value("SHARED_MEMORY_FORBIDDEN"));
    } finally {
      TenantContext.set(1L);
    }
    assertThat(repo.count(k)).isEqualTo(1);
  }

  @Test
  void 노트_스페이스_편집자는_본인_기록을_되돌린다() throws Exception {
    long wikiId = teamWiki(wikiService, owner, "CHGW");
    addWikiMember(wikiService, owner, wikiId, member, "EDITOR");
    SpaceKey wk = SpaceKey.of("WIKI_SPACE", wikiId);
    var added = service.add(member, "WIKI_SPACE", wikiId, "노트 제목은 명사형으로 쓴다");
    long ch = changes.page(wk, null, 1).get(0).id();
    mvc.perform(post("/api/v1/shared-ai-memories/changes/" + ch + "/undo").with(as(member)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.change.undoneAt").exists());
    assertThat(repo.findById(added.id())).isEmpty();
    assertThat(changes.page(wk, null, 1).get(0).action()).isEqualTo("RESTORED");
  }

  @Test
  void 관리자가_아니면_조직_기록을_되돌리지_못한다() throws Exception {
    long admin = user(dsl);
    grantAdmin(dsl, admin);
    service.add(admin, "ORG", null, "회의는 25분으로 끝낸다");
    SpaceKey org = SpaceKey.of("ORG", null);
    long ch = changes.page(org, null, 1).get(0).id();
    // 읽을 수는 있지만(조직은 전원 읽기) 되돌리기는 관리자만.
    mvc.perform(
            get("/api/v1/shared-ai-memories/changes").param("spaceType", "ORG").with(as(member)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[0].undoable").value(false));
    mvc.perform(post("/api/v1/shared-ai-memories/changes/" + ch + "/undo").with(as(member)))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.errors.code").value("SHARED_MEMORY_FORBIDDEN"));
    mvc.perform(post("/api/v1/shared-ai-memories/changes/" + ch + "/undo").with(as(admin)))
        .andExpect(status().isOk());
  }
}
