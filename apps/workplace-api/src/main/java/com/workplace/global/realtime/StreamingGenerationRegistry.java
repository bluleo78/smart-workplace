package com.workplace.global.realtime;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
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

  /** 생성 분류 태그(WP-190) — scope 는 도메인(예: "home"), key 는 그 안의 대상(예: 홈 채팅 sessionId). */
  record GenerationTag(String scope, String key) {}

  /** 진행 중인 태그 생성 1건 — 새로고침·재연결 뒤 웹이 "생성 중" 상태를 복원하는 원천. */
  record ActiveGeneration(String correlationId, String key, Instant startedAt) {}

  /** 취소 사유 — 사용자 명시 취소와 서버 타임아웃을 구분해 웹에 알린다. */
  enum CancelReason {
    USER,
    TIMEOUT
  }

  /** reserve 로 잡은 실행 슬롯. correlationId 는 예약 시점에 발급돼 이벤트 봉투에 바로 실을 수 있다. */
  interface Reservation {
    String correlationId();

    /** 취소됐다면 그 사유, 아니면 null — 태스크가 종결 이벤트(cancelled reason)를 고를 때 읽는다. */
    CancelReason cancelReason();

    /**
     * 슬롯을 반납한다(멱등). 태스크는 종결 이벤트를 내보내기 <b>전에</b> 직접 호출한다 — 이벤트를 받은 클라이언트가 곧바로 같은 대상으로 다시 요청해도 BUSY 로
     * 막히지 않게. 래퍼의 finally 반납은 안전망이다.
     */
    void release();
  }

  /**
   * 태그 생성 슬롯을 원자적으로 예약한다(확인 + 등록). 같은 (소유자, scope, key) 가 진행 중이면 BUSY, 소유자의 같은 scope 진행 수가 상한 이상이면
   * LIMIT 으로 {@link com.workplace.global.exception.StreamingGenerationRejectedException} 을 던진다. 예약
   * 후 실패하면 호출자가 {@link Reservation#release()} 해야 한다.
   */
  default Reservation reserve(long ownerUserId, GenerationTag tag, int perUserLimit) {
    return reserve(ownerUserId, tag, perUserLimit, null);
  }

  /**
   * {@link #reserve(long, GenerationTag, int)} 와 같되 correlationId 를 호출자가 정한다(WP-267) — 웹이 요청 전에 id
   * 를 알아 응답보다 먼저 온 이벤트도 바로 라우팅하게. null 이면 새로 발급한다. 이미 진행 중인 생성과 겹치면(소유자 무관) BUSY 로 거절한다 — 남의 생성 핸들을
   * 덮지 않게.
   */
  Reservation reserve(
      long ownerUserId, GenerationTag tag, int perUserLimit, String requestedCorrelationId);

  /**
   * 예약한 슬롯으로 태스크를 제출하고 타임아웃을 건다. executor 가 거절하면 슬롯을 반납하고 예외를 그대로 던진다.
   *
   * @param onAbortedBeforeStart 태스크가 실행되기 전에(큐 대기 중) 취소·타임아웃되면 슬롯 반납 직후 호출된다 — 태스크가 돌지 않아도 종결 이벤트를
   *     내보내 클라이언트가 "생성 중" 에 갇히지 않게 한다. 취소한 스레드(요청·타임아웃 스케줄러)에서 실행된다.
   */
  void launch(
      Reservation reservation,
      AsyncTaskExecutor executor,
      Duration timeout,
      Runnable task,
      Runnable onAbortedBeforeStart);

  /** 소유자의 scope 별 진행 중 태그 생성(시작 시각 오름차순). */
  List<ActiveGeneration> active(long ownerUserId, String scope);
}
