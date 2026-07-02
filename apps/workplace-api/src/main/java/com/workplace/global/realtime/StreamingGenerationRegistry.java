package com.workplace.global.realtime;

import java.time.Duration;
import java.util.function.Function;
import org.springframework.core.task.AsyncTaskExecutor;

/**
 * AI 생성(Drive Overview·Wiki AI·Home Chat 등) 스트리밍 태스크의 생명주기(발급·실행·타임아웃·취소)를 관리한다.
 *
 * <p>도메인 서비스는 correlationId 발급, 백그라운드 제출, 타임아웃 처리, 소유자 검증을 매번 반복 구현하지 않고 이 컴포넌트에 위임한다(#593 편입). 실제
 * 이벤트 발행(SseRegistry.fanOut)은 도메인 서비스가 taskFactory 클로저 안에서 직접 수행한다 — 이 레지스트리는 이벤트 이름/payload 형태를 알지
 * 못한다.
 */
public interface StreamingGenerationRegistry {

  /**
   * 새 생성을 시작한다. correlationId 를 먼저 발급해 taskFactory 에 넘기고(클로저로 이벤트 payload 에 실을 수 있게), 반환된 Runnable
   * 을 지정 executor 에 제출한 뒤 correlationId 를 즉시 반환한다.
   *
   * @param ownerUserId 취소 시 소유자 검증에 쓰이는 시작자 userId
   * @param executor 태스크를 실행할 전용 executor(도메인별로 분리 유지)
   * @param timeout 이 시간이 지나도 완료되지 않으면 강제 취소
   * @param taskFactory 발급된 correlationId 를 받아 실제 실행할 Runnable 을 만드는 함수
   * @return 발급된 correlationId
   */
  String start(
      long ownerUserId,
      AsyncTaskExecutor executor,
      Duration timeout,
      Function<String, Runnable> taskFactory);

  /**
   * 진행 중인 생성을 취소한다. 소유자가 다르면 {@link StreamingGenerationForbiddenException}, 존재하지 않으면(이미
   * 완료/타임아웃/오탈자) {@link StreamingGenerationNotFoundException} 을 던진다.
   */
  void cancel(String correlationId, long callerId);
}
