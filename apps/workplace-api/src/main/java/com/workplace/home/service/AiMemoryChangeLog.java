package com.workplace.home.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.ai.MemoryTextNormalizer;
import com.workplace.home.repository.AiMemoryChangeRepository;
import com.workplace.home.repository.AiMemoryChangeRepository.NewChange;
import com.workplace.home.repository.AiMemoryRepository.Owned;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 정리 기록 쓰기·읽기(WP-385) — 스냅숏을 JSON 으로 바꿔 ai_memory_change 에 남기고, 되돌리기·목록이 다시 스냅숏으로 읽는다. 사유는 DB
 * 상한(200 코드포인트)으로 자르고, 시각은 키셋 커서에 맞춰 밀리초로 자른다. 호출자 트랜잭션 안에서 부른다.
 */
@Component
@RequiredArgsConstructor
public class AiMemoryChangeLog {

  /** 사유 최대 길이(코드포인트) — DB reason VARCHAR(200). */
  static final int REASON_MAX = 200;

  private static final TypeReference<List<MemorySnapshot>> SNAPSHOTS = new TypeReference<>() {};

  private final AiMemoryChangeRepository repo;
  private final ObjectMapper objectMapper;

  /** 기록 1건 — before 는 바뀌기 전(ADDED 면 빈 목록), after 는 바뀐 뒤(지움이면 null). 새 기록 id. */
  public long record(
      long userId,
      UUID runId,
      AiMemoryChangeAction action,
      long memoryId,
      List<MemorySnapshot> before,
      MemorySnapshot after,
      UUID sessionId,
      String reason,
      OffsetDateTime at) {
    return repo.insert(
        toNew(userId, runId, action, memoryId, before, after, sessionId, reason, at));
  }

  /** 감쇠 삭제 기록 여러 건(대화·사유 없음) — 다건 INSERT 한 번. runIds 는 사용자 id → 그 사용자의 run_id. */
  public void recordDecayed(List<Owned> gone, Map<Long, UUID> runIds, OffsetDateTime at) {
    repo.insertAll(
        gone.stream()
            .map(
                o ->
                    toNew(
                        o.userId(),
                        runIds.get(o.userId()),
                        AiMemoryChangeAction.DECAYED,
                        o.row().id(),
                        List.of(MemorySnapshot.of(o.row())),
                        null,
                        null,
                        null,
                        at))
            .toList());
  }

  /** 저장할 기록 — 스냅숏을 JSON 으로, 사유는 200 코드포인트로, 시각은 밀리초로 자른다(키셋 커서). */
  private NewChange toNew(
      long userId,
      UUID runId,
      AiMemoryChangeAction action,
      long memoryId,
      List<MemorySnapshot> before,
      MemorySnapshot after,
      UUID sessionId,
      String reason,
      OffsetDateTime at) {
    return new NewChange(
        userId,
        runId,
        action.name(),
        memoryId,
        write(before),
        after == null ? null : write(after),
        sessionId,
        clip(reason),
        at.truncatedTo(ChronoUnit.MILLIS));
  }

  /** before JSON → 스냅숏 목록. */
  public List<MemorySnapshot> readBefore(String json) {
    try {
      return objectMapper.readValue(json, SNAPSHOTS);
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("정리 기록 before 를 읽지 못했어요", e);
    }
  }

  /** after JSON → 스냅숏(null 이면 null). */
  public MemorySnapshot readAfter(String json) {
    if (json == null) return null;
    try {
      return objectMapper.readValue(json, MemorySnapshot.class);
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("정리 기록 after 를 읽지 못했어요", e);
    }
  }

  /** 사유를 200 코드포인트로(빈 값은 null). 제어 문자(NUL 등)는 지운다 — DB 가 NUL 을 받지 않아 적용 트랜잭션 전체가 깨지지 않게. */
  static String clip(String reason) {
    if (reason == null) return null;
    String r = MemoryTextNormalizer.stripControl(reason).strip();
    return r.isEmpty() ? null : MemoryTextNormalizer.headCodePoints(r, REASON_MAX);
  }

  private String write(Object value) {
    try {
      return objectMapper.writeValueAsString(value);
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("정리 기록 직렬화 실패", e);
    }
  }
}
