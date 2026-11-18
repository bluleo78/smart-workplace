package com.workplace.calendar.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.workplace.wiki.dto.WikiPageCard;
import java.time.OffsetDateTime;

/**
 * 일정(회차)에 이어진 노트 카드(WP-1701). 읽을 수 있는 노트면 제목·공간·고친 사람·고친 때를 싣고, 읽을 수 없으면 {@code restricted=true}
 * 하나만 싣는다 — 볼 수 없는 노트의 존재·id·제목을 드러내지 않는다(NON_NULL 이라 null 칸은 JSON 에서 빠진다).
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record EventNoteRef(
    boolean restricted,
    Long pageId,
    String title,
    Long spaceId,
    String spaceName,
    String updatedByName,
    OffsetDateTime updatedAt) {

  /** 읽을 수 없는 노트 — restricted 만 싣는다. */
  public static EventNoteRef restrictedRef() {
    return new EventNoteRef(true, null, null, null, null, null, null);
  }

  /** 읽을 수 있는 노트의 카드. */
  public static EventNoteRef of(WikiPageCard c) {
    return new EventNoteRef(
        false, c.id(), c.title(), c.spaceId(), c.spaceName(), c.updatedByName(), c.updatedAt());
  }
}
