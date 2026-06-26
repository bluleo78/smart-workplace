package com.workplace.mail.outbound;

/**
 * 메일 도메인 이벤트. ApplicationEventPublisher 로 발행되어 AFTER_COMMIT 단계에서 dispatcher 가 받는다.
 *
 * <p>계정 연결(IMAP create / M365 OAuth connect) 두 경로가 동일 이벤트를 발행하므로, 단일 AFTER_COMMIT 핸들러가 두 경로의 즉시
 * 동기화를 담당한다.
 */
public final class MailDomainEvents {
  private MailDomainEvents() {}

  /**
   * 메일 계정 연결 직후(신규 등록 또는 M365 전환). 첫 동기화를 3분 주기 스케줄러까지 기다리지 않고 즉시 1회 트리거하기 위한 신호다. 신규 계정 행이 커밋된 뒤에만
   * sync 가 그 행을 볼 수 있으므로 반드시 AFTER_COMMIT 에서 소비한다.
   */
  public record MailAccountConnectedEvent(long userId, long accountId) {}
}
