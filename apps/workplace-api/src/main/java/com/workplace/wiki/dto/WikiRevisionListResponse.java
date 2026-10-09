package com.workplace.wiki.dto;

import com.workplace.wiki.dto.WikiRevisionItem.Person;
import java.time.OffsetDateTime;
import java.util.List;

/** 버전 기록 목록 응답(WP-297). current = 아직 스냅샷되지 않은 현재 판(목록 맨 위 "현재 버전" 행), items = 저장된 판 최신순(최대 200). */
public record WikiRevisionListResponse(Current current, List<WikiRevisionItem> items) {

  /**
   * 현재 판 — editedAt 은 마지막 본문 변경 시각(body_changed_at, 없으면 updated_at), editors 는 마지막 스냅샷 이후 편집자(없으면
   * 직전 수정자).
   */
  public record Current(int version, OffsetDateTime editedAt, List<Person> editors) {}
}
