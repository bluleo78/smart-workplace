package com.workplace.issue.workflow.domain;

/** 워크플로우가 예약해 쓰는 결과 key(WP-2158). 여러 곳에서 같은 글자를 쓰므로 한 곳에 모아 순환 의존 없이 함께 참조한다. */
public final class ReservedOutcomes {

  private ReservedOutcomes() {}

  /** 에이전트 노드가 질문 경로로 가는 결과 key. */
  public static final String ASK = "ask";

  /** 질문 노드가 답변을 받고 원래 노드로 돌아가는 결과 key. */
  public static final String ANSWERED = "answered";

  /** 복구 서비스가 운영자 조치로 남기는 결과 key. */
  public static final String RECOVER = "_recover";
}
