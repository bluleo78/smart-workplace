package com.workplace.issue.service;

import static com.workplace.jooq.Tables.FILE;

import com.workplace.issue.exception.AttachmentNotFoundException;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.UUID;
import org.jooq.DSLContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

/**
 * 이슈 첨부 전용 파일 저장소.
 *
 * <p>file 모듈의 FileUploadService 와 분리한 이유: 그쪽은 MIME 화이트리스트(image/pdf/text/csv/xlsx) 와 uploader-only
 * 다운로드 제약이 있어 첨부 시나리오와 맞지 않다. 본 클래스는 동일한 {@code file} 테이블에 row 를 직접 INSERT 하되 카테고리만 {@code
 * ATTACHMENT} 로 구분하고 expires_at 은 NULL(영구) 로 둔다.
 */
@Service
public class IssueAttachmentStorage {

  private static final Logger log = LoggerFactory.getLogger(IssueAttachmentStorage.class);

  private final DSLContext dsl;
  private final String uploadDir;

  public IssueAttachmentStorage(
      DSLContext dsl,
      @Value("${workplace.attachment.upload-dir:./uploads/attachments}") String uploadDir) {
    this.dsl = dsl;
    this.uploadDir = uploadDir;
  }

  /** 디스크에 저장 후 file row 를 만들어 fileId 를 반환. 날짜별 서브디렉토리로 분산 저장. */
  public Long storeAndInsert(MultipartFile mf, Long uploaderId) throws IOException {
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

    return dsl.insertInto(FILE)
        .set(FILE.ORIGINAL_NAME, originalName)
        .set(FILE.STORED_NAME, storedName)
        .set(FILE.MIME_TYPE, mime)
        .set(FILE.SIZE_BYTES, mf.getSize())
        .set(FILE.CATEGORY, "ATTACHMENT")
        .set(FILE.STORAGE_PATH, storagePath.toAbsolutePath().toString())
        .set(FILE.UPLOADED_BY, uploaderId)
        .set(FILE.CREATED_AT, OffsetDateTime.now())
        .returning(FILE.ID)
        .fetchOne()
        .getId();
  }

  /** file row + 디스크 바이너리 삭제. 디스크 정리 실패는 로그만 — DB 정합성 우선. */
  public void deleteFileRowAndBinary(Long fileId) {
    var path =
        dsl.select(FILE.STORAGE_PATH)
            .from(FILE)
            .where(FILE.ID.eq(fileId))
            .fetchOptional(0, String.class);
    dsl.deleteFrom(FILE).where(FILE.ID.eq(fileId)).execute();
    path.ifPresent(
        p -> {
          try {
            Files.deleteIfExists(Path.of(p));
          } catch (IOException ex) {
            log.warn("첨부 바이너리 삭제 실패 (DB row 는 제거됨): {}", p, ex);
          }
        });
  }

  /** 다운로드용 메타 + 디스크 경로 — 컨트롤러가 ResponseEntity 헤더에 세팅한다. */
  public record StoredFile(Path path, String mimeType, String originalName, long sizeBytes) {}

  /** fileId 로 디스크 경로 + 메타 로드. file row 가 없으면 404. */
  public StoredFile load(Long fileId) {
    var rec =
        dsl.select(FILE.ORIGINAL_NAME, FILE.MIME_TYPE, FILE.SIZE_BYTES, FILE.STORAGE_PATH)
            .from(FILE)
            .where(FILE.ID.eq(fileId))
            .fetchOne();
    if (rec == null) {
      throw new AttachmentNotFoundException(fileId);
    }
    return new StoredFile(
        Path.of(rec.get(FILE.STORAGE_PATH)),
        rec.get(FILE.MIME_TYPE),
        rec.get(FILE.ORIGINAL_NAME),
        rec.get(FILE.SIZE_BYTES));
  }

  /** 파일명에서 확장자(점 제외) 추출. 없으면 빈 문자열. */
  private static String extensionOf(String name) {
    int dot = name.lastIndexOf('.');
    return dot >= 0 ? name.substring(dot + 1) : "";
  }
}
