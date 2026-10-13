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
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 채팅 결과 줄 되돌리기(WP-55 §6). 메시지를 행 잠금으로 읽고 → memory 블록(순번)의 반대 동작 → 같은 트랜잭션에서 그 블록 undone=true. 반대
 * 동작이 실패(GONE·FULL)하면 트랜잭션이 롤백돼 블록도 그대로다. 꺼짐이어도 허용(사용자가 직접 하는 정리).
 */
@Service
@RequiredArgsConstructor
public class AiMemoryUndoService {

  private final HomeMessageRepository messageRepo;
  private final AiMemoryService memoryService;
  private final ObjectMapper objectMapper;

  /**
   * 되돌리기.
   *
   * @throws AiMemoryException 404 NOT_FOUND(남의·없는·USER 메시지), 400 INVALID(순번 밖·필드 누락), 404 GONE, 409
   *     FULL
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
   * 반대 동작. saved → 지움(이미 없으면 그대로), updated → 이전 내용으로(없으면 GONE), forgotten → 같은 종류·내용·출처로 재생성(상한이면
   * FULL). saved 는 그 사이 사용자가 고쳤어도 같은 항목이므로 지운다(스펙 §6).
   */
  private AiMemoryItem reverse(long userId, ObjectNode b) {
    long memoryId = b.path("memoryId").asLong();
    return switch (b.path("action").asText()) {
      case "saved" -> {
        memoryService.deleteIfExists(userId, memoryId);
        yield null;
      }
      case "updated" ->
          memoryService.restoreContent(userId, memoryId, requiredText(b, "previousContent"));
      case "forgotten" ->
          memoryService.restore(
              userId,
              requiredText(b, "memoryKind"),
              requiredText(b, "content"),
              b.path("source").asText("AI"));
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
