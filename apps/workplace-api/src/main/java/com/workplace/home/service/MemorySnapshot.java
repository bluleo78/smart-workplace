package com.workplace.home.service;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.workplace.home.repository.AiMemoryRepository.NewMemory;
import com.workplace.home.repository.AiMemoryRepository.Row;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Objects;

/**
 * 정리 기록의 before/after 스냅숏(WP-385 스펙 3) — 원래 id·내용·종류·범위·기한(yyyy-MM-dd)·출처·고정·사용 시각.
 * ai_memory_change.before(배열)· after 에 JSON 으로 남고 기록 API 응답에도 그대로 실린다.
 *
 * <p>{@link #sameAs} 는 "결과가 그대로인가"의 유일한 술어다 — 되돌리기(바뀌었으면 409)와 설정 목록의 「AI가 정리」 표시가 같은 판정을 쓴다(시각 비교는
 * 앱 시계·DB 시계가 달라 쓰지 않는다).
 */
public record MemorySnapshot(
    long id,
    String content,
    String kind,
    String scope,
    String expiresOn,
    String source,
    boolean pinned,
    Instant lastUsedAt) {

  /** 저장 행 → 스냅숏. */
  public static MemorySnapshot of(Row r) {
    return new MemorySnapshot(
        r.id(),
        r.content(),
        r.kind(),
        r.scope(),
        r.expiresOn() == null ? null : r.expiresOn().toString(),
        r.source(),
        r.pinned(),
        r.lastUsedAt());
  }

  /** 지금 행이 이 스냅숏과 "그대로"인가 — 같은 id 이고 내용·종류·범위·기한이 같다(고정·사용 시각·수정 시각은 보지 않는다). 행이 없으면 false. */
  public boolean sameAs(Row current) {
    return current != null
        && current.id() == id
        && sameContent(current, content, kind, scope, expiresOnDate());
  }

  /**
   * 행의 내용·종류·범위·기한이 주어진 값과 같은가 — {@link #sameAs} 의 값 비교 부분. 배경 정리가 "결과가 지금 행과 그대로인 고침"을 가를 때도 같은
   * 술어를 쓴다(스냅숏을 만들지 않고).
   */
  public static boolean sameContent(
      Row r, String content, String kind, String scope, LocalDate expiresOn) {
    return content.equals(r.content())
        && kind.equals(r.kind())
        && Objects.equals(scope, r.scope())
        && Objects.equals(expiresOn, r.expiresOn());
  }

  /** 기한 날짜(없으면 null). */
  @JsonIgnore
  public LocalDate expiresOnDate() {
    return expiresOn == null ? null : LocalDate.parse(expiresOn);
  }

  /** 같은 값으로 다시 만들 저장 요청(출처 대화 없음 — 고정은 늘 꺼진 채, 사용 시각은 지금). */
  @JsonIgnore
  public NewMemory toNewMemory() {
    return new NewMemory(kind, content, source, null, scope, expiresOnDate());
  }
}
