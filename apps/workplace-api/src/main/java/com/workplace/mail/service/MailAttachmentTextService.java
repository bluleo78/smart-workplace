package com.workplace.mail.service;

import com.workplace.file.service.MimeNormalizer;
import com.workplace.fileai.ExtractableTypes;
import com.workplace.fileai.ExtractionProfile;
import com.workplace.fileai.dto.ExtractedTextSlice;
import com.workplace.fileai.dto.ExtractionInfo;
import com.workplace.fileai.exception.InvalidTextRangeException;
import com.workplace.fileai.inbound.FileExtractionRequestedEvent;
import com.workplace.fileai.service.ExtractedTextService;
import com.workplace.mail.exception.EmailAttachmentNotFoundException;
import com.workplace.mail.repository.ContentAttachmentRepository;
import com.workplace.mail.repository.ContentAttachmentRepository.ExtractTarget;
import com.workplace.mail.repository.EmailAttachmentRepository;
import com.workplace.mail.repository.EmailAttachmentRepository.AttachmentDownloadContext;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 메일 첨부 추출 텍스트 구간 읽기(WP-358).
 *
 * <p>메일 첨부는 IMAP/Graph 에서 필요할 때 가져오며 코어 file 행이 없다. 그래서 첫 /text 요청 때 바이트를 가져와(첨부 캐시 hit 이면 provider
 * 왕복 없음) 평문 코어 file 사본으로 만들고 {@link FileExtractionRequestedEvent} 를 발행한다 — 이후는 이슈·챗 첨부와 같은 비동기 워커
 * 추출이라 첫 응답은 PENDING, 추출이 끝나면 READY. 사본 file id 는 content_attachment(같은 메일을 받은 사용자들이 공유하는 manifest)
 * 에 기록해 두 번째 요청부터는 fetch 없이 {@link ExtractedTextService#read} 만 한다.
 *
 * <p>응답 {@code fileId} 는 내부 사본 id 대신 호출자가 쓴 메일 attachmentId 를 돌려준다 — 사본은 만료로 다시 만들어질 수 있는 내부 식별자다.
 */
@Service
@RequiredArgsConstructor
public class MailAttachmentTextService {

  private final EmailAttachmentRepository attachmentRepo;
  private final ContentAttachmentRepository contentAttachmentRepo;
  private final MailAttachmentService attachmentService;
  private final MailExtractCopyStore copyStore;
  private final ApplicationEventPublisher eventPublisher;
  private final ExtractedTextService extractedText;

  /** 추출 대상 상한(바이트) — 이슈·메시징 첨부 업로드 상한과 같은 25MiB. 넘으면 사본을 만들지 않고 SKIPPED(TOO_LARGE). */
  @Value("${workplace.storage.attachment.max-file-size-bytes:26214400}")
  private long maxFileSize;

  /**
   * 첨부 추출 텍스트 구간 읽기. 권한은 /content 다운로드와 같다 — 본인 소유(활성 계정)의 첨부가 아니면 404(존재 은닉).
   *
   * <p>readOnly 가 아닌 이유: 첫 요청에 사본 file·추출 행 생성, 만료된 사본의 재생성이 일어난다. 첫 요청은 첨부 캐시 miss 면 /content 와
   * 똑같이 provider fetch 를 동기로 기다린다(추출 자체는 비동기).
   *
   * @throws InvalidTextRangeException offset &lt; 0 또는 limit &lt; 1
   */
  @Transactional
  public ExtractedTextSlice readText(long userId, long attachmentId, int offset, int limit) {
    AttachmentDownloadContext ctx =
        attachmentRepo
            .findContextForDownload(userId, attachmentId)
            .orElseThrow(() -> new EmailAttachmentNotFoundException(attachmentId));
    // 사본 생성·fetch 전에 구간을 먼저 검증한다 — 잘못된 요청이 provider 왕복을 일으키지 않게.
    if (offset < 0) throw new InvalidTextRangeException("offset 은 0 이상이어야 합니다.");
    if (limit < 1) throw new InvalidTextRangeException("limit 은 1 이상이어야 합니다.");

    long caId = ctx.contentAttachmentId();
    // manifest 없는 레거시 행(V100 이전 동기화)은 사본 링크를 둘 곳이 없다 — 추출 없음(NONE).
    if (caId == 0L) return status(attachmentId, offset, ExtractionInfo.NONE);
    ExtractTarget target = contentAttachmentRepo.findExtractTarget(caId).orElse(null);
    if (target == null) return status(attachmentId, offset, ExtractionInfo.NONE);

    // 1) 유효한 사본이 있으면 바로 읽는다(빠른 경로 — 잠금·fetch 없음). 만료는 연장하지 않는다(생성 기준 고정 수명).
    if (target.extractFileId() != null && copyStore.isLive(target.extractFileId())) {
      return read(attachmentId, target.extractFileId(), offset, limit);
    }

    // 2) 추출 불가 형식·과대 파일은 바이트를 가져오지 않고 바로 SKIPPED — 사유 문구는 공용 ExtractionReasons 를 그대로 쓴다.
    String mime = normalizeMime(ctx.filename(), ctx.contentType());
    if (!ExtractableTypes.supports(mime)) {
      return skipped(attachmentId, offset, ExtractableTypes.skipReason(mime), mime);
    }
    // size_bytes 는 IMAP 에선 전송 인코딩(base64) 기준이라 실제보다 약 4/3 크다 — 사전 차단은 그만큼 여유를 두고, 정확한 판정은 fetch 후.
    if (target.sizeBytes() != null && target.sizeBytes() > maxFileSize / 3 * 4 + 4096) {
      return skipped(attachmentId, offset, "oversize", mime);
    }

    // 3) 사본 생성 — 같은 첨부의 동시 첫 요청을 직렬화하고, 잠금 뒤 링크를 다시 본다(다른 요청이 방금 만들었을 수 있다).
    contentAttachmentRepo.lockForExtract(caId);
    Long linked =
        contentAttachmentRepo
            .findExtractTarget(caId)
            .map(ExtractTarget::extractFileId)
            .orElse(null);
    if (linked != null && copyStore.isLive(linked)) {
      return read(attachmentId, linked, offset, limit);
    }
    // 바이트 확보는 /content 와 같은 경로 — 캐시 hit 이면 blob 복호화, miss 면 provider fetch 후 캐시 등록. 소유 검증도 다시 거친다.
    byte[] content = attachmentService.download(userId, attachmentId).content();
    if (content.length > maxFileSize) {
      return skipped(attachmentId, offset, "oversize", mime);
    }
    String filename = ctx.filename() != null ? ctx.filename() : "attachment";
    long fileId = copyStore.store(content, filename, mime, userId);
    contentAttachmentRepo.linkExtractFile(caId, fileId);
    // 같은 트랜잭션에서 추출 행(PENDING)이 생기고, 커밋 후 워커로 디스패치된다(실패해도 FileExtractionScheduler 백스톱이 재시도).
    eventPublisher.publishEvent(
        FileExtractionRequestedEvent.of(fileId, mime, ExtractionProfile.TEXT_ONLY));
    return read(attachmentId, fileId, offset, limit);
  }

  /** 공용 구간 읽기 후 응답 fileId 를 메일 attachmentId 로 바꾼다(내부 사본 id 비노출). */
  private ExtractedTextSlice read(long attachmentId, long fileId, int offset, int limit) {
    ExtractedTextSlice s = extractedText.read(fileId, offset, limit);
    return new ExtractedTextSlice(
        attachmentId,
        s.status(),
        s.offset(),
        s.totalChars(),
        s.truncated(),
        s.nextOffset(),
        s.text(),
        s.reasonCode(),
        s.reason(),
        s.pageCount());
  }

  /** 사본 없이 SKIPPED 응답을 만든다 — 원시 사유(image:/unsupported-mime:/oversize)를 공용 분류기로 코드·문구로 바꾼다. */
  private static ExtractedTextSlice skipped(
      long attachmentId, int offset, String rawReason, String mime) {
    return status(
        attachmentId,
        offset,
        ExtractionInfo.of("SKIPPED", rawReason, mime, null, null, false, null));
  }

  /**
   * READY 가 아닌 상태 응답 — ExtractedTextService.read 의 비-READY 형태와 같다(text·totalChars·nextOffset 은
   * null).
   */
  private static ExtractedTextSlice status(long attachmentId, int offset, ExtractionInfo info) {
    return new ExtractedTextSlice(
        attachmentId,
        info.status(),
        offset,
        null,
        null,
        null,
        null,
        info.reasonCode(),
        info.reason(),
        info.pageCount());
  }

  /**
   * 메일 파트 Content-Type 을 추출 판정용 mime 으로 정규화한다. 파라미터(; name=…)를 떼고 소문자로 맞춘 뒤, 비었거나 octet-stream 이면
   * 파일명 확장자로 보정한다(이슈·챗 업로드와 같은 MimeNormalizer). ExtractableTypes 는 정확 일치라 이 정규화가 없으면 PDF 가 SKIPPED
   * 로 굳을 수 있다.
   */
  static String normalizeMime(String filename, String contentType) {
    // 기본형이 빈 값(Content-Type 없음)이면 normalize 가 null 과 같이 확장자로 보정한다.
    return MimeNormalizer.normalize(filename, MimeNormalizer.baseMime(contentType));
  }
}
