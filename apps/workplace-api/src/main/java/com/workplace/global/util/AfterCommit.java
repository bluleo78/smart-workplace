package com.workplace.global.util;

import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * 할 일을 현재 트랜잭션의 커밋 뒤로 미룬다(WP-751).
 *
 * <p>SSE 디스패처는 수신자 조회처럼 DB 가 필요한 일은 커밋 전(BEFORE_COMMIT — 요청 트랜잭션의 커넥션과 GUC 를 그대로 쓴다)에 끝내고, 커밋된 변경만
 * 알리도록 전송만 여기로 미룬다. 커밋 뒤에 수신자를 다시 조회하려고 REQUIRES_NEW 로 두 번째 커넥션을 빌리면, 요청 커넥션은 커밋 콜백이 끝날 때까지 반납되지
 * 않으므로 풀 크기만큼의 쓰기가 동시에 커밋될 때 모두가 서로를 기다리며 멈춘다.
 *
 * <p>미룬 일은 DB 를 쓰지 않아야 한다 — 커밋 콜백 안의 DB 접근이 바로 그 두 번째 커넥션을 부른다. 트랜잭션 동기화가 꺼져 있으면(트랜잭션 밖 호출) 곧바로
 * 실행한다. 롤백되면 실행하지 않는다.
 */
public final class AfterCommit {

  /**
   * 커밋 콜백 안에서 실행 중임 표지(WP-1973 리뷰 5) — {@link #run} 의 afterCommit 안에서 다시 발행이 들어오면 이미 커밋됐으므로 그 자리에서
   * 보내야, afterCompletion 으로 밀려 다른 발행보다 늦게(혹은 먼저) 나가는 일이 없다(WP-874 순서).
   */
  private static final ThreadLocal<Boolean> IN_COMMIT_CALLBACK = new ThreadLocal<>();

  private AfterCommit() {}

  /** 커밋 콜백(afterCommit) 안에서 실행 중인지 — 발행 구현이 이 값을 보고 미루지 않고 바로 보내는지 정한다. 콜백 밖에서는 언제나 false. */
  public static boolean inCommitCallback() {
    return Boolean.TRUE.equals(IN_COMMIT_CALLBACK.get());
  }

  /** 커밋 뒤에 {@code task} 를 실행한다. 트랜잭션 밖이면 즉시 실행한다. */
  public static void run(Runnable task) {
    if (!TransactionSynchronizationManager.isSynchronizationActive()) {
      task.run();
      return;
    }
    TransactionSynchronizationManager.registerSynchronization(
        new TransactionSynchronization() {
          @Override
          public void afterCommit() {
            Boolean previous = IN_COMMIT_CALLBACK.get();
            IN_COMMIT_CALLBACK.set(true);
            try {
              task.run();
            } finally {
              // 표지를 지우지 않고 이전 값으로 복원한다 — afterCommit 안에서 다시 afterCommit 이 돌면(중첩)
              // 바깥 표지를 지워, 그 뒤의 발행이 afterCompletion 으로 밀려 순서(WP-874)가 깨진다(WP-1973 리뷰).
              if (previous == null) IN_COMMIT_CALLBACK.remove();
              else IN_COMMIT_CALLBACK.set(previous);
            }
          }
        });
  }
}
