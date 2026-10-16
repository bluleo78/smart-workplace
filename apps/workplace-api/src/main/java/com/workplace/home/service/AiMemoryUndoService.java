package com.workplace.home.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.workplace.home.dto.AiMemoryItem;
import com.workplace.home.dto.UndoAiMemoryRequest;
import com.workplace.home.dto.UndoAiMemoryResponse;
import com.workplace.home.exception.AiMemoryException;
import com.workplace.home.repository.HomeMessageRepository;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 채팅 결과 줄 되돌리기(WP-55 §6). 메시지를 행 잠금으로 읽고 → memory 블록(순번)의 반대 동작 → 같은 트랜잭션에서 그 블록 undone=true. 반대
 * 동작이 실패(GONE·FULL·CHANGED)하면 트랜잭션이 롤백돼 블록도 그대로다. 꺼짐이어도 허용(사용자가 직접 하는 정리). WP-386 shared 블록은 공간 기록
 * 되돌리기(SharedAiMemoryChangeService)로 넘긴다.
 */
@Service
@RequiredArgsConstructor
public class AiMemoryUndoService {

  private final HomeMessageRepository messageRepo;
  private final AiMemoryService memoryService;
  private final AiMemoryForgottenService forgotten;
  private final SharedAiMemoryChangeService sharedChanges;
  private final ObjectMapper objectMapper;

  /**
   * 되돌리기.
   *
   * @throws AiMemoryException 404 NOT_FOUND(남의·없는·USER 메시지), 400 INVALID(순번 밖·필드 누락), 404 GONE, 409
   *     FULL, 409 CHANGED(고친 뒤 또 바뀜)
   */
  @Transactional
  public UndoAiMemoryResponse undo(long userId, UndoAiMemoryRequest req) {
    if (req == null
        || req.messageId() == null
        || req.blockIndex() == null
        || req.blockIndex() < 0) {
      throw AiMemoryException.invalid("messageId 와 0 이상의 blockIndex 가 필요해요");
    }
    long messageId = req.messageId();
    int blockIndex = req.blockIndex();
    HomeMessageRepository.OwnedBlocks owned =
        messageRepo.lockOwnedAssistant(messageId, userId).orElseThrow(AiMemoryException::notFound);
    ArrayNode blocks = readBlocks(owned.contentBlocksJson());
    ObjectNode target = memoryBlockAt(blocks, blockIndex);
    if (target == null) throw AiMemoryException.invalid("되돌릴 메모리 결과가 아니에요");
    // 멱등 — 이미 되돌린 줄이면 아무것도 바꾸지 않는다(두 번 눌러도 한 번).
    if (target.path("undone").asBoolean(false)) {
      return new UndoAiMemoryResponse(messageId, blockIndex, true, null);
    }
    AiMemoryItem memory = reverse(userId, target);
    target.put("undone", true);
    messageRepo.updateContentBlocks(messageId, write(blocks));
    return new UndoAiMemoryResponse(messageId, blockIndex, true, memory);
  }

