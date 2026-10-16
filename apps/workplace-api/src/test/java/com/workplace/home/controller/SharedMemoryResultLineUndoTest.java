package com.workplace.home.controller;

import static com.workplace.home.SharedMemoryFixtures.addProjectMember;
import static com.workplace.home.SharedMemoryFixtures.project;
import static com.workplace.home.SharedMemoryFixtures.user;
import static com.workplace.jooq.Tables.HOME_MESSAGE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.workplace.home.repository.SharedAiMemoryRepository;
import com.workplace.home.repository.SharedAiMemoryRepository.Row;
import com.workplace.home.service.HomeSessionService;
import com.workplace.home.service.SharedAiMemoryChangeLog;
import com.workplace.home.service.SharedAiMemoryChangeService;
import com.workplace.home.service.SharedAiMemoryService;
import com.workplace.home.service.SharedMemorySnapshot;
import com.workplace.home.service.SharedSpace.SpaceKey;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.FakeTextEmbedderConfig;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-386 스펙 6.2 결과 줄 「되돌리기」 — 그 기록을 요청자 권한으로 되돌리고 블록을 undone 으로, 두 번 눌러도 한 번, 개인 블록 순번과 섞여도 맞고, 남의
 * 대화 블록으로는 되돌릴 수 없다.
 */
