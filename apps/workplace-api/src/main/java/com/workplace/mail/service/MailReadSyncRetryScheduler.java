package com.workplace.mail.service;

import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.repository.EmailMessageRepository.DueSeenPushAccount;
import com.workplace.tenant.repository.TenantRepository;
import java.util.List;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 읽음 역동기화 재시도 배치(WP-188).
 *
 * <p>이벤트 경로가 놓친 반영 대기 행을 줍는다 — 원격 실패 후 백오프가 끝난 행, 역동기화 실행기 큐가 차서 이벤트가 거절된 행, 다른 실행이 리스를 쥐고 있어 그냥
 * 돌아간 행. 1분마다(fixedDelay) 모든 활성 테넌트를 돌며 "지금 반영할" 대기 행이 있는 계정마다 {@link
 * MailReadSyncDispatcher#dispatchAccount} 를 부른다.
 *
 * <p>ShedLock 은 배치 자체를 한 인스턴스에서만 돌게 할 뿐이다 — 다른 인스턴스의 이벤트 리스너는 여전히 같은 계정을 반영하려 할 수 있다. 계정 단위 순서 보장은
 * 디스패처의 DB 리스가 맡는다.
 *
 * <p>테넌트 순회는 {@link MailAutoSyncScheduler} 패턴을 따른다: RLS 없는 tenant 테이블로 테넌트를 열거하고, 테넌트마다 {@link
 * TenantContext} 를 세팅해 각 짧은 트랜잭션이 올바른 GUC 로 돈다. 원격 호출이 들어 있으므로 감싸는 트랜잭션을 두지 않는다(WP-215).
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class MailReadSyncRetryScheduler {

  private final TenantRepository tenantRepository;
  private final EmailMessageRepository messageRepo;
  private final MailReadSyncDispatcher dispatcher;

  /** 스케줄 진입점 — 앞 회차가 끝나고 1분 뒤 재실행, 기동 45초 뒤 첫 실행. */
  @Scheduled(fixedDelay = 60_000, initialDelay = 45_000)
  @SchedulerLock(name = "MailReadSyncRetryScheduler.scheduled", lockAtMostFor = "PT15M")
  public void scheduled() {
    retryAllTenants();
  }

  /** 전 활성 테넌트의 반영 대기 계정을 처리한다. 한 계정·테넌트의 실패가 나머지를 막지 않는다. */
  public void retryAllTenants() {
    for (Long tenantId : tenantRepository.findActiveTenantIds()) {
      try {
        TenantContext.set(tenantId);
        // 자체 @Transactional(readOnly=true) 가 TenantContext → GUC 주입
        List<DueSeenPushAccount> accounts = messageRepo.findAccountsWithDueSeenPush();
        for (DueSeenPushAccount a : accounts) {
          try {
            // 디스패처는 내부 짧은 트랜잭션마다 TenantContext 로 GUC 를 재주입하므로 컨텍스트를 살려 둔 채 호출한다
            dispatcher.dispatchAccount(a.userId(), a.accountId());
          } catch (Exception e) {
            log.warn(
                "읽음 역동기화 재시도 실패 — 건너뜀: tenantId={} accountId={} cause={}",
                tenantId,
                a.accountId(),
                e.getClass().getSimpleName());
          }
        }
      } catch (Exception e) {
        log.warn(
            "읽음 역동기화 재시도 테넌트 조회 실패 — 건너뜀: tenantId={} cause={}",
            tenantId,
            e.getClass().getSimpleName());
      } finally {
        // 스케줄러 스레드 재사용 시 컨텍스트 오염 방지
        TenantContext.clear();
      }
    }
  }
}
