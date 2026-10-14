package com.workplace.home.controller;

import static com.workplace.jooq.Tables.HOME_MESSAGE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.workplace.home.AiMemoryTestFixtures;
import com.workplace.home.dto.AiMemoryItem;
import com.workplace.home.dto.UpdateAiMemoryRequest;
import com.workplace.home.repository.AiMemoryRepository;
import com.workplace.home.service.AiMemoryService;
import com.workplace.home.service.HomeSessionService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.user.service.AiPreferenceService;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;

/** WP-55 §6: 채팅 결과 줄 되돌리기 — 반대 동작 3종, 멱등, 이미 지워짐, 상한, 꺼짐 허용, 남의 메시지 404, 순번 규칙(판정 4). */
@Transactional
class AiMemoryUndoTest extends IntegrationTestBase {

  private static final String UNDO = "/api/v1/users/me/ai-memories/undo";

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired ObjectMapper om;
  @Autowired AiMemoryService memories;
  @Autowired AiMemoryRepository repo;
  @Autowired HomeSessionService sessions;
  @Autowired AiPreferenceService preferences;

  private ResultActions undo(long uid, Object messageId, Object blockIndex) throws Exception {
    Map<String, Object> body = new java.util.HashMap<>();
    if (messageId != null) body.put("messageId", messageId);
    if (blockIndex != null) body.put("blockIndex", blockIndex);
    return mvc.perform(
        post(UNDO)
            .with(authentication(new UsernamePasswordAuthenticationToken(uid, "n/a", List.of())))
            .contentType(MediaType.APPLICATION_JSON)
            .content(om.writeValueAsString(body)));
  }

  /** 영속 memory 블록(판정 6) — 공용 픽스처. */
  private static ObjectNode block(
      String action, long memoryId, String kind, String content, String previous, String source) {
    return AiMemoryTestFixtures.memoryBlock(action, memoryId, kind, content, previous, source);
  }

  /** 사용자 세션에 memory 블록을 단 ASSISTANT 메시지를 만든다(앞에 text 블록 — 순번 ≠ 배열 인덱스, 공용 픽스처). */
  private long message(long uid, ObjectNode... memoryBlocks) {
    return AiMemoryTestFixtures.assistantMessageWithMemory(sessions, uid, memoryBlocks);
  }

  /** 설정 화면 직접 추가와 같은 경로로 메모리를 만든다. */
  private AiMemoryItem create(long uid, String kind, String content) {
    return AiMemoryTestFixtures.createMemory(memories, uid, kind, content);
  }

  /** 본인 메모리 1건(없으면 empty). */
  private Optional<AiMemoryRepository.Row> find(long uid, long id) {
    return repo.listNewest(uid, 500).stream().filter(r -> r.id() == id).findFirst();
  }

  /** 메시지의 memory 블록들(순번 순). */
  private List<JsonNode> memoryBlocks(long messageId) throws Exception {
    String json =
        dsl.select(HOME_MESSAGE.CONTENT_BLOCKS)
            .from(HOME_MESSAGE)
            .where(HOME_MESSAGE.ID.eq(messageId))
            .fetchOne()
            .value1()
            .data();
    List<JsonNode> out = new ArrayList<>();
    for (JsonNode b : om.readTree(json)) if ("memory".equals(b.path("kind").asText())) out.add(b);
    return out;
  }

  @Test
  void 저장_되돌리기는_그_메모리를_지우고_블록을_되돌림으로_남긴다() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    AiMemoryItem m = create(uid, "PREFERENCE", "짧은 목록");
    long mid = message(uid, block("saved", m.id(), "PREFERENCE", "짧은 목록", null, "AI"));

