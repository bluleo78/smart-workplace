package com.workplace.mail.service;

import com.workplace.file.api.StagedFileClaimer;
import com.workplace.file.dto.StagedFileResponse;
import com.workplace.file.service.StagedUploadService;
import com.workplace.mail.dto.ComposeAttachmentResponse;
import com.workplace.mail.exception.MailValidationException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

/**
 * 메일 작성 첨부 임시 업로드(WP-574) — 작성창이 파일을 먼저 올려 id 를 받고, 발송 때 {@code attachmentIds} 로 넘긴다.
 *
 * <p>스테이징 파일(WP-421)과 같은 모양의 FILE 행을 만든다: 업로더 = 호출자, category ATTACHMENT, 경로 {@code
 * tenant-*&#47;staged/…}, 만료 = 지금 + {@code temp-expiry-hours}(24). 그래서 발송 쪽은 {@link
 * StagedFileClaimer} 로 소유·만료·미사용을 그대로 검증하고, 보내지 않은 파일은 일반 만료 스윕({@code FileCleanupService})이 지운다.
 *
 * <p>경로를 {@code tenant-*&#47;mail} 아래에 두면 안 된다 — 메일 첨부 캐시 GC 의 고아 파일 백스톱({@link
 * MailAttachmentBlobGcSweeper})이 blob 행 없는 파일을 1시간 뒤 지운다.
 */
@Service
public class MailComposeAttachmentService {

  private final StagedUploadService stagedUploadService;

  /** 파일 하나 상한 — 첨부 일률 25MB(메일 한 통 합계 상한과 같은 값). */
  private final long maxFileBytes;

  public MailComposeAttachmentService(
      StagedUploadService stagedUploadService,
      @Value("${workplace.storage.attachment.max-file-size-bytes:26214400}") long maxFileBytes) {
    this.stagedUploadService = stagedUploadService;
    this.maxFileBytes = maxFileBytes;
  }

  /**
   * 파일 하나를 임시 첨부로 저장한다 — 저장·FILE 행은 스테이징 업로드({@link StagedUploadService#createFromMultipart})에 맡기고,
   * 메일 상한(파일 하나 25MB)만 메일 문구로 먼저 본다.
   *
   * @throws MailValidationException 파일 없음·25MB 초과(400)
   */
  public ComposeAttachmentResponse upload(long callerId, MultipartFile file) {
    if (file == null) {
      throw new MailValidationException("첨부할 파일을 골라 주세요");
    }
    if (file.getSize() > maxFileBytes) {
      throw new MailValidationException(
          "파일은 하나에 " + (maxFileBytes / (1024 * 1024)) + "MB까지 첨부할 수 있어요");
    }
    StagedFileResponse staged = stagedUploadService.createFromMultipart(callerId, file);
    return new ComposeAttachmentResponse(
        staged.fileId(), staged.name(), staged.sizeBytes(), staged.mimeType(), staged.expiresAt());
  }
}
