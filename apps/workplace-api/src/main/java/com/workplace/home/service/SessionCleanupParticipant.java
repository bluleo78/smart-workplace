package com.workplace.home.service;

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

  /** 트랜잭션 밖 준비 — 모델 호출·임베딩. 할 일이 없으면 {@link Prepared#NONE}. */
  Prepared prepare(SessionCleanupInput input);

  /** 적용 트랜잭션 안에서 실행할 변경. */
  @FunctionalInterface
  interface Prepared {
    /** 할 일 없음. */
    Prepared NONE = () -> {};

    /** 적용 트랜잭션 안(사용자 잠금 뒤) — 검증에 걸린 항목은 버리고 예외를 내지 않는다. */
    void applyInTransaction();
  }
}
