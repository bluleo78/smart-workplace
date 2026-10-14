package com.workplace.home;

import static com.workplace.jooq.Tables.AI_MEMORY;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.workplace.home.dto.AiMemoryItem;
import com.workplace.home.dto.CreateAiMemoryRequest;
import com.workplace.home.repository.AiMemoryRepository.Row;
import com.workplace.home.service.AiMemoryService;
import com.workplace.home.service.HomeSessionService;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;

/**
 * WP-55 메모리 테스트 공용 픽스처 — 설정 화면처럼 USER 로 직접 만든 메모리, 영속 memory 블록(판정 6), 그 블록을 단 ASSISTANT 메시지. 되돌리기
 * 테스트(AiMemoryUndoTest)와 되돌리기 경합 테스트(AiMemoryUndoConcurrencyTest)가 같은 모양을 쓴다.
 */
public final class AiMemoryTestFixtures {

  private static final ObjectMapper OM = new ObjectMapper();

  private AiMemoryTestFixtures() {}

  /** 설정 화면 직접 추가와 같은 경로(브라우저 → 항상 USER)로 메모리를 만든다. */
  public static AiMemoryItem createMemory(
      AiMemoryService service, long userId, String kind, String content) {
    return service.create(
        userId, new CreateAiMemoryRequest(kind, content, null, null, null, null), false);
  }

  /**
   * 본인 메모리 전부(범위·기한 무관, updated_at 최신순·같으면 id 큰 것 먼저) — 테스트 확인용 직접 조회. 저장소에는 범위·기한으로 거른 조회만 있어
   * 만료·다른 범위 행까지 보려면 여기서 읽는다. RLS 가 테넌트를 거르므로 테넌트 트랜잭션 안에서 부른다.
   */
  public static List<Row> allMemories(DSLContext dsl, long userId) {
    return dsl.selectFrom(AI_MEMORY)
        .where(AI_MEMORY.USER_ID.eq(userId))
        .orderBy(AI_MEMORY.UPDATED_AT.desc(), AI_MEMORY.ID.desc())
        .fetch(
            r ->
                new Row(
                    r.getId(),
                    r.getKind(),
                    r.getContent(),
                    r.getSource(),
                    r.getSourceSessionId(),
                    r.getCreatedAt().toInstant(),
                    r.getUpdatedAt().toInstant(),
                    r.getScope(),
                    r.getExpiresOn()));
  }

  /** 본인 메모리 전체 개수(범위·기한 무관) — 테스트 확인용. 테넌트 트랜잭션 안에서 부른다(RLS). */
  public static int countMemories(DSLContext dsl, long userId) {
    return dsl.fetchCount(AI_MEMORY, AI_MEMORY.USER_ID.eq(userId));
  }

  /** 영속 memory 블록 1개 — previous 가 null 이면 previousContent 를 싣지 않는다. */
  public static ObjectNode memoryBlock(
      String action, long memoryId, String kind, String content, String previous, String source) {
    ObjectNode b = OM.createObjectNode();
    b.put("kind", "memory").put("action", action).put("memoryId", memoryId).put("memoryKind", kind);
    b.put("content", content);
    if (previous != null) b.put("previousContent", previous);
    b.put("source", source).put("undone", false);
    return b;
  }

  /**
   * 새 대화에 질문(USER)과 memory 블록을 단 답(ASSISTANT)을 남기고 답의 id 를 돌려준다. 앞에 text 블록을 둬 memory 순번 ≠ 배열 인덱스를
   * 함께 확인한다(판정 4). 테넌트 트랜잭션 안에서 부른다.
   */
  public static long assistantMessageWithMemory(
      HomeSessionService sessions, long userId, ObjectNode... memoryBlocks) {
    UUID sid = sessions.create(userId).id();
    sessions.appendMessage(userId, sid, "USER", "질문", null, null, null);
    ArrayNode arr = OM.createArrayNode();
    arr.addObject().put("kind", "text").put("textStart", 0);
    for (ObjectNode b : memoryBlocks) arr.add(b);
    return sessions.appendMessage(userId, sid, "ASSISTANT", "기억할게요.", null, null, arr.toString());
  }
}
