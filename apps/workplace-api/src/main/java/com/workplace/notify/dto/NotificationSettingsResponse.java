package com.workplace.notify.dto;

import java.util.List;

/**
 * 알림 설정 전체 — 앱(화면 섹션) 순서대로, 앱 안은 항목(줄) 순서대로. 칸 값은 사용자가 저장한 값 또는 기본값이며 앱 스위치를 반영하지 않은 원래 값이다(앱을 꺼도 칸
 * 값은 보존되고 화면이 흐리게만 보여 준다).
 */
public record NotificationSettingsResponse(List<AppSettings> apps) {

  /** 앱 하나 — 앱 전체 스위치({@code enabled})와 그 앱의 줄들. */
  public record AppSettings(NotificationApp app, boolean enabled, List<ItemSettings> items) {}

  /** 줄 하나. 칸이 없는 쪽은 {@code null}(JSON {@code null}) — 화면에 「–」. */
  public record ItemSettings(NotificationSettingItem item, Boolean human, Boolean agent) {}
}
