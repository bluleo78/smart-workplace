package com.workplace.mail.service;

import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.security.EncryptionService;
import com.workplace.mail.dto.BodyTarget;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.ParsedAttachment;
import com.workplace.mail.dto.ParsedBody;
import com.workplace.mail.exception.EmailAccountNotFoundException;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailAttachmentRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import jakarta.mail.Folder;
import jakarta.mail.Message;
import jakarta.mail.Store;
import jakarta.mail.UIDFolder;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

/**
 * 단건 본문 적재. OnDemand(메일 열람)와 백그라운드 보충이 공유하는 진입점. IMAP 에서 UID 로 메시지를 재조회해 본문/스니펫/첨부를 파싱하고 DB 에 캐시한
 * 뒤(body_fetched_at 갱신), 계정 AI 사용 시 분류한다.
 *
 * <p>네트워크 I/O(IMAP 연결·본문 다운로드)는 트랜잭션 밖에서 수행한다 — 풀 커넥션을 점유하지 않도록. 본문/분류 update 는 각자 짧은 커넥션으로 멱등
 * 수행한다(동일 대상 재호출은 body_fetched_at 가드로 no-op).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class MailBodyFetcher {

  private final EmailAccountRepository accountRepo;
  private final EmailMessageRepository messageRepo;
  private final EmailAttachmentRepository attachmentRepo;
  private final EncryptionService encryption;
  private final ImapConnector imapConnector;
  private final MailMessageParser parser;
  private final MailAiService mailAiService;

  /**
   * 대상 메일의 본문을 IMAP 에서 적재. 이미 적재됐으면(body_fetched_at 존재) no-op. 소유 아니면 404. 네트워크/파싱 실패는
   * 삼킨다(best-effort) — 호출 흐름(상세 열람/백그라운드)을 막지 않는다.
   */
  public void fetchBody(long userId, BodyTarget target) {
    if (target.bodyFetchedAt() != null) {
      return; // 이미 적재됨 — 멱등
    }
    EmailAccountResponse account =
        accountRepo
            .findByIdAndUser(userId, target.accountId())
            .orElseThrow(() -> new EmailAccountNotFoundException(target.accountId()));
    String password =
        accountRepo
            .findEncryptedPassword(userId, target.accountId())
            .map(encryption::decrypt)
            .orElseThrow(() -> new EmailAccountNotFoundException(target.accountId()));

    Store store = null;
    Folder folder = null;
    try {
      store = imapConnector.connect(account, password);
      folder = store.getFolder(target.folderName());
      folder.open(Folder.READ_ONLY);
      Message msg = ((UIDFolder) folder).getMessageByUID(target.imapUid());
      if (msg == null) {
        // 서버에서 사라진 메시지 — 빈 본문으로 적재 표시해 영구 재시도(무한 정지)를 방지한다.
        log.warn("본문 적재 대상 메시지 없음 (messageId={}, uid={})", target.messageId(), target.imapUid());
        messageRepo.updateBody(target.messageId(), null, null, null, false);
        return;
      }
      ParsedBody body = parser.parseBody(msg);
      messageRepo.updateBody(
          target.messageId(),
          body.bodyText(),
          body.bodyHtml(),
          body.snippet(),
          body.hasAttachment());
      for (ParsedAttachment a : body.attachments()) {
        attachmentRepo.insert(target.messageId(), a);
      }
      // 스니펫 확보됨 → 계정 AI 사용 시 분류(best-effort). messageId 로 subject/from/snippet 을 읽어 분류한다.
      if (account.aiEnabled()) {
        AssistantSpec spec = mailAiService.resolveSpecOrNull(userId);
        if (spec != null) {
          mailAiService.classifyAndStore(userId, target.messageId(), spec);
        }
      }
    } catch (Exception e) {
      // 자격증명 노출 방지를 위해 messageId 와 예외 요약만 기록한다.
      log.warn("본문 적재 실패 (messageId={}): {}", target.messageId(), e.toString());
    } finally {
      closeQuietly(folder, store);
    }
  }

  private void closeQuietly(Folder folder, Store store) {
    try {
      if (folder != null && folder.isOpen()) {
        folder.close(false);
      }
    } catch (Exception ignored) {
      // 적재 결과에 영향 없음
    }
    try {
      if (store != null) {
        store.close();
      }
    } catch (Exception ignored) {
      // 적재 결과에 영향 없음
    }
  }
}
