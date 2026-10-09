package com.workplace.wiki.dto;

import com.workplace.wiki.dto.WikiRevisionItem.Person;
import java.time.OffsetDateTime;
import java.util.List;

/** 버전 기록 단건(WP-297) — 목록 항목과 같은 필드에 본문을 더한다(읽기 전용 미리보기·비교용). */
public record WikiRevisionDetail(
    int version,
    String title,
    String body,
    OffsetDateTime editedAt,
    OffsetDateTime createdAt,
    RevisionReason reason,
    List<Person> editors,
    Person aiActor) {

  /** 목록 항목에 본문을 더한 단건 — 목록·단건이 같은 매핑을 쓰게 한다. */
  public static WikiRevisionDetail of(WikiRevisionItem item, String body) {
    return new WikiRevisionDetail(
        item.version(),
        item.title(),
        body,
        item.editedAt(),
        item.createdAt(),
        item.reason(),
        item.editors(),
        item.aiActor());
  }
}
