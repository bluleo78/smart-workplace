package com.workplace.mail.service;

import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.dto.OutgoingMail;
import com.workplace.mail.dto.OutgoingMail.AttachmentPart;
import com.workplace.mail.dto.OutgoingMail.InlineImagePart;
import com.workplace.mail.dto.ParsedAttachment;
import com.workplace.mail.repository.EmailAttachmentRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.repository.MailAttachmentBlobRepository;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 보낸 메일 첨부 기록(WP-574) — 로컬 SENT 행이 받은 메일처럼 첨부 목록을 보여 주고 내려받을 수 있게 한다.
 *
 * <p>받은 메일 첨부와 같은 3층 저장을 쓴다: email_attachment(봉투) → content_attachment(manifest, content_hash) →
 * mail_attachment_blob(암호화 바이너리). 받은 메일과 다른 점은 원본 서버에서 다시 받을 좌표가 없다는 것(imap_uid·provider_message_id
 * 모두 NULL)이라 blob 이 유일한 사본이다 — 그래서 {@link MailAttachmentBlobGcSweeper} 는 로컬 보낸 메일이 참조하는 blob 을 TTL
 * 로 지우지 않는다(참조가 사라지면 refcount-0 으로 지운다).
 *
 * <p>전송이 <b>성공한 뒤</b>에만 돈다. {@link MailAttachmentService#downloadForPreview} 와 같은 순서로 나눈다: {@link
 * #prepare} (트랜잭션 밖) 가 해시를 정하고(이미 아는 캐시 키는 다시 계산하지 않는다) 없는 blob 의 암호화 파일을 쓰고, {@link #record}(기록
 * 트랜잭션 안) 는 행만 넣는다. 기록이 실패해도 발송 결과는 뒤집히지 않는다(호출자가 경고만 남긴다) — 이미 쓴 파일은 행 없는 고아로 남아 GC 백스톱이 지운다.
 */
@Component
@RequiredArgsConstructor
public class MailSentAttachmentRecorder {

  private final MailAttachmentBlobStore blobStore;
  private final MailAttachmentBlobRepository blobRepo;
  private final EmailAttachmentRepository attachmentRepo;
  private final EmailMessageRepository messageRepo;
  private final PlatformTransactionManager txManager;

  /**
   * 기록할 첨부 1건(MIME DFS 순서).
   *
   * @param fileRef 이번에 새로 쓴 blob 파일(같은 해시 blob 이 이미 있었으면 null — 재사용)
   */
  public record PreparedAttachment(
      String filename,
      String contentType,
      String mimeContentId,
      byte[] content,
      String contentHash,
      String fileRef) {}

  /**
   * 트랜잭션 밖 준비 — 순서는 MIME DFS(인용문 인라인 이미지 → 일반 첨부)라 받은 메일 파서가 같은 MIME 을 읽은 순서와 같다. 해시는 파트가 이미 알면 그
   * 값을 쓰고, 없는 blob 만 암호화 파일을 쓴다(존재 확인은 짧은 읽기 트랜잭션 한 번).
   */
  public List<PreparedAttachment> prepare(OutgoingMail mail) {
    List<PreparedAttachment> parts = new ArrayList<>();
    for (InlineImagePart img : mail.inlineImages()) {
      parts.add(
          new PreparedAttachment(
              img.filename(),
              img.contentType(),
              img.contentId(),
              img.content(),
              hashOf(img.contentHash(), img.content()),
              null));
    }
    for (AttachmentPart att : mail.attachments()) {
      parts.add(
          new PreparedAttachment(
              att.filename(),
              att.contentType(),
              null,
              att.content(),
              hashOf(att.contentHash(), att.content()),
              null));
    }
    if (parts.isEmpty()) {
      return parts;
    }
    TransactionTemplate readTx = new TransactionTemplate(txManager);
    readTx.setReadOnly(true);
    Set<String> existing =
        readTx.execute(
            s ->
                blobRepo.existingHashes(
                    parts.stream().map(PreparedAttachment::contentHash).toList()));
    Set<String> written = new HashSet<>();
    List<PreparedAttachment> out = new ArrayList<>(parts.size());
    for (PreparedAttachment p : parts) {
      // 같은 메일 안 같은 바이트는 한 번만 쓴다
      boolean write = !existing.contains(p.contentHash()) && written.add(p.contentHash());
      String fileRef =
          write ? blobStore.store(TenantContext.get(), p.contentHash(), p.content()) : null;
      out.add(
          new PreparedAttachment(
              p.filename(),
              p.contentType(),
              p.mimeContentId(),
              p.content(),
              p.contentHash(),
              fileRef));
    }
    return out;
  }

  /**
   * SENT 행에 첨부를 잇는다(기록 트랜잭션 안 — 행만). 새로 쓴 파일은 blob 행을 등록하고, 재사용하는 blob 은 TTL 을 갱신한다(존재 확인과 갱신이 한
   * UPDATE). 준비 뒤 그 사이 GC 가 blob 을 지웠으면 여기서 파일을 다시 쓴다(드문 경합). 첨부가 하나라도 있으면 has_attachment 를 켠다.
   */
  public void record(long messageId, long contentId, List<PreparedAttachment> prepared) {
    for (int i = 0; i < prepared.size(); i++) {
      PreparedAttachment p = prepared.get(i);
      if (p.fileRef() != null) {
        // ON CONFLICT DO NOTHING — 그 사이 같은 해시를 다른 요청이 등록했으면 이 파일은 고아가 되어 GC 백스톱이 지운다.
        blobRepo.insertIfAbsent(p.contentHash(), p.fileRef(), p.content().length);
      } else if (!blobRepo.touch(p.contentHash())) {
        blobRepo.insertIfAbsent(
            p.contentHash(),
            blobStore.store(TenantContext.get(), p.contentHash(), p.content()),
            p.content().length);
      }
      attachmentRepo.insert(
          messageId,
          contentId,
          i,
          new ParsedAttachment(
              p.filename(), p.contentType(), p.content().length, p.mimeContentId(), null),
          p.contentHash());
    }
    if (!prepared.isEmpty()) {
      messageRepo.markHasAttachment(messageId, true);
    }
  }

  private static String hashOf(String known, byte[] content) {
    return known != null ? known : MailAttachmentService.sha256Hex(content);
  }
}
