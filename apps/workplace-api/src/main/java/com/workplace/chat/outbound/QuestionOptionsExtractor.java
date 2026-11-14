package com.workplace.chat.outbound;

import java.util.List;

/**
 * AI 질문 글에서 답 선택지 후보를 뽑는 포트(WP-1569). chat 모듈이 인터페이스를 소유하고, 비서 해석(auth)·ai-agent 추천 호출(home)에 이미
 * 기대는 home 모듈이 구현한다 — chat 이 auth·home 을 직접 import 하지 않게(IssueChatPoster 와 같은 포트 방식, 방향만 반대).
 *
 * <p>구현은 스스로 짧은 트랜잭션으로 비서를 해석하고 ai-agent HTTP 는 트랜잭션 밖에서 부른다 — 호출자는 트랜잭션 없이(테넌트 문맥만 세운 실행기 스레드에서)
 * 부른다.
 */
public interface QuestionOptionsExtractor {

  /**
   * projectKey 프로젝트에 연결된 비서로 질문 글에서 답 선택지 후보를 뽑아 그대로(정리 전) 돌려준다. 연결된 비서가 없거나 뽑을 선택지가 없으면 빈 목록.
   * ai-agent 실패·시간 초과는 예외로 올린다(호출자가 삼킨다).
   */
  List<String> extract(String projectKey, String question);
}