    undo(uid, mid, 0)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.messageId").value(mid))
        .andExpect(jsonPath("$.blockIndex").value(0))
        .andExpect(jsonPath("$.undone").value(true))
        .andExpect(jsonPath("$.memory").doesNotExist());
    assertThat(find(uid, m.id())).isEmpty();
    assertThat(memoryBlocks(mid).get(0).path("undone").asBoolean()).isTrue();
  }

  @Test
  void 저장_되돌리기는_이미_지워졌어도_성공한다() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    long mid = message(uid, block("saved", 987654L, "PREFERENCE", "짧은 목록", null, "AI"));
    undo(uid, mid, 0).andExpect(status().isOk()).andExpect(jsonPath("$.undone").value(true));
  }

  @Test
  void 고침_되돌리기는_이전_내용으로_복원한다() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    AiMemoryItem m = create(uid, "PREFERENCE", "표 대신 목록");
    long mid = message(uid, block("updated", m.id(), "PREFERENCE", "표 대신 목록", "짧은 목록", "AI"));

    undo(uid, mid, 0)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.memory.id").value(m.id()))
        .andExpect(jsonPath("$.memory.content").value("짧은 목록"));
    assertThat(find(uid, m.id()).orElseThrow().content()).isEqualTo("짧은 목록");
  }

  @Test
  void 고침_대상이_이미_없으면_404_GONE_이고_블록은_그대로다() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    long mid = message(uid, block("updated", 987654L, "PREFERENCE", "표 대신 목록", "짧은 목록", "AI"));

    undo(uid, mid, 0)
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.errors.code").value("AI_MEMORY_GONE"));
    assertThat(memoryBlocks(mid).get(0).path("undone").asBoolean()).isFalse();
  }

  @Test
  void 지움_되돌리기는_같은_종류_내용_출처로_다시_만든다() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    long mid = message(uid, block("forgotten", 987654L, "CONTEXT", "백엔드 팀이다", null, "AI"));

    undo(uid, mid, 0)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.memory.kind").value("CONTEXT"))
        .andExpect(jsonPath("$.memory.content").value("백엔드 팀이다"))
        .andExpect(jsonPath("$.memory.source").value("AI"));
    assertThat(repo.count(uid)).isEqualTo(1);
  }

  @Test
  void 지움_되돌리기가_상한이면_409_FULL_이고_블록은_그대로다() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    for (int i = 0; i < 50; i++) repo.insert(uid, "PREFERENCE", "m" + i, "USER", null);
    long mid = message(uid, block("forgotten", 987654L, "CONTEXT", "백엔드 팀이다", null, "USER"));

    undo(uid, mid, 0)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.code").value("AI_MEMORY_FULL"));
    assertThat(memoryBlocks(mid).get(0).path("undone").asBoolean()).isFalse();
    assertThat(repo.count(uid)).isEqualTo(50);
  }

  /** Review Focus 1(순차): 두 번 눌러도 메모리는 한 번만 다시 생긴다. */
  @Test
  void 두_번_눌러도_한_번만() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    long mid = message(uid, block("forgotten", 987654L, "CONTEXT", "백엔드 팀이다", null, "AI"));

    undo(uid, mid, 0).andExpect(status().isOk()).andExpect(jsonPath("$.memory.content").exists());
    undo(uid, mid, 0)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.undone").value(true))
        .andExpect(jsonPath("$.memory").doesNotExist());
    assertThat(repo.count(uid)).isEqualTo(1);
  }

  @Test
  void 메모리를_꺼도_되돌리기는_허용한다() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    AiMemoryItem m = create(uid, "PREFERENCE", "짧은 목록");
    preferences.update(uid, null, false);
    long mid = message(uid, block("saved", m.id(), "PREFERENCE", "짧은 목록", null, "AI"));

    undo(uid, mid, 0).andExpect(status().isOk());
    assertThat(find(uid, m.id())).isEmpty();
  }

  /** 꺼짐은 AI 대행 쓰기만 막는다 — 지움 되돌리기(재생성)도 허용하고 블록의 출처로 다시 만든다. */
  @Test
  void 메모리를_꺼도_지움_되돌리기는_허용한다() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    preferences.update(uid, null, false);
    long mid = message(uid, block("forgotten", 987654L, "CONTEXT", "백엔드 팀이다", null, "AI"));

    undo(uid, mid, 0)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.memory.content").value("백엔드 팀이다"))
        .andExpect(jsonPath("$.memory.source").value("AI"));
    assertThat(repo.count(uid)).isEqualTo(1);
    assertThat(memoryBlocks(mid).get(0).path("undone").asBoolean()).isTrue();
  }

  /** 꺼짐에서도 고침 되돌리기(이전 내용 복원)는 허용한다. */
  @Test
  void 메모리를_꺼도_고침_되돌리기는_허용한다() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    AiMemoryItem m = create(uid, "PREFERENCE", "표 대신 목록");
    preferences.update(uid, null, false);
    long mid = message(uid, block("updated", m.id(), "PREFERENCE", "표 대신 목록", "짧은 목록", "AI"));

    undo(uid, mid, 0).andExpect(status().isOk());
    assertThat(find(uid, m.id()).orElseThrow().content()).isEqualTo("짧은 목록");
  }

  /**
   * 판정 15(수정): 이전 종류(previousKind)를 싣기 전에 영속된 줄은 내용만 되돌린다 — 이전 종류를 모르므로 고친 뒤 종류가 지금 값으로 남는다(하위 호환).
   */
  @Test
  void 이전_종류가_없는_고침_줄은_내용만_되돌리고_지금_종류를_유지한다() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    AiMemoryItem m = create(uid, "PREFERENCE", "짧은 목록");
    memories.update(uid, m.id(), "백엔드 팀이다", "CONTEXT", false);
    long mid = message(uid, block("updated", m.id(), "CONTEXT", "백엔드 팀이다", "짧은 목록", "AI"));

    undo(uid, mid, 0)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.memory.content").value("짧은 목록"))
        .andExpect(jsonPath("$.memory.kind").value("CONTEXT"));
    AiMemoryRepository.Row row = find(uid, m.id()).orElseThrow();
    assertThat(row.content()).isEqualTo("짧은 목록");
    assertThat(row.kind()).isEqualTo("CONTEXT");
  }

  @Test
  void 남의_메시지_없는_id_사용자_메시지는_404() throws Exception {
    long owner = TestFixtures.createHuman(dsl);
    long other = TestFixtures.createHuman(dsl);
    long mid = message(owner, block("forgotten", 987654L, "CONTEXT", "백엔드 팀이다", null, "AI"));

    undo(other, mid, 0)
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.errors.code").value("AI_MEMORY_NOT_FOUND"));
    undo(owner, 999_999_999L, 0).andExpect(status().isNotFound());
    UUID sid = sessions.create(owner).id();
    long userMsg = sessions.appendMessage(owner, sid, "USER", "질문", null, null, null);
    undo(owner, userMsg, 0).andExpect(status().isNotFound());
    assertThat(memoryBlocks(mid).get(0).path("undone").asBoolean()).isFalse();
  }

  /** 판정 4: blockIndex 는 memory 블록 중 순번 — 앞의 text 블록을 세지 않는다. 범위 밖·음수·누락은 400. */
  @Test
  void blockIndex_는_memory_블록_순번이다() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    AiMemoryItem a = create(uid, "PREFERENCE", "첫째");
    AiMemoryItem b = create(uid, "PREFERENCE", "둘째");
    long mid =
        message(
            uid,
            block("saved", a.id(), "PREFERENCE", "첫째", null, "AI"),
            block("saved", b.id(), "PREFERENCE", "둘째", null, "AI"));

    undo(uid, mid, 1).andExpect(status().isOk());
    assertThat(find(uid, b.id())).isEmpty();
    assertThat(find(uid, a.id())).isPresent();
    assertThat(memoryBlocks(mid))
        .extracting(n -> n.path("undone").asBoolean())
        .containsExactly(false, true);

    for (Object bad : new Object[] {2, -1}) {
      undo(uid, mid, bad)
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.errors.code").value("AI_MEMORY_INVALID"));
    }
    undo(uid, null, 0).andExpect(status().isBadRequest());
    undo(uid, mid, null).andExpect(status().isBadRequest());
  }

  /** 판정 15(수정): 이전 종류가 기록된 고침 줄은 내용과 종류를 함께 되돌린다(AI 가 종류까지 바꾼 고침). */
  @Test
  void 고침_되돌리기는_이전_종류가_있으면_종류도_돌려놓는다() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    AiMemoryItem m = create(uid, "PREFERENCE", "짧은 목록");
    memories.update(uid, m.id(), "백엔드 팀이다", "CONTEXT", false);
    long mid =
        message(
            uid,
            block("updated", m.id(), "CONTEXT", "백엔드 팀이다", "짧은 목록", "AI")
                .put("previousKind", "PREFERENCE"));

    undo(uid, mid, 0)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.memory.content").value("짧은 목록"))
        .andExpect(jsonPath("$.memory.kind").value("PREFERENCE"));
    AiMemoryRepository.Row row = find(uid, m.id()).orElseThrow();
    assertThat(row.content()).isEqualTo("짧은 목록");
    assertThat(row.kind()).isEqualTo("PREFERENCE");
  }

  /** CR4: 고친 뒤 다시 바뀐 메모리(설정에서 또 고침)는 되돌리지 않는다 — 409 CHANGED, 내용·블록 그대로. */
  @Test
  void 고친_뒤_또_바뀐_메모리는_409_CHANGED_이고_덮지_않는다() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    AiMemoryItem m = create(uid, "PREFERENCE", "표 대신 목록");
    long mid = message(uid, block("updated", m.id(), "PREFERENCE", "표 대신 목록", "짧은 목록", "AI"));
    memories.update(uid, m.id(), "사용자가 나중에 고친 내용", null, false);

    undo(uid, mid, 0)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.code").value("AI_MEMORY_CHANGED"));
    assertThat(find(uid, m.id()).orElseThrow().content()).isEqualTo("사용자가 나중에 고친 내용");
    assertThat(memoryBlocks(mid).get(0).path("undone").asBoolean()).isFalse();
  }

  /** CR4: 이전 종류가 기록된 줄은 종류만 다시 바뀐 경우도 바뀐 것으로 본다. */
  @Test
  void 이전_종류가_있는_줄은_종류만_또_바뀌어도_409_CHANGED() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    AiMemoryItem m = create(uid, "CONTEXT", "백엔드 팀이다");
    long mid =
        message(
            uid,
            block("updated", m.id(), "CONTEXT", "백엔드 팀이다", "짧은 목록", "AI")
                .put("previousKind", "PREFERENCE"));
    memories.update(uid, m.id(), null, "PREFERENCE", false);

    undo(uid, mid, 0)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.code").value("AI_MEMORY_CHANGED"));
    AiMemoryRepository.Row row = find(uid, m.id()).orElseThrow();
    assertThat(row.content()).isEqualTo("백엔드 팀이다");
    assertThat(row.kind()).isEqualTo("PREFERENCE");
    assertThat(memoryBlocks(mid).get(0).path("undone").asBoolean()).isFalse();
  }

  /**
   * CR2: 지움 되돌리기는 원래 id 로 되살린다 — 그래야 앞선 저장 줄의 되돌리기가 되살린 메모리를 지운다(새 id 면 "이미 없음"으로 끝나고 메모리가 남았다).
   */
  @Test
  void 지움_되돌리기는_원래_id_로_되살려_앞선_저장_되돌리기가_그것을_지운다() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    AiMemoryItem m = create(uid, "PREFERENCE", "짧은 목록");
    memories.delete(uid, m.id(), false);
    long mid =
        message(
            uid,
            block("saved", m.id(), "PREFERENCE", "짧은 목록", null, "AI"),
            block("forgotten", m.id(), "PREFERENCE", "짧은 목록", null, "AI"));

    undo(uid, mid, 1).andExpect(status().isOk()).andExpect(jsonPath("$.memory.id").value(m.id()));
    assertThat(find(uid, m.id())).isPresent();

    undo(uid, mid, 0).andExpect(status().isOk());
    assertThat(find(uid, m.id())).isEmpty();
    assertThat(repo.count(uid)).isZero();
  }

  /** CR2: 원래 id 가 이미 쓰이고 있으면(같은 메모리를 다른 줄로 이미 되살림) 새 id 로 되살린다 — 키 충돌로 실패하지 않는다. */
  @Test
  void 원래_id_가_이미_있으면_새_id_로_되살린다() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    AiMemoryItem m = create(uid, "PREFERENCE", "짧은 목록");
    long mid = message(uid, block("forgotten", m.id(), "PREFERENCE", "짧은 목록", null, "AI"));

    undo(uid, mid, 0)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.memory.content").value("짧은 목록"));
    assertThat(repo.count(uid)).isEqualTo(2);
    assertThat(find(uid, m.id())).isPresent();
  }

  /** CR2: 시퀀스가 아직 발급하지 않은 id 는 쓰지 않는다 — 나중에 일반 저장이 그 값에서 키 충돌하지 않게 새 id 로 만든다. */
  @Test
  void 발급되지_않은_id_는_쓰지_않고_새_id_로_되살린다() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    long unissued =
        dsl.resultQuery("SELECT last_value FROM ai_memory_id_seq").fetchOne(0, Long.class)
            + 1_000_000L;
    long mid = message(uid, block("forgotten", unissued, "CONTEXT", "백엔드 팀이다", null, "AI"));

    undo(uid, mid, 0).andExpect(status().isOk());
    assertThat(find(uid, unissued)).isEmpty();
    assertThat(repo.count(uid)).isEqualTo(1);
  }

  /** 범위만 옮기는 고치기 요청(서비스 직접 호출용). */
  private static UpdateAiMemoryRequest moveTo(String scope) {
    UpdateAiMemoryRequest r = new UpdateAiMemoryRequest();
    r.setScope(scope);
    return r;
  }

  /** WP-379: 고침 되돌리기는 이전 범위로 옮긴다 — 이전 범위가 그 사이 가득 찼으면 409 FULL(+범위)이고 블록은 그대로다. */
  @Test
  void 고침_되돌리기는_이전_범위로_옮기고_이전_범위가_가득이면_409() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    AiMemoryItem m = create(uid, "PREFERENCE", "목록은 짧게");
    memories.update(uid, m.id(), moveTo("ISSUE"), false);
    // AI 가 공통 → 이슈로 옮긴 줄(previousScope 없음 = 공통).
    long mid =
        message(
            uid,
            block("updated", m.id(), "PREFERENCE", "목록은 짧게", "목록은 짧게", "AI").put("scope", "ISSUE"));
    undo(uid, mid, 0)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.memory.scope").value(nullValue()));
    assertThat(find(uid, m.id()).orElseThrow().scope()).isNull();

    long uid2 = TestFixtures.createHuman(dsl);
    AiMemoryItem m2 = create(uid2, "PREFERENCE", "목록은 짧게");
    memories.update(uid2, m2.id(), moveTo("ISSUE"), false);
    for (int i = 0; i < 50; i++) repo.insert(uid2, "PREFERENCE", "c" + i, "USER", null, null);
    long mid2 =
        message(
            uid2,
            block("updated", m2.id(), "PREFERENCE", "목록은 짧게", "목록은 짧게", "AI")
                .put("scope", "ISSUE"));
    undo(uid2, mid2, 0)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.code").value("AI_MEMORY_FULL"))
        .andExpect(jsonPath("$.errors.scope").value("COMMON"));
    assertThat(memoryBlocks(mid2).get(0).path("undone").asBoolean()).isFalse();
    assertThat(find(uid2, m2.id()).orElseThrow().scope()).isEqualTo("ISSUE");
  }

  /** WP-379: 지움 되돌리기는 같은 범위로 다시 만든다 — 그 범위가 가득이면 409 FULL + 그 범위. */
  @Test
  void 지움_되돌리기는_같은_범위로_다시_만들고_가득이면_409_와_범위() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    long mid =
        message(
            uid,
            block("forgotten", 987654L, "PREFERENCE", "메일은 존댓말로", null, "AI").put("scope", "MAIL"));
    undo(uid, mid, 0)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.memory.scope").value("MAIL"));

    long uid2 = TestFixtures.createHuman(dsl);
    for (int i = 0; i < 50; i++) repo.insert(uid2, "PREFERENCE", "m" + i, "USER", null, "MAIL");
    long mid2 =
        message(
            uid2,
            block("forgotten", 987655L, "PREFERENCE", "메일은 존댓말로", null, "AI").put("scope", "MAIL"));
    undo(uid2, mid2, 0)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.code").value("AI_MEMORY_FULL"))
        .andExpect(jsonPath("$.errors.scope").value("MAIL"));
  }

  /**
   * Review Focus 3: WP-55 때 영속된 줄(scope 필드 없음)은 공통으로 해석한다 — 지움 줄은 공통으로 재생성, 고침 줄은 지금 공통이면 복원하고 그 뒤
   * 다른 범위로 옮겼으면 덮지 않는다(판정 6, 409 CHANGED).
   */
  @Test
  void 범위_필드가_없는_구_블록은_공통으로_해석한다() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    long forgotten = message(uid, block("forgotten", 987656L, "CONTEXT", "백엔드 팀이다", null, "AI"));
    undo(uid, forgotten, 0)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.memory.scope").value(nullValue()));

    AiMemoryItem a = create(uid, "PREFERENCE", "표 대신 목록");
    long updated = message(uid, block("updated", a.id(), "PREFERENCE", "표 대신 목록", "짧은 목록", "AI"));
    undo(uid, updated, 0)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.memory.content").value("짧은 목록"))
        .andExpect(jsonPath("$.memory.scope").value(nullValue()));

    AiMemoryItem b = create(uid, "PREFERENCE", "목록은 담당자만");
    memories.update(uid, b.id(), moveTo("ISSUE"), false);
    long moved = message(uid, block("updated", b.id(), "PREFERENCE", "목록은 담당자만", "목록은 짧게", "AI"));
    undo(uid, moved, 0)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.code").value("AI_MEMORY_CHANGED"));
    assertThat(find(uid, b.id()).orElseThrow().scope()).isEqualTo("ISSUE");
    assertThat(find(uid, b.id()).orElseThrow().content()).isEqualTo("목록은 담당자만");
  }
}
