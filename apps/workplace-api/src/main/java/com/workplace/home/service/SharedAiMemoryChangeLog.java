package com.workplace.home.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.home.repository.SharedAiMemoryChangeRepository;
import com.workplace.home.repository.SharedAiMemoryChangeRepository.NewChange;
import com.workplace.home.service.SharedSpace.SpaceKey;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 공간 기록 쓰기·읽기(WP-386) — 스냅숏 JSON 직렬화를 한 곳에. 행위자 id 가 null 이면 AI(actor_kind=AI) — 배경 추출·정리는 발화자를 남기지
 * 않으므로 늘 null 로 부른다. 시각은 키셋 커서에 맞춰 밀리초로 자른다. 호출자 트랜잭션 안에서 부른다.
 */
@Component
@RequiredArgsConstructor
public class SharedAiMemoryChangeLog {

  public static final String ADDED = "ADDED";
  public static final String UPDATED = "UPDATED";
  public static final String DELETED = "DELETED";
  public static final String MERGED = "MERGED";
  public static final String RESTORED = "RESTORED";
  public static final String ACTOR_USER = "USER";
  public static final String ACTOR_AI = "AI";

  private static final TypeReference<List<SharedMemorySnapshot>> SNAPSHOTS =
      new TypeReference<>() {};

  private final SharedAiMemoryChangeRepository repo;
  private final ObjectMapper objectMapper;

  /** 기록 한 줄 — before 는 바뀌기 전(ADDED 면 빈 목록), after 는 바뀐 뒤(지움이면 null). 새 기록 id. */
  public long record(
      SpaceKey space,
      UUID runId,
      String action,
      Long actorUserId,
      long memoryId,
      List<SharedMemorySnapshot> before,
      SharedMemorySnapshot after,
      OffsetDateTime at) {
    return repo.insert(
        new NewChange(
            space,
            runId,
            action,
            actorUserId,
            actorUserId == null ? ACTOR_AI : ACTOR_USER,
            memoryId,
            write(before),
            after == null ? null : write(after),
            at.truncatedTo(ChronoUnit.MILLIS)));
  }

  /** before JSON → 스냅숏 목록. */
  public List<SharedMemorySnapshot> readBefore(String json) {
    try {
      return json == null ? List.of() : objectMapper.readValue(json, SNAPSHOTS);
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("공용 메모리 기록 before 를 읽지 못했어요", e);
    }
  }

  /** after JSON → 스냅숏(null 이면 null). */
  public SharedMemorySnapshot readAfter(String json) {
    try {
      return json == null ? null : objectMapper.readValue(json, SharedMemorySnapshot.class);
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("공용 메모리 기록 after 를 읽지 못했어요", e);
    }
  }

  private String write(Object value) {
    try {
      return objectMapper.writeValueAsString(value);
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("공용 메모리 기록 직렬화 실패", e);
    }
  }
}
