package com.workplace.agentruntime.dto;

/** 관리자가 정한 AI 의 원하는 상태(WP-1247) — runner 가 이 값에 맞춰 띄우거나 내린다. DB 에는 이름 문자열로 저장한다. */
public enum Desired {
  /** 켜 둔다. */
  RUN,
  /** 꺼 둔다. */
  STOP
}