@Transactional
@Import(FakeTextEmbedderConfig.class)
class SharedMemoryResultLineUndoTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired HomeSessionService sessions;
  @Autowired ProjectService projectService;
  @Autowired ProjectMemberRepository projectMembers;
  @Autowired SharedAiMemoryRepository repo;
  @Autowired SharedAiMemoryChangeLog changeLog;
  @Autowired SharedAiMemoryService service;
  @Autowired SharedAiMemoryChangeService changeService;

  /** 요청 저장(USER_REQUESTED + ADDED 기록)과 그 결과 줄을 단 답 메시지. 앞에 개인 결과 줄 하나 — 공용 줄의 순번은 1. */
  private long[] seed(long uid, SpaceKey k) {
    return seed(uid, k, "USER_REQUESTED", uid);
  }

  /** 저장 주체를 고른 seed — actor 가 null 이면 AI 가 넣은 기록(채팅 주인은 uid, 기록 되돌리기 권한은 관리 권한자뿐). */
  private long[] seed(long uid, SpaceKey k, String origin, Long actor) {
    OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
    Row r = repo.insert(k, "PR 설명에는 캡처를 붙인다", origin, actor, actor, now);
    long changeId =
        changeLog.record(
            k,
            null,
            SharedAiMemoryChangeLog.ADDED,
            actor,
            r.id(),
            List.of(),
            SharedMemorySnapshot.of(r),
            now);
    UUID sid = sessions.create(uid).id();
    sessions.appendMessage(uid, sid, "USER", "이건 이 프로젝트 규칙으로 기억해", null, null, null);
    ArrayNode arr = om.createArrayNode();
    arr.addObject().put("kind", "text").put("textStart", 0);
    arr.addObject()
        .put("kind", "memory")
        .put("action", "saved")
        .put("memoryId", 999_999)
        .put("memoryKind", "PREFERENCE")
        .put("content", "개인 것")
        .put("source", "AI")
        .put("undone", true);
    arr.addObject()
        .put("kind", "memory")
        .put("action", "shared")
        .put("changeId", changeId)
        .put("memoryId", r.id())
        .put("spaceName", "SRL 프로젝트(SRL)")
        .put("content", r.content())
        .put("undone", false);
    long mid = sessions.appendMessage(uid, sid, "ASSISTANT", "기억했어요.", null, null, arr.toString());
    return new long[] {mid, r.id()};
  }

  private ResultActions undo(long uid, long mid, int idx) throws Exception {
    return mvc.perform(
        post("/api/v1/users/me/ai-memories/undo")
            .with(authentication(new UsernamePasswordAuthenticationToken(uid, "n/a", List.of())))
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"messageId\":" + mid + ",\"blockIndex\":" + idx + "}"));
  }

  private JsonNode block(long mid, int ordinal) throws Exception {
    String json =
        dsl.select(HOME_MESSAGE.CONTENT_BLOCKS)
            .from(HOME_MESSAGE)
            .where(HOME_MESSAGE.ID.eq(mid))
            .fetchOne()
            .value1()
            .data();
    int i = 0;
    for (JsonNode b : om.readTree(json)) {
      if ("memory".equals(b.path("kind").asText()) && i++ == ordinal) return b;
    }
    return null;
  }

  @Test
  void 결과_줄_되돌리기는_그_기록을_되돌리고_블록을_되돌림으로() throws Exception {
    long owner = user(dsl);
    long member = user(dsl);
    var p = project(projectService, owner, "SRL", "TEAM");
    addProjectMember(projectMembers, p.id(), member);
    SpaceKey k = SpaceKey.of("PROJECT", p.id());
    long[] ids = seed(member, k);

    undo(member, ids[0], 1).andExpect(status().isOk()).andExpect(jsonPath("$.undone").value(true));
    assertThat(repo.findById(ids[1])).isEmpty();
    assertThat(block(ids[0], 1).path("undone").asBoolean()).isTrue();
    // 두 번째는 멱등(블록이 이미 undone) — 공용 기록을 다시 되돌리려다 409 가 되지 않는다.
    undo(member, ids[0], 1).andExpect(status().isOk());
  }

  @Test
  void 그_뒤에_바뀐_항목이면_409_이고_블록은_그대로() throws Exception {
    long owner = user(dsl);
    long member = user(dsl);
    var p = project(projectService, owner, "SRM", "TEAM");
    addProjectMember(projectMembers, p.id(), member);
    SpaceKey k = SpaceKey.of("PROJECT", p.id());
    long[] ids = seed(member, k);
    service.update(member, ids[1], "PR 설명에는 바뀐 화면 캡처를 붙인다");

    undo(member, ids[0], 1)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.code").value("SHARED_MEMORY_CHANGED"));
    assertThat(block(ids[0], 1).path("undone").asBoolean()).isFalse();
    assertThat(repo.findById(ids[1])).isPresent();
  }

  @Test
  void 남의_대화_블록으로는_되돌릴_수_없다() throws Exception {
    long owner = user(dsl);
    long member = user(dsl);
    long other = user(dsl);
    var p = project(projectService, owner, "SRN", "TEAM");
    addProjectMember(projectMembers, p.id(), member);
    addProjectMember(projectMembers, p.id(), other);
    SpaceKey k = SpaceKey.of("PROJECT", p.id());
    long[] ids = seed(member, k);

    undo(other, ids[0], 1).andExpect(status().isNotFound());
    assertThat(repo.findById(ids[1])).isPresent();
    assertThat(block(ids[0], 1).path("undone").asBoolean()).isFalse();
  }

  @Test
  void 기록_보기에서_먼저_되돌렸으면_결과_줄은_되돌림으로_맞추고_항목은_그대로() throws Exception {
    long owner = user(dsl);
    long member = user(dsl);
    var p = project(projectService, owner, "SRO", "TEAM");
    addProjectMember(projectMembers, p.id(), member);
    SpaceKey k = SpaceKey.of("PROJECT", p.id());
    long[] ids = seed(member, k);
    // 기록 보기(변경 서비스)에서 먼저 되돌려 항목은 이미 지워졌다.
    long changeId = block(ids[0], 1).path("changeId").asLong();
    changeService.undo(member, changeId);
    assertThat(repo.findById(ids[1])).isEmpty();

    undo(member, ids[0], 1).andExpect(status().isOk()).andExpect(jsonPath("$.undone").value(true));
    assertThat(block(ids[0], 1).path("undone").asBoolean()).isTrue();
    assertThat(repo.findById(ids[1])).isEmpty();
  }

  @Test
  void 되돌릴_권한이_없으면_403_이고_블록은_그대로() throws Exception {
    long owner = user(dsl);
    long member = user(dsl);
    var p = project(projectService, owner, "SRP", "TEAM");
    addProjectMember(projectMembers, p.id(), member);
    SpaceKey k = SpaceKey.of("PROJECT", p.id());
    // AI 가 넣은 기록 — 일반 구성원은 읽을 수는 있지만 되돌릴 수 없다(관리 권한자만).
    long[] ids = seed(member, k, "AI_EXTRACTED", null);

    undo(member, ids[0], 1)
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.errors.code").value("SHARED_MEMORY_FORBIDDEN"));
    assertThat(block(ids[0], 1).path("undone").asBoolean()).isFalse();
    assertThat(repo.findById(ids[1])).isPresent();
  }
}
