package com.workplace.mail.service;

import com.workplace.global.security.EncryptionService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.exception.EmailAttachmentNotFoundException;
import com.workplace.mail.outbound.GraphApiClient;
import com.workplace.mail.repository.ContentAttachmentRepository;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailAttachmentRepository;
import com.workplace.mail.repository.EmailAttachmentRepository.AttachmentDownloadContext;
import com.workplace.mail.repository.MailAttachmentBlobRepository;
import jakarta.mail.Folder;
import jakarta.mail.Message;
import jakarta.mail.Store;
import jakarta.mail.UIDFolder;
import java.security.MessageDigest;
import java.util.Base64;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 메일 첨부 파일 다운로드 서비스. DB 에 저장된 첨부 메타(ordinal)를 기반으로 IMAP 또는 Graph API 에서 바이너리를 재조회해 반환한다.
 *
 * <p>cache hit/miss/재fetch/TTL 슬라이딩/25MB knob 를 구현한다(slice③). provider fetch 는 content_hash 기반 blob
 * 캐시가 miss 일 때만 발생한다.
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
  private final MailAttachmentBlobRepository blobRepo;
  private final MailAttachmentBlobStore blobStore;
  private final ContentAttachmentRepository contentAttachmentRepo;

  /** 첨부 캐시 최대 크기(바이트). 초과하는 첨부는 매번 provider 에서 재fetch 하고 blob 에 저장하지 않는다. 기본값 25MiB(26214400). */
  @Value("${workplace.storage.mail.max-cache-bytes:26214400}")
  private long maxCacheBytes;

  /** 다운로드 결과 캐리어. */
  public record AttachmentDownload(byte[] content, String filename, String contentType) {}

  /**
   * 첨부 파일 바이너리 다운로드. 소유 검증 포함. 캐시 hit 시 blob 에서 즉시 반환, miss 시 provider fetch 후 캐시에 등록한다.
   *
   * <p>RLS GUC 주입 위해 @Transactional 필요 — 없으면 소유 검증 SELECT 가 빈 결과 → 거짓 404(local/prod fail-closed).
   * <b>readOnly 아닌 이유</b>: touch/insertIfAbsent/setContentHashIfNull/Graph 토큰갱신 등 쓰기 가 발생하므로
   * readOnly=true 이면 실패한다.
   *
   * <p>provider 로 IMAP/Graph 경로를 분기한다.
   */
  @Transactional
  public AttachmentDownload download(long userId, long attachmentId) {
    // §3 소유 검증 — userId 미소유/없음이면 empty → 404
    AttachmentDownloadContext ctx =
        attachmentRepo
            .findContextForDownload(userId, attachmentId)
            .orElseThrow(() -> new EmailAttachmentNotFoundException(attachmentId));

    String filename = ctx.filename() != null ? ctx.filename() : "attachment";
    String contentType = ctx.contentType() != null ? ctx.contentType() : "application/octet-stream";

    // 1) 캐시 hit: content_hash 가 있고 blob 행이 존재하면 provider fetch 없이 서빙.
    if (ctx.contentHash() != null) {
      var hit = blobRepo.findByHash(ctx.contentHash());
      if (hit.isPresent()) {
        // 슬라이딩 TTL 갱신
        blobRepo.touch(ctx.contentHash());
        byte[] cached = blobStore.load(hit.get().fileRef());
        return new AttachmentDownload(cached, filename, contentType);
      }
    }

    // 2) miss: 요청자(caller) 좌표로 provider 에서 fetch.
    byte[] content = fetchFromProvider(userId, ctx, attachmentId);

    // 3) 25MB knob: 대용량은 캐시하지 않고 그대로 서빙(blob 미영속).
    //    legacy unmanifested row(contentAttachmentId==0)도 캐시하지 않는다.
    if (content.length <= maxCacheBytes && ctx.contentAttachmentId() != 0) {
      String hash = sha256Hex(content);
      long tenantId = TenantContext.get();
      String fileRef = blobStore.store(tenantId, hash, content);
      // ON CONFLICT DO NOTHING — 동시 경쟁 흡수. 패배 시 fileRef 는 orphan → GC 스윕 처리.
      blobRepo.insertIfAbsent(hash, fileRef, content.length);
      // 불변 content_hash 1회 기록(이미 non-null 이면 NO-OP).
      contentAttachmentRepo.setContentHashIfNull(ctx.contentAttachmentId(), hash);
    }

    return new AttachmentDownload(content, filename, contentType);
  }

  /**
   * provider 분기 — IMAP 또는 Graph 에서 바이트를 가져온다. 404 가드(imapUid==0, providerMessageId==null 등)는 내부에서
   * 처리한다.
   */
  private byte[] fetchFromProvider(long userId, AttachmentDownloadContext ctx, long attachmentId) {
    if ("M365_GRAPH".equals(ctx.provider())) {
      return graphBytes(userId, ctx, attachmentId);
    }
    // 로컬에서 작성한 보낸메일(imap_uid=0) — IMAP 에 파트 없으므로 404.
    if (ctx.imapUid() == 0L) {
      throw new EmailAttachmentNotFoundException(attachmentId);
    }
    return imapBytes(userId, ctx, attachmentId);
  }

  /**
   * Graph API 에서 첨부 바이트를 가져온다. GET /me/messages/{msgId}/attachments/{attachId} — ordinal 의존 없이 안정
   * id 기반. contentBytes 는 base64 인코딩되어 있어 디코드해 반환한다.
   *
   * <p>V91 이전 동기화 행(provider_attachment_id=null)은 404 처리한다.
   */
  private byte[] graphBytes(long userId, AttachmentDownloadContext ctx, long attachmentId) {
    if (ctx.providerMessageId() == null) {
      log.warn("Graph 첨부 다운로드: provider_message_id 없음 (attachmentId={})", attachmentId);
      throw new EmailAttachmentNotFoundException(attachmentId);
    }
    if (ctx.providerAttachmentId() == null) {
      log.warn(
          "Graph 첨부 다운로드: provider_attachment_id 없음(V91 이전 동기화 행) (attachmentId={})", attachmentId);
      throw new EmailAttachmentNotFoundException(attachmentId);
    }
    try {
      String accessToken = graphTokenService.getAccessToken(userId, ctx.accountId());
      String url =
          "/me/messages/" + ctx.providerMessageId() + "/attachments/" + ctx.providerAttachmentId();
      GraphAttachment attachment = graphApiClient.get(accessToken, url, GraphAttachment.class);

      if (attachment == null || attachment.contentBytes() == null) {
        log.warn("Graph 첨부 다운로드: contentBytes 없음 (attachmentId={})", attachmentId);
        throw new EmailAttachmentNotFoundException(attachmentId);
      }
      return Base64.getDecoder().decode(attachment.contentBytes());
    } catch (EmailAttachmentNotFoundException e) {
      throw e;
    } catch (Exception e) {
      log.warn("Graph 첨부 다운로드 실패 (attachmentId={}): {}", attachmentId, e.toString());
      throw new RuntimeException("Graph 첨부 파일 다운로드에 실패했습니다", e);
    }
  }

  /** IMAP 에서 첨부 바이트를 가져온다. */
  private byte[] imapBytes(long userId, AttachmentDownloadContext ctx, long attachmentId) {
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
      return content;
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
   * SHA-256 hex 다이제스트. 첨부 바이트의 content_hash 계산에 사용한다. MessageDigest 는 스레드-안전하지 않으므로 매번 new 인스턴스를
   * 생성한다(성능 트레이드오프 vs 동시성).
   */
  static String sha256Hex(byte[] data) {
    try {
      MessageDigest md = MessageDigest.getInstance("SHA-256");
      byte[] digest = md.digest(data);
      StringBuilder sb = new StringBuilder(digest.length * 2);
      for (byte b : digest) {
        sb.append(String.format("%02x", b));
      }
      return sb.toString();
    } catch (Exception e) {
      throw new RuntimeException("SHA-256 계산 실패", e);
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
