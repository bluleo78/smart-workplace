package com.workplace.mail.service;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.SeenSyncItem;
import com.workplace.mail.dto.SeenSyncResult;
import com.workplace.mail.event.MessagesSeenChangedEvent;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 읽음 역동기화 디스패처(WP-187 일반화). 이벤트의 메일 id 를 {@link #CHUNK} 개씩 잘라, 조각마다 [반영 대기 행을 처리 시점 seen 으로 조회 →
 * 공급자 처리기 호출 → 성공 항목만 "보낸 값과 지금 seen 이 같을 때" 대기 해제]를 한 트랜잭션으로 묶는다. 계정·처리기가 없어 반영할 방법이 없으면 대기를 바로
 * 푼다(WP-148 규칙 유지).
 *
 * <p>조각 단위 트랜잭션인 이유:
 *
 * <ul>
 *   <li>RLS GUC(app.tenant_id)는 트랜잭션 경계 안에서만 유효하다 — 처리기가 읽는 토큰·비밀번호 쿼리도 이 안에서 돌아야 0행이 안 된다(#444).
 *       TenantContext 는 리스너가 세팅하므로 @Primary TenantAwareTransactionManager 가 조각마다 GUC 를 주입한다.
 *   <li>조각 N 이 실패해도 1..N-1 의 해제는 이미 커밋돼 남는다("그 지점에서 멈춤"). 트랜잭션 하나가 HTTP 수백 회 동안 커넥션을 잡지도 않는다.
 *   <li>id 를 조회 전에 자르므로 IN 바인드가 Postgres 상한(32767)을 넘지 않는다.
 * </ul>
 *
 * <p>처리기가 멈춤(429·장애)을 알리면 그 조각을 커밋하고 중단, 예외면 그 조각을 롤백하고 중단한다 — 남은 메일은 대기 표시를 유지한다(재시도 배치는 후속). 별도
 * 빈으로 둔 것은 리스너의 자기호출 프록시 우회를 피하던 기존 구조(#492)를 그대로 잇는다.
 */
@Slf4j
@Component
public class MailReadSyncDispatcher {

  /** 한 조각(트랜잭션)에서 처리기로 넘기는 메일 수. */
  static final int CHUNK = 200;

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

  /** 이벤트의 메일들을 조각 단위로 원본 서버에 반영한다. best-effort — 실패는 경고 로그(accountId·건수만)로 남기고 중단한다. */
  public void dispatch(MessagesSeenChangedEvent ev) {
    List<Long> ids = ev.messageIds();
    if (ids.isEmpty()) {
      return;
    }
    // 계정 조회도 RLS 스코프 — 짧은 트랜잭션으로
    EmailAccountResponse account =
        txTemplate.execute(
            s -> accountRepo.findByIdAndUser(ev.userId(), ev.accountId()).orElse(null));
    MailReadSyncer syncer =
        account == null
            ? null
            : syncers.stream()
                .filter(sy -> sy.provider() == account.provider())
                .findFirst()
                .orElse(null);
    for (int i = 0; i < ids.size(); i += CHUNK) {
      List<Long> slice = ids.subList(i, Math.min(i + CHUNK, ids.size()));
      SeenSyncResult r;
      try {
        // 예외는 람다 안에서 삼키지 않는다 — getAccessToken(@Transactional) 실패가 rollback-only 를 남겨 커밋 시
        // UnexpectedRollbackException 이 되므로, 밖으로 내보내 이 조각을 롤백시키고 여기서 잡는다
        r = txTemplate.execute(s -> syncSlice(ev.userId(), account, syncer, slice));
      } catch (RuntimeException e) {
        log.warn(
            "읽음 역동기화 중단: accountId={} 남은(이 조각부터)={} cause={}",
            ev.accountId(),
            ids.size() - i,
            e.getClass().getSimpleName());
        return;
      }
      if (r != null && r.stopped()) {
        log.warn(
            "읽음 역동기화 중단(429·장애): accountId={} 이번조각성공={} 이후미처리={}",
            ev.accountId(),
            r.succeeded().size(),
            ids.size() - i - slice.size());
        return;
      }
    }
  }

  /** 한 조각: 반영 대기 행 조회 → 처리기 → 성공 항목 조건부 해제. 대기 행이 없으면 null. 처리기의 checked 예외는 롤백되도록 감싸 던진다. */
  private SeenSyncResult syncSlice(
      long userId, EmailAccountResponse account, MailReadSyncer syncer, List<Long> slice) {
    List<SeenSyncItem> items = messageRepo.findPendingSeenSyncItems(slice);
    if (items.isEmpty()) {
      return null;
    }
    SeenSyncResult r;
    if (syncer == null) {
      r = SeenSyncResult.all(items); // 반영할 방법이 없다 — 표시를 남길 이유가 없음
    } else {
      try {
        r = syncer.syncSeen(userId, account, items);
      } catch (RuntimeException e) {
        throw e;
      } catch (Exception e) {
        throw new IllegalStateException("읽음 역동기화 처리기 실패", e);
      }
    }
    // 성공 항목을 보낸 값별로 나눠 한 번씩 해제 — 보낸 값과 지금 seen 이 같을 때만 풀려, 그사이 사용자가 다시 바꿨다면 뒤따르는 이벤트가 처리한다
    Map<Boolean, List<Long>> pushed =
        items.stream()
            .filter(it -> r.succeeded().contains(it.messageId()))
            .collect(
                Collectors.partitioningBy(
                    SeenSyncItem::seen,
                    Collectors.mapping(SeenSyncItem::messageId, Collectors.toList())));
    messageRepo.clearSeenPushPendingIn(pushed.get(true), true);
    messageRepo.clearSeenPushPendingIn(pushed.get(false), false);
    return r;
  }
}
