package com.workplace.agentruntime.dto;

/**
 * 바뀐 실행 설정을 언제 적용할지(WP-1247). generation 과 함께 저장되며, runner 에게 줄 지시(쉴 때 다시 띄우기·바로 다시 띄우기)는 웨이브 B 가 이
 * 값으로 계산한다.
 */
public enum ApplyMode {
  /** AI 가 하던 일을 마치고 쉴 때 적용. */
  IDLE,
  /** 지금 바로 적용(하던 일이 끊길 수 있음). */
  NOW
}
