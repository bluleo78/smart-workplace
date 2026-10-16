package com.workplace.home.controller;

import static com.workplace.jooq.Tables.AI_MEMORY;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.home.AiMemoryTestFixtures;
import com.workplace.home.dto.AiMemoryItem;
import com.workplace.home.dto.UpdateAiMemoryRequest;
import com.workplace.home.repository.AiMemoryRepository;
import com.workplace.home.repository.AiMemoryRepository.NewMemory;
import com.workplace.home.repository.AiMemoryRepository.Row;
import com.workplace.home.service.AiMemoryChangeAction;
import com.workplace.home.service.AiMemoryChangeLog;
import com.workplace.home.service.AiMemoryService;
import com.workplace.home.service.HomeSessionService;
import com.workplace.home.service.MemorySnapshot;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-385 스펙 8.1 「AI가 정리한 기록」 — 목록(최신순·커서·지난 30일 횟수·출처 대화), 되돌리기 5종(ADDED 는 지운 기록에), 409 두 종(그 뒤
 * 바뀜·이미 되돌림, 되살릴 id 가 쓰였거나 범위가 가득이면 CHANGED), 본인만, 설정 목록의 cleanedAt(정리 뒤 그대로일 때만).
 */
@Transactional
class AiMemoryChangeApiTest extends IntegrationTestBase {

  private static final String BASE = "/api/v1/users/me/ai-memories";

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired AiMemoryRepository repo;
  @Autowired AiMemoryService service;
  @Autowired AiMemoryChangeLog changeLog;
  @Autowired HomeSessionService sessions;

  private long uid;
  private UUID sid;

  @BeforeEach
  void setUp() {
    uid = TestFixtures.createHuman(dsl);
    sid = sessions.create(uid).id();
    sessions.appendMessage(uid, sid, "USER", "배포 순서 정리하고 체크리스트 만들기", null, null, null);
  }

  private ResultActions getAs(long user, String url) throws Exception {
    return mvc.perform(
        get(url)
            .with(authentication(new UsernamePasswordAuthenticationToken(user, "n/a", List.of()))));
  }

  private ResultActions undo(long user, long changeId) throws Exception {
    return mvc.perform(
        post(BASE + "/changes/" + changeId + "/undo")
            .with(authentication(new UsernamePasswordAuthenticationToken(user, "n/a", List.of()))));
  }

  private Row ai(String content) {
    return repo.insert(uid, new NewMemory("PREFERENCE", content, "AI", sid, null, null));
  }

  private Optional<Row> find(long id) {
    return AiMemoryTestFixtures.allMemories(dsl, uid).stream()
        .filter(r -> r.id() == id)
        .findFirst();
  }

  private long record(
      AiMemoryChangeAction action,
      long memoryId,
      List<MemorySnapshot> before,
      MemorySnapshot after,
      UUID session,
      OffsetDateTime at) {
    return changeLog.record(
        uid, UUID.randomUUID(), action, memoryId, before, after, session, "사유", at);
  }

  private static OffsetDateTime now() {
    return OffsetDateTime.now(ZoneOffset.UTC);
  }

  /** 정리가 새로 기억한 메모리 + ADDED 기록. */
  private long addedChange(Row r) {
    return record(AiMemoryChangeAction.ADDED, r.id(), List.of(), MemorySnapshot.of(r), sid, now());
  }

