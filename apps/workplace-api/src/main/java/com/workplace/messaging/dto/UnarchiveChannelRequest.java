package com.workplace.messaging.dto;

import com.workplace.global.util.SingleLineTitles;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * 채널 보관 해제 요청(WP-1084) — 본문은 선택이다. {@code name} 을 주면 그 이름으로 바꾸며 해제한다. 같은 이름의 공개 채널이 새로 생겨 그대로는 해제할
 * 수 없을 때 웹이 새 이름을 받아 보낸다. 없으면 이름을 그대로 둔다.
 */
public record UnarchiveChannelRequest(
    @Size(max = 80) @Pattern(regexp = "(?s).*\\S.*", message = "채널 이름을 입력해 주세요") String name) {
  public UnarchiveChannelRequest {
    // 이름 변경(RenameChannelRequest)과 같이 한 줄로 다듬는다 — 다듬어 비면 위 검증이 한국어로 거절한다.
    name = name == null ? null : SingleLineTitles.normalize(name);
  }
}
