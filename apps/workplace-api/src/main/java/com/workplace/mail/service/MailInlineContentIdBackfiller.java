package com.workplace.mail.service;

import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.dto.BodyTarget;
import com.workplace.mail.dto.ParsedAttachment;
import com.workplace.mail.event.InlineContentIdBackfillRequestedEvent;
import com.workplace.mail.repository.ContentAttachmentRepository;
import com.workplace.mail.repository.EmailAttachmentRepository;
import com.workplace.mail.repository.EmailAttachmentRepository.ContentIdBackfillTarget;
import com.workplace.mail.repository.EmailMessageRepository;
import java.util.List;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 규칙 도입(WP-68) 전에 적재된 Graph 메일의 인라인 이미지 보강 — 첨부 행이 아예 없는 인라인 전용 메일의 첨부 목록 즉시 적재({@link
 * #loadMissingAttachmentsNow})와 Content-ID 지연 백필({@link #backfillNow}).
 *
 * <p>전체 메일 일괄 백필은 Graph 호출이 과다하므로 열람된 메일만 대상으로 한다. 첫 열람은 프론트의 파일명 매칭으로 대부분 표시되고, 파일명과 무관한 cid 는 백필
 * 이후 열람부터 표시된다.
 *
 * <ul>
 *   <li>{@code @Async("mailReadSyncExecutor")}: Graph 왕복이 열람 응답을 지연시키지 않도록 Graph I/O 전용 풀에서 실행.
 *   <li>{@code fallbackExecution=true}: 발행처 {@link MailMessageService#get} 이 비-@Transactional 이다.
 *   <li>Graph 가 Content-ID 를 주지 않은 첨부는 빈 문자열로 기록 — "확인했지만 없음" 표시로, 열람마다 같은 Graph 호출이 반복되지 않게
 *       한다(프론트는 빈 값을 매칭하지 않는다). 조회 실패는 기록하지 않아 다음 열람에 재시도된다.
 * </ul>
 */
@Slf4j
@Component
public class MailInlineContentIdBackfiller {

  private final EmailAttachmentRepository attachmentRepo;
  private final ContentAttachmentRepository contentAttachmentRepo;
  private final EmailMessageRepository messageRepo;
  private final GraphBodyLoader graphBodyLoader;
  private final GraphTokenService graphTokenService;
  private final GraphInlineContentIdResolver resolver;

  /** RLS GUC 주입용 짧은 트랜잭션 — @Primary TenantAwareTransactionManager 로 구성. */
  private final TransactionTemplate txTemplate;

  public MailInlineContentIdBackfiller(
      EmailAttachmentRepository attachmentRepo,
      ContentAttachmentRepository contentAttachmentRepo,
      EmailMessageRepository messageRepo,
      GraphBodyLoader graphBodyLoader,
      GraphTokenService graphTokenService,
      GraphInlineContentIdResolver resolver,
      PlatformTransactionManager txManager) {
    this.attachmentRepo = attachmentRepo;
    this.contentAttachmentRepo = contentAttachmentRepo;
    this.messageRepo = messageRepo;
    this.graphBodyLoader = graphBodyLoader;
    this.graphTokenService = graphTokenService;
    this.resolver = resolver;
    this.txTemplate = new TransactionTemplate(txManager);
  }

  /** 비동기 진입점 — 이벤트의 tenantId 로 TenantContext 를 주입하고 finally 에서 반드시 해제한다. */
  @Async("mailReadSyncExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
  public void onRequested(InlineContentIdBackfillRequestedEvent ev) {
    TenantContext.set(ev.tenantId());
    try {
      backfillNow(ev.userId(), ev.messageId());
    } catch (Exception e) {
      // best-effort: 백필 실패가 열람 UX 에 영향을 주지 않도록 흡수(토큰 노출 방지 — 요약만)
      log.warn("Content-ID 백필 실패 messageId={}: {}", ev.messageId(), e.toString());
    } finally {
      TenantContext.clear();
    }
  }

  /**
   * 첨부 행이 없는 Graph 메일의 첨부 목록을 즉시 적재한다(열람 경로에서 동기 호출).
   *
   * <p>Graph hasAttachments 는 인라인 첨부를 세지 않아, 규칙 도입(WP-68) 전에는 인라인 이미지만 있는 메일의 첨부 목록을 아예 적재하지 않았다(운영
   * 기준 cid 참조 Graph 메일의 약 2/3). 행이 없으면 프론트가 cid 를 매칭할 대상이 없으므로, 본문 미적재 시 온디맨드 적재와 같은 방식으로 열람 시점에
   * 채운다. 메시지 행 잠금으로 동시 열람의 중복 적재를 막는다. best-effort — 실패는 false.
   *
   * @return 첨부 행이 새로 생겼으면 true(호출처가 상세를 다시 읽는다)
   */
  public boolean loadMissingAttachmentsNow(long userId, long messageId) {
    try {
      BodyTarget target =
          txTemplate.execute(
              status -> messageRepo.findBodyTargetForUser(userId, messageId).orElse(null));
      // Graph 메시지만(provider_message_id 는 Graph 전용) — content 미연결 legacy 는 적재 대상 아님
      if (target == null || target.providerMessageId() == null || target.contentId() == 0L) {
        return false;
      }
      String accessToken =
          txTemplate.execute(
              status -> graphTokenService.getAccessToken(userId, target.accountId()));
      Boolean loaded =
          txTemplate.execute(
              status -> {
                messageRepo.lockById(messageId);
                if (attachmentRepo.existsForMessage(messageId)) {
                  return false; // 동시 열람이 먼저 적재함
                }
                List<ParsedAttachment> attachments =
                    graphBodyLoader.fetchAttachmentMeta(
                        accessToken, target.providerMessageId(), messageId, true);
                // WP-130: 공유 manifest 와 어긋나면 ManifestMismatchException 으로 롤백 → 아래 catch 에서
                // false(fail-closed)
                attachmentRepo.insertAll(messageId, target.contentId(), attachments);
                return attachmentRepo.existsForMessage(messageId);
              });
      return Boolean.TRUE.equals(loaded);
    } catch (Exception e) {
      log.warn("인라인 첨부 적재 실패 messageId={}: {}", messageId, e.toString());
      return false;
    }
  }

  /** 동기 본체. 테스트는 이 메서드를 직접 호출해 같은 스레드에서 검증한다. */
  public void backfillNow(long userId, long messageId) {
    List<ContentIdBackfillTarget> targets =
        txTemplate.execute(
            status ->
                attachmentRepo.findContentIdBackfillTargets(
                    userId, messageId, GraphInlineContentIdResolver.MAX_INLINE_BYTES));
    if (targets == null || targets.isEmpty()) {
      return;
    }
    // 한 메시지의 첨부는 모두 같은 계정 — 토큰은 1회 조회(갱신 시 토큰 저장 쓰기가 있어 트랜잭션 필요)
    String accessToken =
        txTemplate.execute(
            status -> graphTokenService.getAccessToken(userId, targets.get(0).accountId()));
    for (ContentIdBackfillTarget t : targets) {
      String contentId;
      try {
        contentId =
            resolver.fetchContentId(accessToken, t.providerMessageId(), t.providerAttachmentId());
      } catch (Exception e) {
        // 일시 장애(429·5xx·네트워크)는 기록하지 않는다 — NULL 로 남아 다음 열람에 재시도된다
        log.warn("Content-ID 조회 실패(다음 열람에 재시도) messageId={}: {}", messageId, e.toString());
        continue;
      }
      String value = contentId != null ? contentId : "";
      txTemplate.executeWithoutResult(
          status -> contentAttachmentRepo.setMimeContentIdIfNull(t.contentAttachmentId(), value));
    }
  }
}
