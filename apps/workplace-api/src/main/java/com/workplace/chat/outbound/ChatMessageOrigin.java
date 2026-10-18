package com.workplace.chat.outbound;

/**
 * 이슈 채팅 글이 만들어진 경로(WP-452). ChatMessageCreatedEvent 에 실어 소비자(알림 등)가 화면 글·AI 진행 보고·AI 질문을 구분하게 한다.
 * question 필드(질문 강조)와 별개로 "보고 경로의 일반 진행 글"까지 구분하려고 둔다 — 진행 보고는 멘션이 있어도 알림을 만들지 않는다.
 */
public enum ChatMessageOrigin {
  /** 화면·일반 API 로 쓴 글(사람 글, AI 채팅 답글 포함). */
  USER,
  /** AI 작업 보고(report_agent_work)의 일반 진행 글. */
  REPORT,
  /** AI 작업 보고의 답변 필요 질문 글. */
  REPORT_QUESTION;

  /** 질문(답변 필요) 글인지. */
  public boolean question() {
    return this == REPORT_QUESTION;
  }

  /** 보고 경로의 글인지 — 사람이 작성자여도 "사람의 답"으로 치지 않는다. */
  public boolean fromReport() {
    return this != USER;
  }
}
