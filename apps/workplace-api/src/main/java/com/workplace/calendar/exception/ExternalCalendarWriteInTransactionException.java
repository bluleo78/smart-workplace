package com.workplace.calendar.exception;

/**
 * 호출자(AI·채팅 등)의 ambient 트랜잭션이 열린 상태에서 외부 동기화(M365) 캘린더로 일정 쓰기를 시도한 경우 — 409.
 *
 * <p>외부 쓰기는 Graph HTTP 를 트랜잭션 밖에서 호출해야 한다("HTTP 는 어떤 tx 안에서도 금지", #232 커넥션 점유 방지). REST 경로는
 * 비-@Transactional 이라 안전하지만, ConfirmActionDispatcher ← HomeActionService.confirm /
 * MessagingProposalService.confirmWithBody 의 @Transactional 컨텍스트에서 진입하면 오케스트레이터의 REQUIRED
 * txTemplate 이 호출자 tx 에 합류해 Graph HTTP 가 tx 안에서 실행된다. 가드로 진입을 차단하고, 정식 수정(confirm
 * 서비스의 @Transactional 범위 축소)은 후속 #548 에서 다룬다.
 */
public class ExternalCalendarWriteInTransactionException extends RuntimeException {
  public ExternalCalendarWriteInTransactionException() {
    super("AI·채팅 등 트랜잭션 컨텍스트에서 M365 동기화 캘린더로의 일정 쓰기는 아직 지원되지 않습니다 (#548).");
  }
}
