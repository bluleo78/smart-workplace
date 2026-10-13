package com.workplace.home.controller;

import static com.workplace.jooq.Tables.HOME_MESSAGE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.workplace.home.dto.AiMemoryItem;
import com.workplace.home.repository.AiMemoryRepository;
import com.workplace.home.service.AiMemoryService;
import com.workplace.home.service.HomeSessionService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.user.service.AiPreferenceService;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
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

  /** 영속 memory 블록(판정 6). */
  private ObjectNode block(
      String action, long memoryId, String kind, String content, String previous, String source) {
    ObjectNode b = om.createObjectNode();
    b.put("kind", "memory").put("action", action).put("memoryId", memoryId).put("memoryKind", kind);
    b.put("content", content);
    if (previous != null) b.put("previousContent", previous);
    b.put("source", source).put("undone", false);
    return b;
  }

  /** 사용자 세션에 ASSISTANT 메시지를 만든다 — 앞에 text 블록을 둬 memory 순번 ≠ 배열 인덱스를 함께 확인한다. */
  private long message(long uid, ObjectNode... memoryBlocks) throws Exception {
    UUID sid = sessions.create(uid).id();
    sessions.appendMessage(uid, sid, "USER", "질문", null, null, null);
    ArrayNode arr = om.createArrayNode();
    arr.addObject().put("kind", "text").put("textStart", 0);
    for (ObjectNode b : memoryBlocks) arr.add(b);
    return sessions.appendMessage(
        uid, sid, "ASSISTANT", "기억할게요.", null, null, om.writeValueAsString(arr));
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
    AiMemoryItem m = memories.create(uid, "PREFERENCE", "짧은 목록");
    long mid = message(uid, block("saved", m.id(), "PREFERENCE", "짧은 목록", null, "AI"));

    undo(uid, mid, 0)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.messageId").value(mid))
        .andExpect(jsonPath("$.blockIndex").value(0))
        .andExpect(jsonPath("$.undone").value(true))
        .andExpect(jsonPath("$.memory").doesNotExist());
    assertThat(repo.find(uid, m.id())).isEmpty();
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
    AiMemoryItem m = memories.create(uid, "PREFERENCE", "표 대신 목록");
    long mid = message(uid, block("updated", m.id(), "PREFERENCE", "표 대신 목록", "짧은 목록", "AI"));

    undo(uid, mid, 0)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.memory.id").value(m.id()))
        .andExpect(jsonPath("$.memory.content").value("짧은 목록"));
    assertThat(repo.find(uid, m.id()).orElseThrow().content()).isEqualTo("짧은 목록");
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
    AiMemoryItem m = memories.create(uid, "PREFERENCE", "짧은 목록");
    preferences.update(uid, null, false);
    long mid = message(uid, block("saved", m.id(), "PREFERENCE", "짧은 목록", null, "AI"));

    undo(uid, mid, 0).andExpect(status().isOk());
    assertThat(repo.find(uid, m.id())).isEmpty();
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
    AiMemoryItem m = memories.create(uid, "PREFERENCE", "표 대신 목록");
    preferences.update(uid, null, false);
    long mid = message(uid, block("updated", m.id(), "PREFERENCE", "표 대신 목록", "짧은 목록", "AI"));

    undo(uid, mid, 0).andExpect(status().isOk());
    assertThat(repo.find(uid, m.id()).orElseThrow().content()).isEqualTo("짧은 목록");
  }

  /** 판정 15: 고침 되돌리기는 내용만 되돌린다 — 그 사이 바뀐 종류(블록엔 이전 종류가 없다)는 지금 값으로 남는다. */
  @Test
  void 고침_되돌리기는_내용만_되돌리고_지금_종류를_유지한다() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    AiMemoryItem m = memories.create(uid, "PREFERENCE", "짧은 목록");
    memories.update(uid, m.id(), "백엔드 팀이다", "CONTEXT");
    long mid = message(uid, block("updated", m.id(), "CONTEXT", "백엔드 팀이다", "짧은 목록", "AI"));

    undo(uid, mid, 0)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.memory.content").value("짧은 목록"))
        .andExpect(jsonPath("$.memory.kind").value("CONTEXT"));
    AiMemoryRepository.Row row = repo.find(uid, m.id()).orElseThrow();
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
    AiMemoryItem a = memories.create(uid, "PREFERENCE", "첫째");
    AiMemoryItem b = memories.create(uid, "PREFERENCE", "둘째");
    long mid =
        message(
            uid,
            block("saved", a.id(), "PREFERENCE", "첫째", null, "AI"),
            block("saved", b.id(), "PREFERENCE", "둘째", null, "AI"));

    undo(uid, mid, 1).andExpect(status().isOk());
    assertThat(repo.find(uid, b.id())).isEmpty();
    assertThat(repo.find(uid, a.id())).isPresent();
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
}
