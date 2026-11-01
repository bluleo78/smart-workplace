package com.workplace.mail.service;

import com.workplace.fileai.ExtractableTypes;
import com.workplace.fileai.ExtractionProfile;
import com.workplace.fileai.dto.ExtractedTextSlice;
import com.workplace.fileai.dto.ExtractionInfo;
import com.workplace.fileai.exception.InvalidTextRangeException;
import com.workplace.fileai.inbound.FileExtractionRequestedEvent;
import com.workplace.fileai.security.FileSecurityCheckService;
import com.workplace.fileai.security.dto.SecurityCheckView;
import com.workplace.fileai.service.ExtractedTextService;
import com.workplace.global.util.AfterCommit;
import com.workplace.mail.repository.ContentAttachmentRepository;
import com.workplace.mail.repository.ContentAttachmentRepository.ExtractTarget;
import com.workplace.mail.service.MailAttachmentResolver.Resolved;
import java.util.List;
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

  private final MailAttachmentResolver resolver;
  private final ContentAttachmentRepository contentAttachmentRepo;
  private final MailAttachmentService attachmentService;
  private final MailExtractCopyStore copyStore;
  private final ApplicationEventPublisher eventPublisher;
  private final ExtractedTextService extractedText;
  private final FileSecurityCheckService securityChecks;

  /** 점검 행이 없을 때의 응답(status null) — 사본이 아직 없거나 키를 둘 manifest 가 없는 첨부. */
  private static final SecurityCheckView EMPTY_CHECK =
      new SecurityCheckView(null, null, null, List.of(), null, null);

  /** AI 가 없는 워크스페이스의 요청 응답 — 행을 만들지 않는다. */
  private static final SecurityCheckView NO_AI_CHECK =
      new SecurityCheckView(null, null, null, List.of(), null, SecurityCheckView.REASON_NO_AI);

  /** 원본이 사본 상한(25MiB)을 넘어 점검할 수 없을 때의 응답 — 점검 상한(20MB) 초과와 같은 FAILED·TOO_LARGE 로 보인다. */
  private static final SecurityCheckView TOO_LARGE_CHECK =
      new SecurityCheckView(
          "FAILED", null, null, List.of(), null, SecurityCheckView.REASON_TOO_LARGE);

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
    // 소유 확인(아니면 404)·판정용 mime·manifest 사본 링크 — /view 와 같은 해석(MailAttachmentResolver).
    Resolved r = resolver.resolve(userId, attachmentId);
    // 사본 생성·fetch 전에 구간을 먼저 검증한다 — 잘못된 요청이 provider 왕복을 일으키지 않게.
    if (offset < 0) throw new InvalidTextRangeException("offset 은 0 이상이어야 합니다.");
    if (limit < 1) throw new InvalidTextRangeException("limit 은 1 이상이어야 합니다.");

    // manifest 없는 레거시 행(V100 이전 동기화)이나 manifest 행이 없으면 사본 링크를 둘 곳이 없다 — 추출 없음(NONE).
    ExtractTarget target = r.target();
    if (target == null) return status(attachmentId, offset, ExtractionInfo.NONE);

    // 1) 유효한 사본이 있으면 바로 읽는다(빠른 경로 — 잠금·fetch 없음). 만료는 연장하지 않는다(생성 기준 고정 수명).
    if (target.extractFileId() != null && copyStore.isLive(target.extractFileId())) {
      return read(attachmentId, target.extractFileId(), offset, limit);
    }

    // 2) 추출 불가 형식·과대 파일은 바이트를 가져오지 않고 바로 SKIPPED — 사유 문구는 공용 ExtractionReasons 를 그대로 쓴다.
    String mime = r.mime();
    if (!ExtractableTypes.supports(mime)) {
      return skipped(attachmentId, offset, ExtractableTypes.skipReason(mime), mime);
    }
    // 사전 크기 차단(IMAP 은 base64 여유, Graph 는 정확) — 정확한 판정은 fetch 후.
    if (r.exceedsBeforeFetch(maxFileSize)) {
      return skipped(attachmentId, offset, "oversize", mime);
    }

    // 3) 사본 확보(없으면 원본을 받아 만든다). 받은 원본이 상한을 넘으면 사본 없이 SKIPPED.
    Copy copy = ensureCopy(userId, attachmentId, r);
    if (copy.fileId() == null) {
      return skipped(attachmentId, offset, "oversize", mime);
    }
    return read(attachmentId, copy.fileId(), offset, limit);
  }

  /**
   * HTML 보안 점검 조회(WP-1262). 권한은 /content 와 같다(본인 소유 아니면 404). 점검 결과는 메일 사본 file id 에 달리므로 사본이 아직
   * 없으면 행 없음(status null)으로 돌려준다 — 조회는 원본을 받지 않는다.
   */
  @Transactional(readOnly = true)
  public SecurityCheckView securityCheck(long userId, long attachmentId) {
    Resolved r = resolver.resolve(userId, attachmentId);
    Long copyId = r.target() == null ? null : r.target().extractFileId();
    return copyId == null ? EMPTY_CHECK : securityChecks.view(copyId);
  }

  /**
   * HTML 보안 점검 요청(WP-1262). 사본 file 을 확보해(/text 와 공유 — 없으면 원본을 받아 만든다) 그 id 로 점검 행을 만들고, 사본 바이너리는
   * 추출 직후 지워지므로 원본 바이트로 바로 점검한다. manifest 없는 레거시 첨부는 키를 둘 곳이 없어 행 없음, 원본이 사본 상한을 넘으면 TOO_LARGE.
   *
   * <p>AI 가 없는 워크스페이스는 원본 받기·사본 만들기 전에 NO_AI 로 끝낸다(그래서 NO_AI 가 TOO_LARGE 보다 먼저) — 어차피 점검할 수 없는데
   * provider 왕복·사본 file 을 만들 까닭이 없다. 이미 있는 사본의 결과는 조회와 같이 보인다.
   */
  @Transactional
  public SecurityCheckView requestSecurityCheck(long userId, long attachmentId) {
    Resolved r = resolver.resolve(userId, attachmentId);
    if (!securityChecks.aiAvailable()) {
      Long copyId = r.target() == null ? null : r.target().extractFileId();
      return copyId == null ? NO_AI_CHECK : securityChecks.view(copyId);
    }
    if (r.target() == null) return EMPTY_CHECK;
    if (r.exceedsBeforeFetch(maxFileSize)) return TOO_LARGE_CHECK;
    Copy copy = ensureCopy(userId, attachmentId, r);
    if (copy.fileId() == null) return TOO_LARGE_CHECK;
    if (copy.bytes() == null) {
      // 이미 끝난 점검(DONE)은 요청해도 그대로라 원본을 받지 않고 바로 돌려준다. SKIPPED 는 요청하면 다시 점검하므로 원본이 필요하다.
      SecurityCheckView current = securityChecks.view(copy.fileId());
      if ("DONE".equals(current.status())) return current;
    }
    // 이미 살아 있는 사본을 썼으면 이번에 받은 바이트가 없다 — /content 와 같은 경로로 원본을 받는다(캐시 hit 이면 provider 왕복 없음).
    byte[] bytes =
        copy.bytes() != null
            ? copy.bytes()
            : attachmentService.download(userId, attachmentId).content();
    return securityChecks.requestWithBytes(copy.fileId(), filenameOf(r), bytes);
  }

  /**
   * 사본 확보 결과. {@code fileId} 가 null 이면 받은 원본이 상한을 넘어 사본을 만들지 않았다. {@code bytes} 는 이번 호출에서 원본을 받았을
   * 때만 채운다(살아 있는 사본을 다시 쓰면 null) — 보안 점검이 같은 원본을 두 번 받지 않게.
   */
  private record Copy(Long fileId, byte[] bytes) {}

  /**
   * 메일 첨부의 평문 사본 file 을 확보한다 — /text 와 보안 점검이 같은 사본(content_attachment.extract_file_id)을 쓴다. 유효한
   * 사본이 있으면 그대로, 없으면 원본을 받아 만들고 추출을 요청한다. {@code r.target()} 은 null 이 아니어야 한다.
   *
   * <p>추출 불가 형식(예: octet-stream 인 .html)도 사본을 만든다 — 추출 행은 SKIPPED 로 남고(사본이 살아 있는 동안 /text 는 빠른 경로로
   * 그 SKIPPED 추출 행을 읽는다), 평문 바이너리는 쓸 곳이 없으니 커밋 뒤 바로 지운다(추출 확정 이벤트가 없어 Releaser 가 지우지 않는다).
   */
  private Copy ensureCopy(long userId, long attachmentId, Resolved r) {
    ExtractTarget target = r.target();
    if (target.extractFileId() != null && copyStore.isLive(target.extractFileId())) {
      return new Copy(target.extractFileId(), null);
    }
    long caId = r.ctx().contentAttachmentId();
    // 같은 첨부의 동시 첫 요청을 직렬화하고, 잠금 뒤 링크를 다시 본다(다른 요청이 방금 만들었을 수 있다).
    contentAttachmentRepo.lockForExtract(caId);
    Long linked =
        contentAttachmentRepo
            .findExtractTarget(caId)
            .map(ExtractTarget::extractFileId)
            .orElse(null);
    if (linked != null && copyStore.isLive(linked)) {
      return new Copy(linked, null);
    }
    // 바이트 확보는 /content 와 같은 경로 — 캐시 hit 이면 blob 복호화, miss 면 provider fetch 후 캐시 등록. 소유 검증도 다시 거친다.
    byte[] content = attachmentService.download(userId, attachmentId).content();
    if (content.length > maxFileSize) {
      return new Copy(null, content);
    }
    String mime = r.mime();
    long fileId = copyStore.store(content, filenameOf(r), mime, userId);
    contentAttachmentRepo.linkExtractFile(caId, fileId);
    // 같은 트랜잭션에서 추출 행(PENDING/SKIPPED)이 생기고, 커밋 후 워커로 디스패치된다(실패해도 FileExtractionScheduler 백스톱이 재시도).
    eventPublisher.publishEvent(
        FileExtractionRequestedEvent.of(fileId, mime, ExtractionProfile.TEXT_ONLY));
    if (!ExtractableTypes.supports(mime)) {
      copyStore
          .copyStoragePath(fileId)
          .ifPresent(p -> AfterCommit.run(() -> copyStore.deleteBinary(p)));
    }
    return new Copy(fileId, content);
  }

  private static String filenameOf(Resolved r) {
    return r.ctx().filename() != null ? r.ctx().filename() : "attachment";
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
}
