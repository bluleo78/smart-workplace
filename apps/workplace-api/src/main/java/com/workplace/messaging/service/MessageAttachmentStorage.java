package com.workplace.messaging.service;

import static com.workplace.jooq.tables.File.FILE;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.UUID;
import org.jooq.DSLContext;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;

/**
 * 메시지 첨부 파일을 디스크에 저장하고 file 행을 임시(만료 설정)로 INSERT 한다.
 *
 * <p>IssueAttachmentStorage 와 달리 expires_at 을 설정해 미전송 파일이 FileCleanupService 에 의해 자동 정리되게 한다.
 */
@Component
public class MessageAttachmentStorage {

  private final DSLContext dsl;
  private final String uploadDir;
  private final int tempExpiryHours;

  public MessageAttachmentStorage(
      DSLContext dsl,
      @Value("${workplace.messaging.attachment.upload-dir:./uploads/messaging-attachments}")
          String uploadDir,
      @Value("${workplace.messaging.attachment.temp-expiry-hours:24}") int tempExpiryHours) {
    this.dsl = dsl;
    this.uploadDir = uploadDir;
    this.tempExpiryHours = tempExpiryHours;
  }

  /**
   * 파일을 임시로 저장. expires_at 을 now+tempExpiryHours 로 두어 미전송 시 자동 정리되게 한다.
   *
   * @param mf 업로드된 멀티파트 파일
   * @param uploaderId 업로드한 사용자 ID (file.uploaded_by FK)
   * @return 생성된 file 행의 ID
   */
  public Long storeTemporary(MultipartFile mf, Long uploaderId) throws IOException {
    // 원본 파일명 및 확장자 추출
    String originalName = mf.getOriginalFilename() != null ? mf.getOriginalFilename() : "file";
    String ext = extensionOf(originalName);
    String storedName = UUID.randomUUID() + (ext.isEmpty() ? "" : "." + ext);

    // 날짜별 서브디렉토리로 분산 저장
    String datePath = LocalDate.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd"));
    Path dir = Paths.get(uploadDir, datePath).toAbsolutePath();
    Files.createDirectories(dir);
    Path storagePath = dir.resolve(storedName);
    mf.transferTo(storagePath.toFile());

    // MIME 타입 결정 — 없으면 기본값
    String mime =
        mf.getContentType() != null && !mf.getContentType().isBlank()
            ? mf.getContentType()
            : "application/octet-stream";

    OffsetDateTime now = OffsetDateTime.now();
    // file 행 INSERT — CATEGORY=ATTACHMENT, EXPIRES_AT 설정으로 임시 파일 표시
    return dsl.insertInto(FILE)
        .set(FILE.ORIGINAL_NAME, originalName)
        .set(FILE.STORED_NAME, storedName)
        .set(FILE.MIME_TYPE, mime)
        .set(FILE.SIZE_BYTES, mf.getSize())
        .set(FILE.CATEGORY, "ATTACHMENT")
        .set(FILE.STORAGE_PATH, storagePath.toAbsolutePath().toString())
        .set(FILE.UPLOADED_BY, uploaderId)
        .set(FILE.CREATED_AT, now)
        .set(FILE.EXPIRES_AT, now.plusHours(tempExpiryHours))
        .returning(FILE.ID)
        .fetchOne()
        .getId();
  }

  /** 다운로드용 저장 파일 정보. */
  public record StoredFile(String path, String originalName, String mimeType, long sizeBytes) {}

  /** 파일명에서 확장자(점 제외) 추출. 없으면 빈 문자열. */
  private static String extensionOf(String name) {
    int dot = name.lastIndexOf('.');
    return dot >= 0 && dot < name.length() - 1 ? name.substring(dot + 1) : "";
  }
}