  /**
   * 반대 동작. saved → 지움(이미 없으면 그대로), updated → 이전 내용·종류(기록돼 있으면)·범위·기한으로(없으면 GONE, 그 뒤에 또 바뀌었으면
   * CHANGED, 이전 범위가 가득이면 FULL), forgotten → 같은 id·종류·내용·출처·범위·기한으로 재생성(상한이면 FULL — id 를 유지해야 앞선 줄의
   * 되돌리기가 같은 메모리를 가리킨다). 범위·기한 필드가 없는 구 블록은 공통·기한 없음이다(WP-379·380). saved 는 그 사이 사용자가 고쳤어도 같은 항목이므로
   * 지운다. WP-385: updated 를 되돌리면 사용자가 거절한 새 내용을 지운 기록에 남긴다 — 30분 뒤 같은 대화를 다시 읽는 배경 정리가 같은 고침을 다시 하지
   * 못하게(saved 는 deleteIfExists 가 남긴다).
   */
  private AiMemoryItem reverse(long userId, ObjectNode b) {
    long memoryId = b.path("memoryId").asLong();
    return switch (b.path("action").asText()) {
      case "saved" -> {
        memoryService.deleteIfExists(userId, memoryId);
        yield null;
      }
      case "updated" -> {
        String rejected = requiredText(b, "content");
        AiMemoryItem restored =
            memoryService.restoreContent(
                userId,
                memoryId,
                new AiMemoryService.Snapshot(
                    rejected,
                    requiredText(b, "memoryKind"),
                    textOrNull(b, "scope"),
                    textOrNull(b, "expiresOn")),
                new AiMemoryService.Snapshot(
                    requiredText(b, "previousContent"),
                    textOrNull(b, "previousKind"),
                    textOrNull(b, "previousScope"),
                    textOrNull(b, "previousExpiresOn")));
        // 내용이 실제로 바뀐 고침만 — 범위·기한만 바꾼 고침의 "새 내용"은 지금 내용 그대로라 넣으면 그 메모리 자체를 막는다(정규화 비교).
        forgotten.rejectReplaced(userId, List.of(restored.content()), rejected);
        yield restored;
      }
      case "forgotten" ->
          memoryService.restore(
              userId,
              memoryId,
              requiredText(b, "memoryKind"),
              requiredText(b, "content"),
              b.path("source").asText("AI"),
              textOrNull(b, "scope"),
              textOrNull(b, "expiresOn"));
      // WP-386: 공용 메모리 요청 결과 줄 — 그 공간 기록을 요청자 권한으로 되돌린다(공간 잠금·409 규칙은 기록 되돌리기와 같다).
      // 실패(403·409 CHANGED)는 그대로 던져 이 트랜잭션이 롤백되고 블록도 그대로다. 기록이 이미 되돌려졌으면(기록 보기에서 먼저 되돌린 경우)
      // undoLocked 가 기록 행 잠금 아래에서 ALREADY_UNDONE 으로 알리므로 줄만 되돌림으로 맞춘다 — 눌러도 늘 실패하는 버튼을 남기지 않는다.
      // 호출자 트랜잭션에 그대로 합류한다(TransactionTemplate 을 거치지 않아 예외로 바깥이 rollback-only 가 되지 않는다).
      case "shared" -> {
        sharedChanges.undoLocked(userId, b.path("changeId").asLong());
        yield null;
      }
      default -> throw AiMemoryException.invalid("되돌릴 수 없는 메모리 결과예요");
    };
  }

  /** blockIndex 번째 memory 블록(판정 4 — 다른 블록은 세지 않는다). 없으면 null. */
  private static ObjectNode memoryBlockAt(ArrayNode blocks, int blockIndex) {
    int ordinal = 0;
    for (JsonNode b : blocks) {
      if (!"memory".equals(b.path("kind").asText())) continue;
      if (ordinal++ == blockIndex) return b instanceof ObjectNode o ? o : null;
    }
    return null;
  }

  private static String requiredText(ObjectNode b, String field) {
    JsonNode v = b.path(field);
    if (!v.isTextual()) throw AiMemoryException.invalid("되돌릴 메모리 결과가 손상됐어요");
    return v.asText();
  }

  /** 문자열 필드(없거나 문자열이 아니면 null — 구 블록의 scope·previousKind). */
  private static String textOrNull(ObjectNode b, String field) {
    JsonNode v = b.path(field);
    return v.isTextual() ? v.asText() : null;
  }

  private ArrayNode readBlocks(String json) {
    if (json == null) return objectMapper.createArrayNode();
    try {
      JsonNode n = objectMapper.readTree(json);
      return n instanceof ArrayNode a ? a : objectMapper.createArrayNode();
    } catch (JsonProcessingException e) {
      throw AiMemoryException.invalid("되돌릴 메모리 결과를 읽지 못했어요");
    }
  }

  private String write(ArrayNode blocks) {
    try {
      return objectMapper.writeValueAsString(blocks);
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("content_blocks 직렬화 실패", e);
    }
  }
}
