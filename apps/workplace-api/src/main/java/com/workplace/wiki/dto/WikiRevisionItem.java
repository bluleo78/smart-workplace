package com.workplace.wiki.dto;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * 버전 기록 목록의 한 판(WP-297). editedAt = 그 판의 본문이 마지막으로 바뀐 시각(표시용), createdAt = 스냅샷 적재 시각. reason 은
 * {@link RevisionReason} 이름 또는 null(WP-297 이전 행). aiActor 는 AI 적용 직전 스냅샷일 때 적용을 요청한 사용자(✦ 귀속), 아니면
 * null.
 */
public record WikiRevisionItem(
    int version,
    String title,
    OffsetDateTime editedAt,
    OffsetDateTime createdAt,
    RevisionReason reason,
    List<Person> editors,
    Person aiActor) {

  /** 표시용 사용자 — id 와 이름. */
  public record Person(long id, String name) {}
}
