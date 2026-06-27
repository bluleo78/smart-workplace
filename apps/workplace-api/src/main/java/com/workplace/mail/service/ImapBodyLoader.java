package com.workplace.mail.service;

import com.workplace.global.security.EncryptionService;
import com.workplace.mail.dto.BodyTarget;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.dto.ParsedAttachment;
import com.workplace.mail.dto.ParsedBody;
import com.workplace.mail.exception.EmailAccountNotFoundException;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailAttachmentRepository;
import com.workplace.mail.repository.EmailContentRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import jakarta.mail.Folder;
import jakarta.mail.Message;
import jakarta.mail.Store;
import jakarta.mail.UIDFolder;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

/**
 * IMAP 공급자용 {@link MailBodyLoader} 구현. IMAP 에 UID 로 재접속해 본문·스니펫·첨부를 파싱하고 DB 에 캐시한다.
 *
 * <p>네트워크 I/O(IMAP 연결·본문 다운로드)는 트랜잭션 밖에서 수행해 DB 커넥션을 점유하지 않도록 한다(#232). 비밀번호 복호화는 loader 내부에서 처리한다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ImapBodyLoader implements MailBodyLoader {

  private final EmailAccountRepository accountRepo;
  private final EmailMessageRepository messageRepo;

  /** Task5: 본문·스니펫을 email_content 에 기록한다. */
  private final EmailContentRepository contentRepo;

  private final EmailAttachmentRepository attachmentRepo;
  private final EncryptionService encryption;
  private final ImapConnector imapConnector;
  private final MailMessageParser parser;

  @Override
  public MailProvider provider() {
    return MailProvider.IMAP;
  }

  /**
   * IMAP 에서 단건 메시지 본문을 적재한다. INBOX 폴더를 UID 로 조회해 본문·스니펫·첨부를 파싱하고 DB 에 캐시한다. 서버에서 사라진 메시지는 빈 본문으로
   * 표시해 영구 재시도를 방지한다. 네트워크/파싱 실패는 삼킨다(best-effort).
   *
   * <p>Task5: 본문·스니펫은 email_content 에 기록(contentRepo.updateBody). has_attachment 만 envelope 에 남긴다.
   * contentId 가 0 이면 content 행이 미연결된 legacy envelope — 적재 불가(false 반환)해 재시도 가능 상태로 유지한다.
   *
   * @return true: 적재 성공(contentRepo.updateBody 호출 완료). false: 네트워크/파싱 실패 또는 contentId 미연결. 적재 실패 시
   *     빈 스니펫으로 분류되면 영구 오분류 → 디스패처가 false 확인 후 분류 skip(I1 수정).
   */
  @Override
  public boolean loadBody(long userId, BodyTarget target, EmailAccountResponse account) {
    // contentId=0: content 행이 연결되지 않은 legacy envelope — 본문 저장 불가
    if (target.contentId() == 0L) {
      log.warn("본문 적재 대상 메시지에 content_id 가 없음 — 적재 skip (messageId={})", target.messageId());
      return false;
    }

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
        // 서버에서 사라진 메시지 — 빈 본문으로 content 에 적재 표시해 영구 재시도(무한 정지)를 방지한다.
        // V97: per-envelope fetched_at 도 설정해 이 envelope 가 루프에서 재선택되지 않도록 한다.
        log.warn("본문 적재 대상 메시지 없음 (messageId={}, uid={})", target.messageId(), target.imapUid());
        contentRepo.updateBody(target.contentId(), null, null, null);
        messageRepo.markHasAttachment(target.messageId(), false);
        messageRepo.markFetched(target.messageId()); // V97: per-envelope 마커
        return true;
      }
      ParsedBody body = parser.parseBody(msg);
      // 본문·스니펫은 공유 content 에 기록 — 같은 message_id 를 수신한 다른 envelope 도 즉시 본문 보유
      contentRepo.updateBody(target.contentId(), body.bodyText(), body.bodyHtml(), body.snippet());
      // has_attachment 는 envelope 속성(첨부 존재 표시)으로 유지
      messageRepo.markHasAttachment(target.messageId(), body.hasAttachment());
      for (ParsedAttachment a : body.attachments()) {
        attachmentRepo.insert(target.messageId(), a);
      }
      // V97: per-envelope 마커 — 이 envelope 의 첨부 적재가 완료됐음을 기록
      messageRepo.markFetched(target.messageId());
      return true;
    } catch (Exception e) {
      // 자격증명 노출 방지를 위해 messageId 와 예외 요약만 기록한다.
      // false 반환 — 적재 실패 시 분류 skip(빈 스니펫 기반 영구 오분류 방지).
      log.warn("본문 적재 실패 (messageId={}): {}", target.messageId(), e.toString());
      return false;
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
