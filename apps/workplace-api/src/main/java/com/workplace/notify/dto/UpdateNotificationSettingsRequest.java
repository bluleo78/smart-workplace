package com.workplace.notify.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.util.List;
import java.util.Map;

/**
 * 알림 설정 부분 수정 — 바뀐 앱 스위치와 바뀐 칸만 보낸다. {@code apps}·{@code cells} 는 각각 생략(null) 가능하며 생략하면 그쪽은 바꾸지
 * 않는다. 앱 스위치 값이 null 이면 언박싱 대신 Bean Validation 이 400 으로 거절한다. 모르는 앱·항목·행위자 이름은 역직렬화 단계에서 400.
 */
public record UpdateNotificationSettingsRequest(
    Map<NotificationApp, @NotNull Boolean> apps, @Valid List<@NotNull CellChange> cells) {

  /** 칸 하나의 새 값. 그 항목에 없는 행위자 열이면 서비스가 400 으로 거절한다. */
  public record CellChange(
      @NotNull NotificationSettingItem item,
      @NotNull NotificationActor actor,
      @NotNull Boolean enabled) {}
}
