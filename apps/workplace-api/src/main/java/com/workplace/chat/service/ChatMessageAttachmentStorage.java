package com.workplace.chat.service;

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
 * 이슈 채팅 첨부 파일을 디스크에 저장하고 file 행을 임시(만료 설정)로 INSERT 한다. (MessageAttachmentStorage 미러)
 *
 * <p>expires_at 을 설정해 미전송 파일이 FileCleanupService 에 의해 자동 정리되게 한다.
 */
@Component
public class ChatMessageAttachmentStorage {

  private final DSLContext dsl;
  private final String uploadDir;
  private final int tempExpiryHours;

  public ChatMessageAttachmentStorage(
      DSLContext dsl,
      @Value("${workplace.chat.attachment.upload-dir:./uploads/chat-attachments}") String uploadDir,
      @Value("${workplace.chat.attachment.temp-expiry-hours:24}") int tempExpiryHours) {
    this.dsl = dsl;
    this.uploadDir = uploadDir;
    this.tempExpiryHours = tempExpiryHours;
  }

  /** 파일을 임시로 저장. expires_at = now+tempExpiryHours. 생성된 file.id 반환. */
  public Long storeTemporary(MultipartFile mf, Long uploaderId) throws IOException {
    String originalName = mf.getOriginalFilename() != null ? mf.getOriginalFilename() : "file";
    String ext = extensionOf(originalName);
    String storedName = UUID.randomUUID() + (ext.isEmpty() ? "" : "." + ext);

    String datePath = LocalDate.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd"));
    Path dir = Paths.get(uploadDir, datePath).toAbsolutePath();
    Files.createDirectories(dir);
    Path storagePath = dir.resolve(storedName);
    mf.transferTo(storagePath.toFile());

    String mime =
        mf.getContentType() != null && !mf.getContentType().isBlank()
            ? mf.getContentType()
            : "application/octet-stream";

    OffsetDateTime now = OffsetDateTime.now();
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

  /** 파일명에서 확장자(점 제외) 추출. 없으면 빈 문자열. */
  private static String extensionOf(String name) {
    int dot = name.lastIndexOf('.');
    return dot >= 0 && dot < name.length() - 1 ? name.substring(dot + 1) : "";
  }
}
