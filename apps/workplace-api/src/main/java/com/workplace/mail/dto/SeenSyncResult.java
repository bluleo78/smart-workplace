package com.workplace.mail.dto;

import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

/** WP-187 역동기화 결과 — 서버 반영이 끝난 메일 id, 그리고 429·장애로 이후 처리를 멈춰야 하는지. */
public record SeenSyncResult(Set<Long> succeeded, boolean stopped) {

  /** 반영할 방법이 없어(로컬 행·비밀번호 없음 등) 모두 끝난 것으로 볼 때. */
  public static SeenSyncResult all(List<SeenSyncItem> items) {
    return new SeenSyncResult(
        items.stream().map(SeenSyncItem::messageId).collect(Collectors.toSet()), false);
  }
}
