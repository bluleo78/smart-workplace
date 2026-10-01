package com.workplace.mail.service;

import com.workplace.mail.dto.BodyTarget;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.exception.EmailAccountNotFoundException;
import com.workplace.mail.repository.EmailAccountRepository;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

/**
 * 단건 본문 적재 진입점(디스패처). OnDemand(메일 열람)·백그라운드 보충({@link MailBackfillService})·선제 백필이 공유한다.
 *
 * <p>account.provider() 로 {@link MailBodyLoader} 구현을 골라 위임하고, body_fetched_at 멱등 가드를 공통으로 처리한다.
 * WP-149: AI 분석은 하지 않는다 — 호출자 트랜잭션 안에서 LLM 을 부르면 커넥션·행 잠금을 오래 잡고(#232), 웹 열람이 LLM 을 기다리게 된다. 대신
 * "이번에 적재했는지"를 돌려줘 백그라운드 보충이 커밋 후 분석하게 한다. 적재 실패면 false — 빈 스니펫 기반 오분류 방지(I1).
 */
@Slf4j
@Service
public class MailBodyFetcher {

  private final EmailAccountRepository accountRepo;

  /** 공급자 → loader 맵. Spring 이 {@link MailBodyLoader} 구현체를 모두 주입한다. */
  private final Map<MailProvider, MailBodyLoader> loaders;

  public MailBodyFetcher(EmailAccountRepository accountRepo, List<MailBodyLoader> loaders) {
    this.accountRepo = accountRepo;
    this.loaders =
        loaders.stream().collect(Collectors.toMap(MailBodyLoader::provider, Function.identity()));
  }

  /**
   * 대상 메일의 본문을 적재한다. 소유 아니면 404.
   *
   * @return 이번 호출로 적재했으면 true. 이미 적재됨·지원하지 않는 공급자·적재 실패면 false
   */
  public boolean fetchBody(long userId, BodyTarget target) {
    if (target.bodyFetchedAt() != null) {
      return false; // 이미 적재됨 — 멱등
    }
    EmailAccountResponse account =
        accountRepo
            .findByIdAndUser(userId, target.accountId())
            .orElseThrow(() -> new EmailAccountNotFoundException(target.accountId()));
    MailBodyLoader loader = loaders.get(account.provider());
    if (loader == null) {
      log.warn("지원하지 않는 공급자 본문 적재: {}", account.provider());
      return false;
    }
    return loader.loadBody(userId, target, account);
  }
}
