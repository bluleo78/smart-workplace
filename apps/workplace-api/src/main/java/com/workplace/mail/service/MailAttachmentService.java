package com.workplace.mail.service;

import com.workplace.global.security.EncryptionService;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.exception.EmailAttachmentNotFoundException;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailAttachmentRepository;
import com.workplace.mail.repository.EmailAttachmentRepository.AttachmentDownloadContext;
import jakarta.mail.Folder;
import jakarta.mail.Message;
import jakarta.mail.Store;
import jakarta.mail.UIDFolder;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 메일 첨부 파일 다운로드 서비스. DB 에 저장된 첨부 메타(ordinal)를 기반으로 IMAP 에서 해당 파트의 바이너리를 재조회해 반환한다. ordinal 은 {@link
 * EmailAttachmentRepository} 의 id 오름차순과 {@link MailMessageParser} 의 MIME DFS 순서가 일치함을 활용한다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class MailAttachmentService {

  private final EmailAttachmentRepository attachmentRepo;
  private final EmailAccountRepository accountRepo;
  private final EncryptionService encryption;
  private final ImapConnector imapConnector;
  private final MailMessageParser parser;

  /** 다운로드 결과 캐리어. */
  public record AttachmentDownload(byte[] content, String filename, String contentType) {}

  /**
   * 첨부 파일 바이너리 다운로드. 소유 검증 포함. imap_uid 가 없는 로컬 보낸메일이나 IMAP 재조회 실패 시 404/500 반환.
   *
   * <p>RLS GUC 주입 위해 @Transactional(readOnly) 필요 — 없으면 소유 검증 SELECT 가 빈 결과 → 거짓 404(local/prod
   * fail-closed). DB 쓰기는 없어 readOnly. <b>트레이드오프</b>: IMAP 왕복 동안 DB 커넥션을 점유한다 — 짧은-트랜잭션 리팩터링은 후속
   * 과제(#230 보고서 참조).
   */
  @Transactional(readOnly = true)
  public AttachmentDownload download(long userId, long attachmentId) {
    AttachmentDownloadContext ctx =
        attachmentRepo
            .findContextForDownload(userId, attachmentId)
            .orElseThrow(() -> new EmailAttachmentNotFoundException(attachmentId));

    // 로컬에서 작성한 보낸메일(imap_uid=0) — IMAP 에 파트 없으므로 404.
    if (ctx.imapUid() == 0L) {
      throw new EmailAttachmentNotFoundException(attachmentId);
    }

    EmailAccountResponse account =
        accountRepo
            .findByIdAndUser(userId, ctx.accountId())
            .orElseThrow(() -> new EmailAttachmentNotFoundException(attachmentId));
    String password =
        accountRepo
            .findEncryptedPassword(userId, ctx.accountId())
            .map(encryption::decrypt)
            .orElseThrow(() -> new EmailAttachmentNotFoundException(attachmentId));

    Store store = null;
    Folder folder = null;
    try {
      store = imapConnector.connect(account, password);
      folder = store.getFolder(ctx.folderName());
      folder.open(Folder.READ_ONLY);
      Message msg = ((UIDFolder) folder).getMessageByUID(ctx.imapUid());
      if (msg == null) {
        log.warn("첨부 다운로드: IMAP 메시지 없음 (attachmentId={}, uid={})", attachmentId, ctx.imapUid());
        throw new EmailAttachmentNotFoundException(attachmentId);
      }

      byte[] content = parser.extractAttachmentBytes(msg, ctx.ordinal());
      if (content == null) {
        log.warn("첨부 다운로드: ordinal 불일치 (attachmentId={}, ordinal={})", attachmentId, ctx.ordinal());
        throw new EmailAttachmentNotFoundException(attachmentId);
      }

      String filename = ctx.filename() != null ? ctx.filename() : "attachment";
      String contentType =
          ctx.contentType() != null ? ctx.contentType() : "application/octet-stream";
      return new AttachmentDownload(content, filename, contentType);
    } catch (EmailAttachmentNotFoundException e) {
      throw e;
    } catch (Exception e) {
      log.warn("첨부 다운로드 실패 (attachmentId={}): {}", attachmentId, e.toString());
      throw new RuntimeException("첨부 파일 다운로드에 실패했습니다", e);
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
      // 리소스 정리 — 결과에 영향 없음
    }
    try {
      if (store != null) {
        store.close();
      }
    } catch (Exception ignored) {
      // 리소스 정리 — 결과에 영향 없음
    }
  }
}
