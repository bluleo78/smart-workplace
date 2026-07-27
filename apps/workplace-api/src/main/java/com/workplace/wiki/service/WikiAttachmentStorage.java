package com.workplace.wiki.service;

import static com.workplace.jooq.tables.File.FILE;

import com.workplace.file.exception.FileBlobMissingException;
import com.workplace.file.storage.FilePathBuilder;
import com.workplace.file.storage.FileStore;
import com.workplace.file.storage.StorageDomain;
import com.workplace.global.util.UnicodeNames;
import com.workplace.wiki.exception.WikiAttachmentNotFoundException;
import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.util.Optional;
import org.jooq.DSLContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

/** 노트 본문 이미지 첨부의 파일 저장·조회. 업로드 시점에는 임시(expires_at) 로 넣고, 페이지 저장 때 영구화한다. */
@Service
public class WikiAttachmentStorage {

  private static final Logger log = LoggerFactory.getLogger(WikiAttachmentStorage.class);

  private final DSLContext dsl;

  /** 테넌트 격리 경로 생성기 — tenant-{id}/wiki/{date}/{uuid}.ext 형태로 빌드. */
  private final FilePathBuilder pathBuilder;

  /** 코어 파일 저장소 — store/resolve/deleteIfExists 위임. */
  private final FileStore fileStore;

  /** 임시 파일 만료 시간(시). 기본 24시간. workplace.storage.attachment.temp-expiry-hours 로 설정. */
  private final int tempExpiryHours;

  public WikiAttachmentStorage(
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
   * 파일을 디스크에 쓰고 file 행을 임시(expires_at) 로 INSERT 한다.
   *
   * <p>본문에 삽입되지 않고 버려진 이미지는 FileCleanupService 가 만료로 수거하고, 매핑은 CASCADE 로 사라진다. mime_type 은 브라우저
   * Content-Type 이 아니라 호출자가 매직바이트로 판정한 값({@code detectedMime})을 그대로 저장한다.
   */
  public Long storeTemporary(MultipartFile mf, Long uploaderId, String detectedMime) {
    String rawName =
        mf.getOriginalFilename() != null && !mf.getOriginalFilename().isBlank()
            ? mf.getOriginalFilename()
            : "image";
    String originalName = UnicodeNames.toNfc(rawName);
    // 코어 FilePathBuilder 가 UUID·날짜·확장자·테넌트 디렉토리를 일괄 생성(상대경로)
    String relativePath = pathBuilder.build(StorageDomain.WIKI, originalName);
    fileStore.store(relativePath, mf);

    OffsetDateTime now = OffsetDateTime.now();
    return dsl.insertInto(FILE)
        .set(FILE.ORIGINAL_NAME, originalName)
        .set(FILE.STORED_NAME, relativePath)
        .set(FILE.MIME_TYPE, detectedMime)
        .set(FILE.SIZE_BYTES, mf.getSize())
        .set(FILE.CATEGORY, "ATTACHMENT")
        .set(FILE.STORAGE_PATH, relativePath) // 상대 경로만 저장 — 절대 경로 복원은 FileStore.resolve()
        .set(FILE.UPLOADED_BY, uploaderId)
        .set(FILE.CREATED_AT, now)
        .set(FILE.EXPIRES_AT, now.plusHours(tempExpiryHours))
        .returning(FILE.ID)
        .fetchOne()
        .getId();
  }

  /** 다운로드/렌더용 메타 + 디스크 경로. */
  public record StoredFile(Path path, String mimeType, String originalName, long sizeBytes) {}

  /**
   * fileId 로 디스크 경로 + 메타 로드. file row 가 없으면 404(WikiAttachmentNotFoundException).
   *
   * <p>STORAGE_PATH 는 상대 경로 — FileStore.resolve() 로 절대 경로를 복원한다. row 는 있으나 디스크 blob 이 없는 경우(#739)는
   * file 코어의 다른 모든 소비처(FileUploadService.getFileContent 등)와 동일하게 {@link FileBlobMissingException} 을
   * 던진다 — GlobalExceptionHandler 가 이미 이 예외를 404 + "파일 원본이 유실되어…" 로 매핑해두었으므로 여기서는 존재 확인만 추가한다. 이 확인이
   * 없으면 FileSystemResource 가 존재하지 않는 경로를 그대로 반환해 컨트롤러 응답 스트리밍 단계에서 500 이 난다.
   */
  public StoredFile load(Long fileId) {
    var rec =
        dsl.select(FILE.ORIGINAL_NAME, FILE.MIME_TYPE, FILE.SIZE_BYTES, FILE.STORAGE_PATH)
            .from(FILE)
            .where(FILE.ID.eq(fileId))
            .fetchOne();
    if (rec == null) {
      throw new WikiAttachmentNotFoundException(fileId);
    }
    String storagePath = rec.get(FILE.STORAGE_PATH);
    // 존재 확인은 FileStore API 를 경유하여 추상화 경계를 유지한다(FileUploadService 와 동일 패턴).
    if (!fileStore.exists(storagePath)) {
      throw new FileBlobMissingException(fileId);
    }
    return new StoredFile(
        fileStore.resolve(storagePath), // 상대→절대 경로 복원
        rec.get(FILE.MIME_TYPE),
        rec.get(FILE.ORIGINAL_NAME),
        rec.get(FILE.SIZE_BYTES));
  }

  /**
   * file row 삭제 — 바이너리는 지우지 않고 상대경로만 반환한다(row 없으면 empty).
   *
   * <p>row 삭제와 바이너리 unlink 를 분리한 이유(리뷰 지적): 호출자가 이 메서드를 트랜잭션 안에서 부르고 그 트랜잭션이 롤백되면, row 는 되살아나는데 이
   * 메서드가 즉시 바이너리까지 지워버리면 "살아있는 row 가 없는 blob 을 가리키는" 상태가 영구히 남는다. 호출자(예:
   * WikiAttachmentService.delete)는 이 반환값을 커밋 후({@code TransactionSynchronization.afterCommit})에만
   * {@link #deleteBinary(String)} 로 넘겨야 한다.
   */
  public Optional<String> deleteFileRow(Long fileId) {
    var path =
        dsl.select(FILE.STORAGE_PATH)
            .from(FILE)
            .where(FILE.ID.eq(fileId))
            .fetchOptional(0, String.class);
    dsl.deleteFrom(FILE).where(FILE.ID.eq(fileId)).execute();
    return path;
  }

  /** 상대경로의 디스크 바이너리 삭제. 정리 실패는 로그만 — 이 시점엔 DB row 가 이미 커밋 삭제된 뒤라 DB 정합성에 영향 없음. */
  public void deleteBinary(String relativePath) {
    try {
      fileStore.deleteIfExists(relativePath);
    } catch (Exception ex) {
      log.warn("첨부 바이너리 삭제 실패 (DB row 는 이미 제거됨): {}", relativePath, ex);
    }
  }
}