  @Test
  void 목록은_최신순이고_커서로_이어지며_지난_30일_횟수를_준다() throws Exception {
    Row a = ai("첫째");
    Row b = ai("둘째");
    Row c = ai("셋째");
    record(
        AiMemoryChangeAction.ADDED,
        a.id(),
        List.of(),
        MemorySnapshot.of(a),
        sid,
        now().minusMinutes(3));
    record(
        AiMemoryChangeAction.ADDED,
        b.id(),
        List.of(),
        MemorySnapshot.of(b),
        sid,
        now().minusMinutes(2));
    long newest =
        record(
            AiMemoryChangeAction.ADDED,
            c.id(),
            List.of(),
            MemorySnapshot.of(c),
            sid,
            now().minusMinutes(1));
    record(
        AiMemoryChangeAction.ADDED,
        a.id(),
        List.of(),
        MemorySnapshot.of(a),
        null,
        now().minusDays(31));

    String body =
        getAs(uid, BASE + "/changes?size=2")
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items.length()").value(2))
            .andExpect(jsonPath("$.items[0].id").value(newest))
            .andExpect(jsonPath("$.items[0].action").value("ADDED"))
            .andExpect(jsonPath("$.items[0].memory.content").value("셋째"))
            .andExpect(jsonPath("$.items[0].before.length()").value(0))
            .andExpect(jsonPath("$.items[0].source.id").value(sid.toString()))
            .andExpect(jsonPath("$.items[0].source.title").value("배포 순서 정리하고 체크리스트 만들기"))
            .andExpect(jsonPath("$.items[0].reason").value("사유"))
            .andExpect(jsonPath("$.items[0].undoneAt").isEmpty())
            .andExpect(jsonPath("$.count30d").value(3))
            .andReturn()
            .getResponse()
            .getContentAsString();
    String cursor = om.readTree(body).path("nextCursor").asText();
    assertThat(cursor).isNotBlank();

    getAs(uid, BASE + "/changes?size=2&cursor=" + cursor)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items.length()").value(2))
        .andExpect(jsonPath("$.items[0].memory.content").value("첫째"))
        .andExpect(jsonPath("$.items[1].source").doesNotExist())
        .andExpect(jsonPath("$.nextCursor").isEmpty());
  }

  @Test
  void 출처_대화가_지워지면_source_가_빠진다() throws Exception {
    UUID other = sessions.create(uid).id();
    Row r = ai("출처가 지워질 메모리");
    record(AiMemoryChangeAction.ADDED, r.id(), List.of(), MemorySnapshot.of(r), other, now());
    sessions.delete(uid, other);

    getAs(uid, BASE + "/changes")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[0].source").doesNotExist());
  }

  @Test
  void 남의_기록은_보이지도_되돌려지지도_않는다() throws Exception {
    long changeId = addedChange(ai("내 것"));
    long other = TestFixtures.createHuman(dsl);

    getAs(other, BASE + "/changes")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items.length()").value(0))
        .andExpect(jsonPath("$.count30d").value(0));
    undo(other, changeId)
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.errors.code").value("AI_MEMORY_NOT_FOUND"));
  }

