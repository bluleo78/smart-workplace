package com.workplace.mail.service;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.SeenSyncItem;
import com.workplace.mail.dto.SeenSyncResult;
import com.workplace.mail.event.MessagesSeenChangedEvent;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Predicate;
import java.util.stream.Collectors;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 읽음 역동기화 디스패처(WP-187 일반화, WP-188 순서 보장·재시도).
 *
 * <p>한 계정의 원본 서버 반영은 <b>계정 리스</b>(email_account.seen_push_lease_*)를 쥔 실행 하나만 한다. 리스를 쥐면 그 계정의 "지금
 * 반영할" 대기 행을 {@link #CHUNK} 개씩 [짧은 트랜잭션: 리스 연장 + 처리 시점 seen 조회] → [트랜잭션 밖: 원본 서버 반영] → [짧은 트랜잭션:
 * 성공은 "보낸 값과 지금 seen 이 같을 때" 해제, 실패는 백오프 기록] 로 처리하고, 더 반영할 행이 없을 때까지 되풀이한 뒤 리스를 놓는다.
 *
 * <p>왜 이렇게 하면 사용자의 마지막 값이 서버 최종값이 되는가(WP-188):
 *
 * <ul>
 *   <li>리스는 DB 행의 원자적 UPDATE 로 잡으므로 api 인스턴스가 여러 개여도 한 계정의 반영은 동시에 하나뿐이다 — 옛 값을 보내는 반영이 새 값을 보낸
 *       반영보다 늦게 서버에 닿는 순서 역전이 생기지 않는다.
 *   <li>보낼 값은 리스를 쥔 <b>뒤</b> DB 에서 읽는다(이벤트 값 아님). 보내는 동안 사용자가 다시 바꾸면 조건부 해제가 0행이 돼 대기가 남고, 같은 실행이
 *       다음 회차에 새 값을 다시 읽어 보낸다. true→false→true 처럼 같은 값으로 돌아온 경우는 해제돼도 서버·로컬이 이미 같으므로 버전 카운터가 필요 없다.
 *   <li>리스를 못 잡은 실행은 아무것도 하지 않고 돌아간다 — 보유자가 끝난 뒤 해제 직후 재확인(최대 {@link #MAX_ROUNDS}회)으로 그 행을 줍고, 그래도
 *       남으면 {@link MailReadSyncRetryScheduler} 가 줍는다. 리스를 못 잡은 것은 실패로 세지 않는다.
 *   <li>보유자가 죽으면 리스 만료({@link #LEASE_TTL}) 뒤 다른 실행이 가져간다. 조각마다 연장하고, 연장에 실패하면(만료돼 남이 가져갔을 수 있음) 더
 *       보내지 않는다.
 * </ul>
 *
 * <p>그 밖의 원칙(기존 유지):
 *
 * <ul>
 *   <li>RLS GUC(app.tenant_id)는 트랜잭션 경계 안에서만 유효하다 — 리스·대기 행·자격 조회와 해제는 트랜잭션 안에서 해야 0행이 안 된다(#444).
 *       TenantContext 는 호출 측(리스너·배치)이 세팅한다.
 *   <li>원격 반영(Graph $batch 최대 10회·IMAP STORE)은 조각당 수 초 걸린다 — 그동안 DB 커넥션을 잡지 않는다(WP-215).
 *   <li>공급자 세션(토큰·IMAP 접속)은 한 번 열어 조각끼리 재사용한다(WP-215).
 * </ul>
 *
 * <p>실패 처리: 처리기 예외면 그 조각 전체, 처리기가 성공으로 돌려주지 않은 항목은 실패로 기록해(횟수 +1, 지수 백오프) 재시도 배치가 다시 보낸다. 횟수가
 * {@link #MAX_ATTEMPTS} 에 닿으면 포기하고 대기를 풀어 다음 동기화가 서버 값을 따르게 한다. 429·장애로 멈추면 이번 실행을 끝낸다.
 */
@Slf4j
@Component
public class MailReadSyncDispatcher {

  /** 한 조각(트랜잭션)에서 처리기로 넘기는 메일 수. */
  static final int CHUNK = 200;

  /**
   * 계정 리스 유지 시간. 한 조각의 원격 반영 최악치(Graph $batch 10회 × {@code GraphApiClient#BATCH_TIMEOUT} 20초 + 토큰
   * 요청 {@code TOKEN_TIMEOUT} 20초, IMAP 은 작업당 10초 타임아웃)보다 넉넉히 길게 잡는다 — 반영 도중 만료되면 다른 실행과 겹칠 수 있다.
   */
  static final Duration LEASE_TTL = Duration.ofMinutes(10);

  /** 메일당 연속 실패 상한 — 닿으면 포기하고 서버 값을 따른다(백오프 1·2·4·…·60분, 약 2시간). */
  static final int MAX_ATTEMPTS = 8;

  /** 한 리스 보유 동안 처리할 최대 조각 수 — 사용자가 계속 바꾸는 등으로 끝나지 않는 일을 막는다(남은 건 재시도 배치). */
  static final int MAX_CHUNKS_PER_LEASE = 50;

  /** 리스 해제 직후 재확인 회차 상한 — 보유 중에 리스를 못 잡고 돌아간 이벤트의 행을 줍는다. */
  static final int MAX_ROUNDS = 3;

  /** 한 번의 리스 보유가 끝난 이유. */
  enum Outcome {
    /** 반영할 행이 더 없어 끝남 — 해제 직후 재확인 대상. */
    DRAINED,
    /** 다른 실행이 리스를 쥐고 있음 — 그 실행(또는 배치)이 처리한다. */
    BUSY,
    /** 429·장애·예외·연장 실패·조각 상한으로 멈춤 — 남은 건 재시도 배치가 처리한다. */
    STOPPED
  }

  private final EmailMessageRepository messageRepo;
  private final EmailAccountRepository accountRepo;
  private final List<MailReadSyncer> syncers;
  private final TransactionTemplate txTemplate;

  public MailReadSyncDispatcher(
      EmailMessageRepository messageRepo,
      EmailAccountRepository accountRepo,
      List<MailReadSyncer> syncers,
      PlatformTransactionManager txManager) {
    this.messageRepo = messageRepo;
    this.accountRepo = accountRepo;
    this.syncers = syncers;
    this.txTemplate = new TransactionTemplate(txManager);
  }

  /**
   * 읽음 변경 이벤트 처리 — 이벤트의 메일만이 아니라 그 계정의 "지금 반영할" 대기 행 전체를 반영한다(이벤트 값이 아닌 처리 시점 DB 값을 보내므로 어느 이벤트가
   * 처리하든 결과가 같다).
   */
  public void dispatch(MessagesSeenChangedEvent ev) {
    if (ev.messageIds().isEmpty()) {
      return;
    }
    dispatchAccount(ev.userId(), ev.accountId());
  }

  /**
   * 한 계정의 대기 행을 리스 아래에서 반영한다. 리스너와 재시도 배치가 같이 쓰는 진입점. best-effort — 예외를 밖으로 던지지 않는다.
   *
   * <p>반영할 행을 다 비우고 리스를 놓은 직후 한 번 더 확인한다: 리스를 쥔 동안 커밋된 변경의 이벤트는 리스 획득에 실패하고 돌아갔으므로, 그 행은 보유자가 해제 뒤에
   * 줍는다(해제가 그 커밋보다 늦으므로 반드시 보인다).
   */
  public void dispatchAccount(long userId, long accountId) {
    for (int round = 0; round < MAX_ROUNDS; round++) {
      if (runUnderLease(userId, accountId) != Outcome.DRAINED) {
        return;
      }
      List<SeenSyncItem> more =
          txTemplate.execute(s -> messageRepo.findDueSeenSyncItems(accountId, 1));
      if (more == null || more.isEmpty()) {
        return;
      }
    }
  }

  /** 리스를 잡고 대기 행을 조각 단위로 반영한 뒤 놓는다. */
  Outcome runUnderLease(long userId, long accountId) {
    // 디스패치마다 새 토큰 — 같은 JVM 의 다른 스레드도 서로 다른 보유자로 구별된다
    String owner = UUID.randomUUID().toString();
    if (!Boolean.TRUE.equals(
        txTemplate.execute(
            s -> accountRepo.tryAcquireSeenPushLease(accountId, owner, LEASE_TTL)))) {
      return Outcome.BUSY;
    }
    MailReadSyncer.Session session = null;
    try {
      // 계정 조회도 RLS 스코프 — 짧은 트랜잭션으로
      EmailAccountResponse account =
          txTemplate.execute(s -> accountRepo.findByIdAndUser(userId, accountId).orElse(null));
      MailReadSyncer syncer =
          account == null
              ? null
              : syncers.stream()
                  .filter(sy -> sy.provider() == account.provider())
                  .findFirst()
                  .orElse(null);
      for (int n = 0; n < MAX_CHUNKS_PER_LEASE; n++) {
        // 첫 조각은 방금 잡았으므로 연장 불필요. 연장 실패 = 만료돼 남이 가져갔을 수 있음 → 더 보내지 않는다
        if (n > 0
            && !Boolean.TRUE.equals(
                txTemplate.execute(
                    s -> accountRepo.renewSeenPushLease(accountId, owner, LEASE_TTL)))) {
          log.warn("읽음 역동기화 리스 연장 실패 — 중단: accountId={}", accountId);
          return Outcome.STOPPED;
        }
        // 보낼 값은 리스를 쥔 뒤 DB 에서 읽는다 — 늦게 도착한 옛 값이 최종값이 되지 않게
        List<SeenSyncItem> items =
            txTemplate.execute(s -> messageRepo.findDueSeenSyncItems(accountId, CHUNK));
        if (items == null || items.isEmpty()) {
          return Outcome.DRAINED;
        }
        SeenSyncResult r;
        try {
          if (session == null) {
            // 반영할 행이 처음 나온 조각에서 한 번 연다(자격 조회는 RLS 스코프 — 트랜잭션 안).
            // 예외는 람다 안에서 삼키지 않는다 — @Transactional 조회 실패가 rollback-only 를 남겨
            // 커밋 시 UnexpectedRollbackException 이 되므로 밖에서 잡는다
            session =
                syncer == null
                    ? MailReadSyncer.NONE
                    : txTemplate.execute(s -> syncer.open(userId, account));
          }
          r = session.push(items); // 트랜잭션 밖 — 원격 호출 동안 커넥션을 잡지 않는다
        } catch (Exception e) {
          recordFailure(accountId, items, it -> true);
          log.warn(
              "읽음 역동기화 실패 — 백오프 후 재시도: accountId={} 이번조각={} cause={}",
              accountId,
              items.size(),
              e.getClass().getSimpleName());
          return Outcome.STOPPED;
        }
        clearPushed(items, r);
        // 성공으로 오지 않은 항목(그 밖의 4xx·429 로 멈춰 못 보낸 묶음)은 실패로 기록 — 백오프 없이 두면 같은 실행이 곧바로 다시 집어 무한 반복한다
        recordFailure(accountId, items, it -> !r.succeeded().contains(it.messageId()));
        if (r.stopped()) {
          log.warn(
              "읽음 역동기화 중단(429·장애) — 백오프 후 재시도: accountId={} 이번조각성공={}",
              accountId,
              r.succeeded().size());
          return Outcome.STOPPED;
        }
      }
      return Outcome.STOPPED; // 조각 상한 — 남은 건 재시도 배치가 처리
    } catch (Exception e) {
      // DB 조회 실패 등 — 대기 표시는 그대로 남아 재시도 배치가 줍는다
      log.warn("읽음 역동기화 중단: accountId={} cause={}", accountId, e.getClass().getSimpleName());
      return Outcome.STOPPED;
    } finally {
      if (session != null) {
        session.close();
      }
      try {
        txTemplate.executeWithoutResult(s -> accountRepo.releaseSeenPushLease(accountId, owner));
      } catch (Exception e) {
        // 해제 실패는 만료로 복구된다
        log.warn("읽음 역동기화 리스 해제 실패(만료로 복구): accountId={}", accountId);
      }
    }
  }

  /**
   * 성공 항목을 보낸 값별로 나눠 한 번씩 해제(짧은 트랜잭션) — 보낸 값과 지금 seen 이 같을 때만 풀려, 그사이 사용자가 다시 바꿨다면 대기가 남아 다음 조각에서 새
   * 값을 보낸다.
   */
  private void clearPushed(List<SeenSyncItem> items, SeenSyncResult r) {
    Map<Boolean, List<Long>> pushed = bySeen(items, it -> r.succeeded().contains(it.messageId()));
    txTemplate.executeWithoutResult(
        s -> {
          messageRepo.clearSeenPushPendingIn(pushed.get(true), true);
          messageRepo.clearSeenPushPendingIn(pushed.get(false), false);
        });
  }

  /** 실패 항목을 보낸 값별로 기록(짧은 트랜잭션)하고, 상한에 닿아 포기한 건수가 있으면 경고 로그(계정 id·건수만)를 남긴다. */
  private void recordFailure(long accountId, List<SeenSyncItem> items, Predicate<SeenSyncItem> f) {
    Map<Boolean, List<Long>> failed = bySeen(items, f);
    Integer givenUp =
        txTemplate.execute(
            s ->
                messageRepo.recordSeenPushFailure(failed.get(true), true, MAX_ATTEMPTS)
                    + messageRepo.recordSeenPushFailure(failed.get(false), false, MAX_ATTEMPTS));
    if (givenUp != null && givenUp > 0) {
      log.warn("읽음 역동기화 재시도 상한 도달 — 포기하고 서버 값을 따름: accountId={} count={}", accountId, givenUp);
    }
  }

  /** 조건에 맞는 항목의 id 를 seen 값(true/false)별로 나눈다 — 해제·실패 기록은 "보낸 값" 조건으로 한 번씩 부른다. */
  private static Map<Boolean, List<Long>> bySeen(
      List<SeenSyncItem> items, Predicate<SeenSyncItem> f) {
    return items.stream()
        .filter(f)
        .collect(
            Collectors.partitioningBy(
                SeenSyncItem::seen,
                Collectors.mapping(SeenSyncItem::messageId, Collectors.toList())));
  }
}
