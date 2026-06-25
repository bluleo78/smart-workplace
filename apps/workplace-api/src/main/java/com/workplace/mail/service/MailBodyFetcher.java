package com.workplace.mail.service;

import com.workplace.auth.service.AssistantSpec;
import com.workplace.mail.dto.BodyTarget;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.exception.EmailAccountNotFoundException;
import com.workplace.mail.repository.EmailAccountRepository;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

/**
 * 단건 본문 적재 진입점(디스패처). OnDemand(메일 열람)와 백그라운드 보충({@link MailBackfillService})이 공유한다.
 *
 * <p>account.provider() 로 {@link MailBodyLoader} 구현을 선택해 위임하고, 적재 성공 시에만 공통 AI 분류(best-effort)를
 * 수행한다. 적재 실패(loadBody=false) 시 분류를 skip 해 빈 스니펫 기반 영구 오분류를 방지한다(I1 수정). body_fetched_at 멱등 가드 및 AI
 * 분류 트리거는 공급자와 무관한 공통 관심사이므로 이 디스패처에서 처리한다.
 */
@Slf4j
@Service
public class MailBodyFetcher {

  private final EmailAccountRepository accountRepo;
  private final MailAiService mailAiService;

  /** 공급자 → loader 맵. Spring 이 {@link MailBodyLoader} 구현체를 모두 주입한다. */
  private final Map<com.workplace.mail.dto.MailProvider, MailBodyLoader> loaders;

  public MailBodyFetcher(
      EmailAccountRepository accountRepo,
      MailAiService mailAiService,
      List<MailBodyLoader> loaders) {
    this.accountRepo = accountRepo;
    this.mailAiService = mailAiService;
    this.loaders =
        loaders.stream().collect(Collectors.toMap(MailBodyLoader::provider, Function.identity()));
  }

  /**
   * 대상 메일의 본문을 적재한다. 이미 적재됐으면(body_fetched_at 존재) no-op. 소유 아니면 404. 공급자 미지원이면 경고 후 반환. 적재 후 계정 AI
   * 사용 시 분류(best-effort).
   */
  public void fetchBody(long userId, BodyTarget target) {
    if (target.bodyFetchedAt() != null) {
      return; // 이미 적재됨 — 멱등
    }
    EmailAccountResponse account =
        accountRepo
            .findByIdAndUser(userId, target.accountId())
            .orElseThrow(() -> new EmailAccountNotFoundException(target.accountId()));

    MailBodyLoader loader = loaders.get(account.provider());
    if (loader == null) {
      log.warn("지원하지 않는 공급자 본문 적재: {}", account.provider());
      return;
    }
    // 공급자별 본문/첨부 적재 — 성공(true) 시에만 분류 진행
    boolean loaded = loader.loadBody(userId, target, account);

    // 분류는 적재 성공 시에만 수행한다. 적재 실패 시 빈 스니펫으로 분류하면
    // ai_needs_reply 가 영구 기록되고 본문 적재 후에도 재분류 안 됨(I1 영구 오분류 회귀 차단).
    if (loaded && account.aiEnabled()) {
      AssistantSpec spec = mailAiService.resolveSpecOrNull(userId);
      if (spec != null) {
        mailAiService.classifyAndStore(userId, target.messageId(), spec);
      }
    }
  }
}
