package com.workplace.mail.service.trash;

import com.workplace.mail.dto.MailTrashEmptyStatus;
import com.workplace.mail.exception.MailTrashException;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.function.UnaryOperator;
import org.springframework.stereotype.Component;

/**
 * 휴지통 비우기 진행 상태(WP-1682) — 인메모리, 계정 id 키. 계정당 작업은 하나뿐이라 RUNNING 이면 새로 시작하지 않고(다시 눌러도 같은 작업을 보인다),
 * 끝난 상태(DONE·FAILED)는 다음 시작 때까지 남겨 웹이 결과를 읽게 한다. 재시작·롤링 배포로 사라지면 IDLE 을 돌려주고 웹이 「중단됨」으로 알린다(spec 방안
 * A — 지금 api 는 한 인스턴스).
 *
 * <p>요청 스레드(시작·조회)와 작업 스레드(진행 반영)가 함께 만지므로 모든 메서드를 이 객체로 동기화한다. 바꿀 때마다 불변 레코드를 새로 넣어 조회가 늘 일관된 한
 * 장면을 본다. 갱신은 묶음마다 한 번이라 잦지 않다.
 */
@Component
public class MailTrashEmptyProgress {

  private static final String RUNNING = "RUNNING";

  private final Map<Long, MailTrashEmptyStatus> states = new HashMap<>();

  /** 작업을 시작 상태(RUNNING, 수 0)로 둔다. 이미 RUNNING 이면 아무것도 바꾸지 않고 false. 끝난 상태는 새 작업으로 덮는다. */
  public synchronized boolean tryStart(long accountId) {
    if (isRunning(states.get(accountId))) {
      return false;
    }
    states.put(
        accountId, new MailTrashEmptyStatus(RUNNING, null, 0, 0, Instant.now(), null, null, null));
    return true;
  }

  /** 시작 때 센 서버 휴지통 메일 수를 적는다. */
  public synchronized void setTotal(long accountId, int total) {
    update(accountId, s -> s.withTotal(total));
  }

  /** 지운(또는 이미 없던) 메일 수를 더한다. */
  public synchronized void addDeleted(long accountId, int n) {
    update(accountId, s -> s.plusDeleted(n));
  }

  /** 지우지 못한 메일 수를 더한다. */
  public synchronized void addFailed(long accountId, int n) {
    update(accountId, s -> s.plusFailed(n));
  }

  /** 끝까지 돌았다 — DONE + 끝난 시각(failed 는 그대로). */
  public synchronized void finish(long accountId) {
    update(accountId, s -> s.done(Instant.now()));
  }

  /**
   * 중간에 멈췄다 — FAILED + 사유 코드와 그 화면 문구({@link MailTrashException#messageOf}). total 을 알면 아직 처리하지 않은
   * 메일을 실패로 더해 {@code deleted + failed = total} 을 맞춘다(웹이 「n통은 지우지 못했습니다」를 바로 보일 수 있게).
   */
  public synchronized void fail(long accountId, String code) {
    String message = MailTrashException.messageOf(code);
    update(accountId, s -> s.stopped(Instant.now(), code, message));
  }

  /** 실행기가 작업을 거절했다 — 시작하지 않은 것으로 되돌린다(IDLE). */
  public synchronized void release(long accountId) {
    states.remove(accountId);
  }

  /** 지금 상태. 기록이 없으면 IDLE(나머지 0·null). */
  public synchronized MailTrashEmptyStatus snapshot(long accountId) {
    return states.getOrDefault(accountId, MailTrashEmptyStatus.IDLE);
  }

  /** RUNNING 인 작업만 바꾼다 — 끝난 뒤 늦게 온 반영이 결과를 흔들지 않게. */
  private void update(long accountId, UnaryOperator<MailTrashEmptyStatus> change) {
    MailTrashEmptyStatus s = states.get(accountId);
    if (isRunning(s)) {
      states.put(accountId, change.apply(s));
    }
  }

  private static boolean isRunning(MailTrashEmptyStatus s) {
    return s != null && RUNNING.equals(s.state());
  }
}
