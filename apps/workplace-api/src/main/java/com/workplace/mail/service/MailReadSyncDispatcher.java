package com.workplace.mail.service;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.ReadSyncLocator;
import com.workplace.mail.event.MessageMarkedReadEvent;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * 읽음 역동기화 디스패처. @Transactional 메서드를 별도 빈으로 분리해 {@link MailReadSyncListener} 의 자기호출(self-invocation)
 * 프록시 우회 문제를 방지한다 — 같은 빈 내 @Transactional 직접 호출은 Spring 프록시를 타지 않아 GUC 가 주입되지 않는다(#492 동일 패턴).
 *
 * <p>TenantContext 는 호출 전 리스너가 이미 세팅하므로, @Primary {@code TenantAwareTransactionManager} 가 doBegin
 * 시점에 올바른 app.tenant_id GUC 를 주입한다.
 */
@Component
@RequiredArgsConstructor
public class MailReadSyncDispatcher {

  private final EmailMessageRepository messageRepo;
  private final EmailAccountRepository accountRepo;
  private final List<MailReadSyncer> syncers;

  /**
   * 이벤트의 messageId 로 역동기화 식별자와 계정을 조회하고, 해당 공급자의 {@link MailReadSyncer} 를 호출한다.
   *
   * <p>@Transactional: RLS GUC(app.tenant_id) 가 이 트랜잭션 경계 내에서만 유효하므로 조회를 트랜잭션 안에서 수행한다.
   *
   * <p>"서버 반영 대기" 표시 규칙(WP-148): syncer 가 예외 없이 끝나면(건너뜀 포함) 해제하고, locator·계정·syncer 가 없어 반영할 방법이 없을
   * 때도 해제한다(아무도 반영하지 않으므로 표시를 남길 이유가 없음). 예외는 그대로 전파(리스너가 흡수)해 표시를 유지한다 — 서버 반영이 예외로 실패한 메일만 대기 표시가
   * 남아 이후 서버 안읽음 되돌림이 반영되지 않는다.
   */
  @Transactional
  public void dispatch(MessageMarkedReadEvent ev) throws Exception {
    ReadSyncLocator loc = messageRepo.findReadSyncLocator(ev.messageId()).orElse(null);
    EmailAccountResponse account =
        loc == null ? null : accountRepo.findByIdAndUser(ev.userId(), loc.accountId()).orElse(null);
    MailReadSyncer syncer =
        account == null
            ? null
            : syncers.stream().filter(s -> s.provider() == loc.provider()).findFirst().orElse(null);
    if (syncer != null) {
      syncer.markReadOnServer(ev.userId(), account, loc); // 실패 시 예외 전파 → 대기 유지
    }
    messageRepo.clearSeenPushPending(ev.messageId());
  }
}
