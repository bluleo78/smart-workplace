package com.workplace.agentaccount.usage;

/** 사용량 측정 창 — 5시간 창과 주간(7일) 창. DB window_key 값과 1:1 이다. */
public enum UsageWindow {
  FIVE_HOUR("5h"),
  WEEKLY("7d");

  private final String key;

  UsageWindow(String key) {
    this.key = key;
  }

  /** DB 에 저장되는 창 키('5h'·'7d'). */
  public String key() {
    return key;
  }

  /** 저장된 키로 창을 찾는다. 알 수 없는 키면 IllegalArgumentException. */
  public static UsageWindow fromKey(String key) {
    for (UsageWindow w : values()) {
      if (w.key.equals(key)) return w;
    }
    throw new IllegalArgumentException("알 수 없는 사용량 창: " + key);
  }
}
