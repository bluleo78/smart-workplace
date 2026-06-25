package com.workplace.mail.service;

import com.workplace.global.security.EncryptionService;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.exception.EmailAttachmentNotFoundException;
import com.workplace.mail.outbound.GraphApiClient;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailAttachmentRepository;
import com.workplace.mail.repository.EmailAttachmentRepository.AttachmentDownloadContext;
import jakarta.mail.Folder;
import jakarta.mail.Message;
import jakarta.mail.Store;
import jakarta.mail.UIDFolder;
import java.util.Base64;
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
  private final GraphTokenService graphTokenService;
  private final GraphApiClient graphApiClient;

  /** 다운로드 결과 캐리어. */
  public record AttachmentDownload(byte[] content, String filename, String contentType) {}

  /**
   * 첨부 파일 바이너리 다운로드. 소유 검증 포함. imap_uid 가 없는 로컬 보낸메일이나 IMAP 재조회 실패 시 404/500 반환.
   *
   * <p>RLS GUC 주입 위해 @Transactional 필요 — 없으면 소유 검증 SELECT 가 빈 결과 → 거짓 404(local/prod fail-closed).
   * <b>readOnly 아닌 이유</b>: Graph 경로에서 {@link GraphTokenService#getAccessToken}이 토큰 만료 시 DB 에 토큰을 갱신
   * (UPDATE)하므로 readOnly=true 이면 write 가 차단되어 첨부 다운로드가 500 으로 실패한다. <b>트레이드오프</b>: IMAP 왕복 동안 DB
   * 커넥션을 점유한다 — 짧은-트랜잭션 리팩터링은 후속 과제(#230 보고서 참조).
   *
   * <p>provider 로 IMAP/Graph 경로를 분기한다. Graph 경로: provider_attachment_id 로 단건 직접 조회 → contentBytes
   * base64 디코드.
   */
  @Transactional
  public AttachmentDownload download(long userId, long attachmentId) {
    AttachmentDownloadContext ctx =
        attachmentRepo
            .findContextForDownload(userId, attachmentId)
            .orElseThrow(() -> new EmailAttachmentNotFoundException(attachmentId));

    // Graph 경로: provider_attachment_id 로 단건 직접 조회 → contentBytes 디코드
    if ("M365_GRAPH".equals(ctx.provider())) {
      return downloadFromGraph(userId, ctx, attachmentId);
    }

    // 로컬에서 작성한 보낸메일(imap_uid=0) — IMAP 에 파트 없으므로 404.
    if (ctx.imapUid() == 0L) {
      throw new EmailAttachmentNotFoundException(attachmentId);
    }

    return downloadFromImap(userId, ctx, attachmentId);
  }

  /**
   * Graph API 에서 첨부를 다운로드한다. GET /me/messages/{msgId}/attachments/{attachId} 로 단건 직접 조회 — ordinal
   * 의존 없이 안정 id 기반. contentBytes 는 base64 인코딩되어 있어 디코드해 반환한다.
   *
   * <p>V91 이전 동기화 행(provider_attachment_id=null)은 404 처리한다.
   */
  private AttachmentDownload downloadFromGraph(
      long userId, AttachmentDownloadContext ctx, long attachmentId) {
    if (ctx.providerMessageId() == null) {
      log.warn("Graph 첨부 다운로드: provider_message_id 없음 (attachmentId={})", attachmentId);
      throw new EmailAttachmentNotFoundException(attachmentId);
    }
    // V91 이전 동기화 행 — provider_attachment_id 없음 → 직접 조회 불가
    if (ctx.providerAttachmentId() == null) {
      log.warn(
          "Graph 첨부 다운로드: provider_attachment_id 없음(V91 이전 동기화 행) (attachmentId={})", attachmentId);
      throw new EmailAttachmentNotFoundException(attachmentId);
    }
    try {
      String accessToken = graphTokenService.getAccessToken(userId, ctx.accountId());
      // 단건 첨부 직접 조회 — 목록+ordinal 불필요. contentBytes 는 fileAttachment GET 에서 기본 반환
      String url =
          "/me/messages/" + ctx.providerMessageId() + "/attachments/" + ctx.providerAttachmentId();
      GraphAttachment attachment = graphApiClient.get(accessToken, url, GraphAttachment.class);

      if (attachment == null || attachment.contentBytes() == null) {
        log.warn("Graph 첨부 다운로드: contentBytes 없음 (attachmentId={})", attachmentId);
        throw new EmailAttachmentNotFoundException(attachmentId);
      }

      byte[] content = Base64.getDecoder().decode(attachment.contentBytes());
      String filename = ctx.filename() != null ? ctx.filename() : "attachment";
      String contentType =
          ctx.contentType() != null ? ctx.contentType() : "application/octet-stream";
      return new AttachmentDownload(content, filename, contentType);
    } catch (EmailAttachmentNotFoundException e) {
      throw e;
    } catch (Exception e) {
      log.warn("Graph 첨부 다운로드 실패 (attachmentId={}): {}", attachmentId, e.toString());
      throw new RuntimeException("Graph 첨부 파일 다운로드에 실패했습니다", e);
    }
  }

  /** IMAP 에서 첨부를 다운로드한다. */
  private AttachmentDownload downloadFromImap(
      long userId, AttachmentDownloadContext ctx, long attachmentId) {
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

  /**
   * Graph 단일 첨부 항목. GET /me/messages/{id}/attachments/{aid} 응답 역직렬화용. contentBytes 는 base64 인코딩된
   * 바이너리.
   */
  @com.fasterxml.jackson.annotation.JsonIgnoreProperties(ignoreUnknown = true)
  public record GraphAttachment(String name, String contentType, String contentBytes) {}

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
