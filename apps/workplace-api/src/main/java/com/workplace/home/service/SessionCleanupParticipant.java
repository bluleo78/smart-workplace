package com.workplace.home.service;

import com.workplace.airun.RoundDeadline;
import java.time.Duration;

/**
 * 배경 정리 세션 훅(WP-385 → WP-386 공용 메모리 추출이 구현한다). AiMemoryCleanupScheduler 가 세션마다 개인 정리 ai-agent 호출 뒤
 * {@link #prepare} 를 트랜잭션 밖에서 부르고, 돌려받은 {@link Prepared} 를 개인 정리와 <b>같은 적용 트랜잭션</b>(경계 갱신·사용자 잠금
 * 뒤)에서 적용한다 — 경계와 원자적이라 실패한 회차의 변경이 반쯤 남지 않는다.
 *
 * <p>계약: 메모리 꺼진 사용자·비서 없는 세션·짧은 대화에는 불리지 않는다. prepare 가 {@link
 * com.workplace.home.exception.MemoryCleanupAiException} 을 던지면 그 세션은 경계를 올리지 않고 개인 정리와 같은 실패 규칙(일시
 * 장애는 안 셈, 그 밖에는 3회 뒤 처리 완료)을 따른다. applyInTransaction 은 검증에 걸린 항목을 조용히 버리고 DB 오류를 내지 않는다(오류는 그 세션
 * 회차 전체를 되돌린다). 구현 빈이 없으면 훅은 아무것도 하지 않는다.
 */
public interface SessionCleanupParticipant {

  /** 트랜잭션 밖 준비(마감 없음) — 테스트·잠금 밖 진입점용. {@link #prepare(SessionCleanupInput, SpaceBudget)} 와 같다. */
  default Prepared prepare(SessionCleanupInput input) {
    return prepare(input, SpaceBudget.UNLIMITED);
  }

  /**
   * 트랜잭션 밖 준비 — 모델 호출·임베딩. 할 일이 없으면 {@link Prepared#NONE}. 공간(또는 그에 맞먹는 단위)마다 다음 처리를 시작하기 전에 budget
   * 을 확인해, 최악으로 걸려도 회차 마감 안에 끝나지 않으면 멈춘다(WP-2111) — deferOnOverrun 이면 {@link DeadlineReached} 를 던져
   * 세션을 다음 회차로 미루고, 아니면 준비한 것까지만 돌려주되 {@link Prepared#uptoLimit()} 로 경계를 처리한 데까지만 올리게 해 남은 공간의 발화를
   * 다음 회차가 다시 보게 한다(잃지 않음).
   */
  Prepared prepare(SessionCleanupInput input, SpaceBudget budget);

  /**
   * 처리 단위(공간) 하나를 끝내는 최악 시간(WP-2111 리뷰 후속). 스케줄러가 개인 정리 호출을 시작하기 <b>전에</b> 「정리 읽기 상한 + 이 값」이 회차 마감
   * 안인지 본다 — 정리 호출 뒤 첫 공간에서 마감에 걸려 세션을 미루면, 이미 끝난 정리 호출·임베딩을 버리고 다음 회차에 같은 호출을 되풀이하기 때문이다. 기본은 0(단위
   * 없음). 그 입력에 처리할 단위가 없으면 0 을 돌려줘야 한다 — 일 없는 세션까지 미뤄 회차가 끊기지 않게(WP-2111 리뷰 후속 2).
   */
  default Duration unitWorst(SessionCleanupInput input) {
    return Duration.ZERO;
  }

  /**
   * 공간 단위 마감(WP-2111). deferOnOverrun 은 마감에 걸리면 세션을 통째로 다음 회차로 미룰지 — 회차의 첫 세션(마감까지 시간이 가장 많을 때 시작)은
   * 미뤄도 다음 회차에서 또 걸릴 수 있어 미루지 않고, 처리한 공간까지만 진행한 것으로 기록한다(경계 상한 — 다음 회차가 남은 공간부터 이어 해 회차마다 나아간다).
   */
  record SpaceBudget(RoundDeadline deadline, boolean deferOnOverrun) {
    /** 마감 없음. */
    public static final SpaceBudget UNLIMITED = new SpaceBudget(RoundDeadline.unlimited(), false);
  }

  /** 회차 마감 안에 다음 공간을 끝낼 수 없어 세션을 다음 회차로 미룬다 — 실패로 세지 않는다(경계는 그대로). */
  final class DeadlineReached extends RuntimeException {
    public DeadlineReached(String message) {
      super(message, null, false, false);
    }
  }

  /** 적용 트랜잭션 안에서 실행할 변경. */
  @FunctionalInterface
  interface Prepared {
    /** 할 일 없음. */
    Prepared NONE = () -> {};

    /** 적용 트랜잭션 안(사용자 잠금 뒤) — 검증에 걸린 항목은 버리고 예외를 내지 않는다. */
    void applyInTransaction();

    /**
     * 경계를 올릴 수 있는 최대 메시지 id(WP-2111) — 마감에 걸려 일부만 처리했을 때, 처리하지 못한 첫 발화 바로 앞. null 이면 제한 없음(수집 때의
     * 마지막 메시지까지). 적용은 여러 참여자의 값 중 가장 작은 것까지만 경계를 올린다.
     */
    default Long uptoLimit() {
      return null;
    }

    /** inner 를 적용하되 경계는 uptoLimit 까지만 올리게 하는 준비 결과. */
    static Prepared limitedTo(long uptoLimit, Prepared inner) {
      return new Prepared() {
        @Override
        public void applyInTransaction() {
          inner.applyInTransaction();
        }

        @Override
        public Long uptoLimit() {
          return uptoLimit;
        }
      };
    }
  }
}
