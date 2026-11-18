package com.workplace.mail.dto;

import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * WP-187 역동기화 결과 — 서버 반영이 끝난 메일 id, 그리고 429·장애로 이후 처리를 멈춰야 하는지.
 *
 * @param flagLocalOnly WP-1741 succeeded 중 별표를 서버에 보낼 수 없어(메일함이 \Flagged 를 영구 저장하지 못함) 앱 안에만 둔 메일
 *     id. 디스패처는 이 메일의 별표 대기를 풀지 않고 「보류」해 — 재시도도 하지 않고, 동기화가 서버 값(별표 없음)으로 로컬 별표를 지우지도 않게 한다
 */
public record SeenSyncResult(Set<Long> succeeded, boolean stopped, Set<Long> flagLocalOnly) {

  /** 별표 보류 없는 결과(기존 호출부 호환). */
  public SeenSyncResult(Set<Long> succeeded, boolean stopped) {
    this(succeeded, stopped, Set.of());
  }

  /** 반영할 방법이 없어(로컬 행·비밀번호 없음 등) 모두 끝난 것으로 볼 때. */
  public static SeenSyncResult all(List<SeenSyncItem> items) {
    return all(items, Set.of());
  }

  /** WP-1741 모두 끝났고 그중 flagLocalOnly 의 별표는 앱 안에만 둔(서버에 보내지 못한) 결과. */
  public static SeenSyncResult all(List<SeenSyncItem> items, Set<Long> flagLocalOnly) {
    return new SeenSyncResult(
        items.stream().map(SeenSyncItem::messageId).collect(Collectors.toSet()),
        false,
        flagLocalOnly);
  }
}
