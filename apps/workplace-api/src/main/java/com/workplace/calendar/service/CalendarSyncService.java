package com.workplace.calendar.service;

import static java.util.stream.Collectors.toMap;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.repository.EmailAccountRepository;
import java.util.List;
import java.util.Map;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 캘린더 동기화 오케스트레이터 — 공급자 중립(provider-neutral).
 *
 * <p>계정을 로드해 provider 에 맞는 {@link CalendarFetcher} 에 위임한다. IMAP 등 캘린더 fetcher 가 없는 공급자는 no-op(조용히
 * 리턴).
 *
 * <p>계정 조회는 짧은 트랜잭션({@link TransactionTemplate}) 으로 감싸 RLS GUC(app.tenant_id)가 주입된 후 SELECT 가 실행되도록
 * 한다. sync() 자체를 @Transactional 로 선언하면 HTTP 페치까지 트랜잭션 안에 포함되어 커넥션 점유 문제가 발생하므로 금지(#232 패턴).
 */
@Slf4j
@Service
public class CalendarSyncService {

  private final EmailAccountRepository accountRepo;

  /**
   * 짧은-트랜잭션용 TransactionTemplate — @Primary TenantAwareTransactionManager 로 구성해 트랜잭션 진입 시 RLS
   * GUC(app.tenant_id) 가 주입된다(#492/#444 패턴). 계정 조회 SELECT 를 이 안에서 수행한다.
   */
  private final TransactionTemplate txTemplate;

  /** 공급자 → fetcher 맵. Spring 이 CalendarFetcher 빈 목록을 자동 주입한다. */
  private final Map<MailProvider, CalendarFetcher> fetchers;

  public CalendarSyncService(
      EmailAccountRepository accountRepo,
      PlatformTransactionManager txManager,
      List<CalendarFetcher> fetchers) {
    this.accountRepo = accountRepo;
    this.txTemplate = new TransactionTemplate(txManager);
    this.fetchers = fetchers.stream().collect(toMap(CalendarFetcher::provider, f -> f));
  }

  /**
   * 지정 계정의 캘린더를 동기화한다.
   *
   * <p>계정이 없거나 fetcher 미지원 공급자(IMAP 등)이면 조용히 리턴(no-op). 계정 조회 트랜잭션 분리: SELECT 는 txTemplate 안에서 실행해
   * RLS GUC 주입을 보장한다. HTTP 호출은 fetcher 에게 위임(fetcher 도 collect-then-persist 로 분리).
   *
   * @param userId 계정 소유자
   * @param accountId email_account.id
   */
  public void sync(long userId, long accountId) {
    // 계정 로드 — txTemplate 안에서 수행해 RLS GUC 주입 보장(bare 호출 시 RLS 가 행을 숨겨 no-op 발생, #492 패턴)
    EmailAccountResponse account =
        txTemplate.execute(status -> accountRepo.findByIdAndUser(userId, accountId).orElse(null));

    if (account == null) {
      log.debug("캘린더 동기화 건너뜀 — 계정 미발견: userId={} accountId={}", userId, accountId);
      return;
    }

    CalendarFetcher fetcher = fetchers.get(account.provider());
    if (fetcher == null) {
      log.debug(
          "캘린더 fetcher 없음 — 공급자 미지원: provider={} accountId={}", account.provider(), accountId);
      return;
    }

    fetcher.sync(userId, accountId, account);
  }
}
