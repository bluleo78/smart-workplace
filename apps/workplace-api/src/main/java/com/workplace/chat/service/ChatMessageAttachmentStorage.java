package com.workplace.chat.service;

import static com.workplace.jooq.tables.File.FILE;

import com.workplace.file.storage.FilePathBuilder;
import com.workplace.file.storage.FileStore;
import com.workplace.file.storage.StorageDomain;
import java.io.IOException;
import java.time.OffsetDateTime;
import org.jooq.DSLContext;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;

/**
 * 이슈 채팅 첨부 파일을 코어 FileStore 에 위임해 저장하고 file 행을 임시(만료 설정)로 INSERT 한다.
 *
 * <p>FilePathBuilder 가 tenant-{id}/chat/{date}/{uuid}.ext 형태의 상대경로를 생성해 테넌트 격리를 보장한다. STORAGE_PATH
 * 에는 상대경로만 저장하며, 절대경로 복원은 다운로드 시 FileStore.resolve() 가 담당한다.
 *
 * <p>expires_at 을 설정해 미전송 파일이 FileCleanupService 에 의해 자동 정리되게 한다.
 */
@Component
public class ChatMessageAttachmentStorage {

  private final DSLContext dsl;

  /** 테넌트 격리 경로 생성기 — tenant-{id}/chat/{date}/{uuid}.ext 형태로 빌드. */
  private final FilePathBuilder pathBuilder;

  /** 코어 파일 저장소 — store/resolve/deleteIfExists 위임. */
  private final FileStore fileStore;

  /** 임시 파일 만료 시간(시). 기본 24시간. workplace.storage.attachment.temp-expiry-hours 로 설정. */
  private final int tempExpiryHours;

  public ChatMessageAttachmentStorage(
      DSLContext dsl,
      FilePathBuilder pathBuilder,
      FileStore fileStore,
      @Value("${workplace.storage.attachment.temp-expiry-hours:24}") int tempExpiryHours) {
    this.dsl = dsl;
    this.pathBuilder = pathBuilder;
    this.fileStore = fileStore;
    this.tempExpiryHours = tempExpiryHours;
  }

  /**
   * 파일을 코어 FileStore 에 저장 후 file row 를 임시로 INSERT 해 fileId 를 반환.
   *
   * <p>STORAGE_PATH 에는 상대경로(tenant-{id}/chat/...)만 저장. expires_at = now + tempExpiryHours.
   *
   * @throws IOException 파일 저장 실패 시
   */
  public Long storeTemporary(MultipartFile mf, Long uploaderId) throws IOException {
    String originalName = mf.getOriginalFilename() != null ? mf.getOriginalFilename() : "file";
    // 코어 FilePathBuilder 가 UUID·날짜·확장자·테넌트 디렉토리를 일괄 생성(상대경로)
    String relativePath = pathBuilder.build(StorageDomain.CHAT, originalName);
    fileStore.store(relativePath, mf);

    // STORED_NAME 에는 경로 마지막 세그먼트(UUID 파일명)만 저장해 "저장된 파일명" 의미를 유지
    String storedName = relativePath.substring(relativePath.lastIndexOf('/') + 1);

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
        .set(FILE.STORAGE_PATH, relativePath) // 상대경로만 저장 — 절대경로 복원은 FileStore.resolve()
        .set(FILE.UPLOADED_BY, uploaderId)
        .set(FILE.CREATED_AT, now)
        .set(FILE.EXPIRES_AT, now.plusHours(tempExpiryHours))
        .returning(FILE.ID)
        .fetchOne()
        .getId();
  }
}