  @Test
  void ADDED_되돌리기는_지우고_지운_기록에_넣는다() throws Exception {
    Row r = ai("WP 프로젝트 배포 일을 맡고 있다");
    long changeId = addedChange(r);

    undo(uid, changeId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.change.id").value(changeId))
        .andExpect(jsonPath("$.change.undoneAt").isNotEmpty());

    assertThat(find(r.id())).isEmpty();
    assertThat(AiMemoryTestFixtures.forgottenContents(dsl, uid))
        .containsExactly("WP 프로젝트 배포 일을 맡고 있다");
  }

  @Test
  void UPDATED_되돌리기는_이전_내용으로_돌린다() throws Exception {
    Row before = ai("아침 회의는 9시");
    Row after = repo.update(uid, before.id(), "PREFERENCE", "아침 회의는 10시", null, null).orElseThrow();
    long changeId =
        record(
            AiMemoryChangeAction.UPDATED,
            before.id(),
            List.of(MemorySnapshot.of(before)),
            MemorySnapshot.of(after),
            sid,
            now());

    undo(uid, changeId).andExpect(status().isOk());

    assertThat(find(before.id()).orElseThrow().content()).isEqualTo("아침 회의는 9시");
  }

  @Test
  void MERGED_되돌리기는_첫_대상을_이전으로_나머지를_원래_id_로_되살린다() throws Exception {
    Row a = ai("주간 보고서는 표로");
    Row b = ai("요약은 표 형식 선호");
    Row merged =
        repo.update(uid, a.id(), "PREFERENCE", "보고서·요약은 표로 정리한다", null, null).orElseThrow();
    repo.delete(uid, b.id());
    long changeId =
        record(
            AiMemoryChangeAction.MERGED,
            a.id(),
            List.of(MemorySnapshot.of(a), MemorySnapshot.of(b)),
            MemorySnapshot.of(merged),
            sid,
            now());

    undo(uid, changeId).andExpect(status().isOk());

    assertThat(find(a.id()).orElseThrow().content()).isEqualTo("주간 보고서는 표로");
    assertThat(find(b.id()).orElseThrow().content()).isEqualTo("요약은 표 형식 선호");
  }

  @Test
  void FORGOTTEN_과_DECAYED_되돌리기는_원래_id_로_되살리고_사용_시각을_새로_둔다() throws Exception {
    Row f = ai("회의록은 영어로 쓴다");
    Row d0 = ai("출장 중엔 메일 요약만 보여 준다");
    // 감쇠로 지워진 메모리처럼 사용 시각을 2020년으로 돌린 뒤 스냅숏을 뜬다(실시간 경계 없이 "옛 사용 시각이 아님"만 본다).
    dsl.update(AI_MEMORY)
        .set(AI_MEMORY.LAST_USED_AT, OffsetDateTime.parse("2020-01-01T00:00:00Z"))
        .where(AI_MEMORY.ID.eq(d0.id()))
        .execute();
    Row d = find(d0.id()).orElseThrow();
    repo.delete(uid, f.id());
    repo.delete(uid, d.id());
    long forgottenChange =
        record(
            AiMemoryChangeAction.FORGOTTEN,
            f.id(),
            List.of(MemorySnapshot.of(f)),
            null,
            sid,
            now());
    long decayedChange =
        record(
            AiMemoryChangeAction.DECAYED, d.id(), List.of(MemorySnapshot.of(d)), null, null, now());

    undo(uid, forgottenChange).andExpect(status().isOk());
    undo(uid, decayedChange).andExpect(status().isOk());

    assertThat(find(f.id()).orElseThrow().content()).isEqualTo("회의록은 영어로 쓴다");
    assertThat(find(d.id()).orElseThrow().lastUsedAt()).isAfter(d.lastUsedAt());
  }

  @Test
  void 그_뒤에_바뀌었으면_409_AI_MEMORY_CHANGED_이고_기록은_그대로다() throws Exception {
    Row r = ai("WP 배포를 맡고 있다");
    long changeId = addedChange(r);
    UpdateAiMemoryRequest edit = new UpdateAiMemoryRequest();
    edit.setContent("WP 와 MCP 배포를 맡고 있다");
    service.update(uid, r.id(), edit, false);

    undo(uid, changeId)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.code").value("AI_MEMORY_CHANGED"));

    assertThat(find(r.id())).isPresent();
    getAs(uid, BASE + "/changes").andExpect(jsonPath("$.items[0].undoneAt").isEmpty());
  }

  // 코드 리뷰 1: 정리 뒤 사용자가 고정했으면 그것도 사용자가 바꾼 것이다 — 되돌리기가 고정한 메모리를 지우지 않는다.
  @Test
  void 정리_뒤에_고정한_메모리의_ADDED_되돌리기는_409_AI_MEMORY_CHANGED() throws Exception {
    Row r = ai("WP 배포를 맡고 있다");
    long changeId = addedChange(r);
    service.setPinned(uid, r.id(), true, false);

    undo(uid, changeId)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.code").value("AI_MEMORY_CHANGED"));

    assertThat(find(r.id()).orElseThrow().pinned()).isTrue();
    assertThat(AiMemoryTestFixtures.forgottenContents(dsl, uid)).isEmpty();
    getAs(uid, BASE + "/changes").andExpect(jsonPath("$.items[0].undoneAt").isEmpty());
  }

  // 코드 리뷰 1: 고정한 메모리를 고침 되돌리기가 이전 내용으로 고쳐 쓰지 않는다.
  @Test
  void 정리_뒤에_고정한_메모리의_UPDATED_되돌리기는_409_AI_MEMORY_CHANGED() throws Exception {
    Row before = ai("아침 회의는 9시");
    Row after = repo.update(uid, before.id(), "PREFERENCE", "아침 회의는 10시", null, null).orElseThrow();
    long changeId =
        record(
            AiMemoryChangeAction.UPDATED,
            before.id(),
            List.of(MemorySnapshot.of(before)),
            MemorySnapshot.of(after),
            sid,
            now());
    service.setPinned(uid, before.id(), true, false);

    undo(uid, changeId)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.code").value("AI_MEMORY_CHANGED"));

    assertThat(find(before.id()).orElseThrow().content()).isEqualTo("아침 회의는 10시");
    getAs(uid, BASE + "/changes").andExpect(jsonPath("$.items[0].undoneAt").isEmpty());
  }

  // 코드 리뷰 1: 고정한 합침 결과를 합침 되돌리기가 고쳐 쓰거나 원본을 되살리지 않는다.
  @Test
  void 정리_뒤에_고정한_메모리의_MERGED_되돌리기는_409_AI_MEMORY_CHANGED() throws Exception {
    Row a = ai("주간 보고서는 표로");
    Row b = ai("요약은 표 형식 선호");
    Row merged =
        repo.update(uid, a.id(), "PREFERENCE", "보고서·요약은 표로 정리한다", null, null).orElseThrow();
    repo.delete(uid, b.id());
    long changeId =
        record(
            AiMemoryChangeAction.MERGED,
            a.id(),
            List.of(MemorySnapshot.of(a), MemorySnapshot.of(b)),
            MemorySnapshot.of(merged),
            sid,
            now());
    service.setPinned(uid, a.id(), true, false);

    undo(uid, changeId)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.code").value("AI_MEMORY_CHANGED"));

    assertThat(find(a.id()).orElseThrow().content()).isEqualTo("보고서·요약은 표로 정리한다");
    assertThat(find(b.id())).isEmpty();
    getAs(uid, BASE + "/changes").andExpect(jsonPath("$.items[0].undoneAt").isEmpty());
  }

  // 코드 리뷰 2: 기록 화면에서 고침·합침을 되돌리면 사용자가 거절한 결과 문장을 지운 기록에 남긴다(결과 줄 updated 되돌리기와 같은 규칙) —
  // 같은 대화를 다시 읽는 배경 정리가 같은 고침·합침을 다시 하지 못하게.
  @Test
  void UPDATED_와_MERGED_되돌리기는_거절한_결과_문장을_지운_기록에_넣는다() throws Exception {
    Row before = ai("아침 회의는 9시");
    Row after = repo.update(uid, before.id(), "PREFERENCE", "아침 회의는 10시", null, null).orElseThrow();
    long updated =
        record(
            AiMemoryChangeAction.UPDATED,
            before.id(),
            List.of(MemorySnapshot.of(before)),
            MemorySnapshot.of(after),
            sid,
            now());
    Row a = ai("주간 보고서는 표로");
    Row b = ai("요약은 표 형식 선호");
    Row merged =
        repo.update(uid, a.id(), "PREFERENCE", "보고서·요약은 표로 정리한다", null, null).orElseThrow();
    repo.delete(uid, b.id());
    long mergedChange =
        record(
            AiMemoryChangeAction.MERGED,
            a.id(),
            List.of(MemorySnapshot.of(a), MemorySnapshot.of(b)),
            MemorySnapshot.of(merged),
            sid,
            now());

    undo(uid, updated).andExpect(status().isOk());
    undo(uid, mergedChange).andExpect(status().isOk());

    assertThat(AiMemoryTestFixtures.forgottenContents(dsl, uid))
        .containsExactlyInAnyOrder("아침 회의는 10시", "보고서·요약은 표로 정리한다");
  }

  // 코드 리뷰 2: 내용이 그대로인 고침(범위만 옮김)·원본 문장 하나로 합친 합침의 결과는 되돌린 뒤에도 있는 문장이라 지운 기록에 넣지 않는다 — 넣으면 그
  // 메모리 자체를 막는다.
  @Test
  void 결과_문장이_되돌린_뒤에도_있는_문장이면_지운_기록에_넣지_않는다() throws Exception {
    Row before = ai("아침 회의는 9시");
    Row after =
        repo.update(uid, before.id(), "PREFERENCE", "아침 회의는 9시", "ISSUE", null).orElseThrow();
    long scopeOnly =
        record(
            AiMemoryChangeAction.UPDATED,
            before.id(),
            List.of(MemorySnapshot.of(before)),
            MemorySnapshot.of(after),
            sid,
            now());
    Row a = ai("주간 보고서는 표로");
    Row b = ai("요약은 표 형식 선호");
    Row merged = repo.update(uid, a.id(), "PREFERENCE", "요약은 표 형식 선호", null, null).orElseThrow();
    repo.delete(uid, b.id());
    long intoSecond =
        record(
            AiMemoryChangeAction.MERGED,
            a.id(),
            List.of(MemorySnapshot.of(a), MemorySnapshot.of(b)),
            MemorySnapshot.of(merged),
            sid,
            now());

    undo(uid, scopeOnly).andExpect(status().isOk());
    undo(uid, intoSecond).andExpect(status().isOk());

    assertThat(find(before.id()).orElseThrow().scope()).isNull();
    assertThat(find(b.id()).orElseThrow().content()).isEqualTo("요약은 표 형식 선호");
    assertThat(AiMemoryTestFixtures.forgottenContents(dsl, uid)).isEmpty();
  }

  @Test
  void 이미_되돌렸으면_409_AI_MEMORY_CHANGE_UNDONE() throws Exception {
    long changeId = addedChange(ai("한 번만"));

    undo(uid, changeId).andExpect(status().isOk());
    undo(uid, changeId)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.code").value("AI_MEMORY_CHANGE_UNDONE"));
  }

  @Test
  void 되살릴_범위가_가득이거나_id_가_이미_쓰였으면_409_AI_MEMORY_CHANGED() throws Exception {
    Row full = ai("가득 찬 범위로 돌아갈 것");
    Row taken = ai("이미 되살아난 것");
    repo.delete(uid, full.id());
    repo.delete(uid, taken.id());
    long fullChange =
        record(
            AiMemoryChangeAction.FORGOTTEN,
            full.id(),
            List.of(MemorySnapshot.of(full)),
            null,
            sid,
            now());
    long takenChange =
        record(
            AiMemoryChangeAction.FORGOTTEN,
            taken.id(),
            List.of(MemorySnapshot.of(taken)),
            null,
            sid,
            now());
    repo.insertWithId(taken.id(), uid, MemorySnapshot.of(taken).toNewMemory()); // 다른 경로로 먼저 되살아남

    // 자리는 남았지만 id 가 이미 쓰임 → CHANGED.
    undo(uid, takenChange)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.code").value("AI_MEMORY_CHANGED"));

    // 범위가 가득(taken 포함 300) → CHANGED, 되살리지 않는다.
    AiMemoryTestFixtures.fill(dsl, uid, null, AiMemoryService.LIMIT - 1);
    undo(uid, fullChange)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.code").value("AI_MEMORY_CHANGED"));
    assertThat(find(full.id())).isEmpty();
  }

  @Test
  void 정리로_생긴_메모리는_cleanedAt_이_있고_사용자가_고치면_사라진다() throws Exception {
    Row cleaned = ai("보고서·요약은 표로 정리한다");
    addedChange(cleaned);
    AiMemoryItem mine = AiMemoryTestFixtures.createMemory(service, uid, "PREFERENCE", "답은 존댓말로 한다");

    String body =
        getAs(uid, BASE).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
    JsonNode items = om.readTree(body).path("items");
    assertThat(itemById(items, cleaned.id()).path("cleanedAt").isTextual()).isTrue();
    assertThat(itemById(items, mine.id()).has("cleanedAt")).isFalse();

    UpdateAiMemoryRequest edit = new UpdateAiMemoryRequest();
    edit.setContent("보고서는 표로, 요약은 글로 정리한다");
    service.update(uid, cleaned.id(), edit, false);

    assertThat(
            service.list(uid).items().stream()
                .filter(i -> i.id() == cleaned.id())
                .findFirst()
                .orElseThrow()
                .cleanedAt())
        .isNull();
  }

  private static JsonNode itemById(JsonNode items, long id) {
    for (JsonNode n : items) if (n.path("id").asLong() == id) return n;
    throw new AssertionError("항목 없음: " + id);
  }

  // 최종 리뷰 13: 정리 기록 되돌리기는 사용자 전용 — AI 대행(Internal) 호출은 고정과 같은 방식으로 403. 목록 읽기는 그대로 허용.
  @Test
  void AI_대행은_정리_기록을_되돌릴_수_없다_403() throws Exception {
    long me = withMembership(uid);
    Row r = ai("WP 배포를 맡고 있다");
    long changeId =
        changeLog.record(
            me,
            UUID.randomUUID(),
            AiMemoryChangeAction.ADDED,
            r.id(),
            List.of(),
            MemorySnapshot.of(r),
            sid,
            "r",
            OffsetDateTime.now(ZoneOffset.UTC));

    internal(me, post(BASE + "/changes/" + changeId + "/undo"))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.errors.code").value("AI_MEMORY_CHANGE_USER_ONLY"));
    assertThat(find(r.id())).isPresent();
    internal(me, get(BASE + "/changes")).andExpect(status().isOk());
    getAs(me, BASE + "/changes")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[0].undoneAt").isEmpty());
  }

  /** ai-agent 처럼 Internal + 대행 헤더로 부른다. 필터가 지운 테스트 스레드 TenantContext 를 되돌린다. */
  private ResultActions internal(
      long user, org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder rb)
      throws Exception {
    try {
      return mvc.perform(
          rb.header("Authorization", "Internal test-token")
              .header("X-On-Behalf-Of", String.valueOf(user)));
    } finally {
      com.workplace.global.tenant.TenantContext.set(1L);
    }
  }
}
