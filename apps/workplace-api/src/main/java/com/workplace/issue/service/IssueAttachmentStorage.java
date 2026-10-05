package com.workplace.issue.service;

import static com.workplace.jooq.Tables.FILE;

import com.workplace.file.service.MimeNormalizer;
import com.workplace.file.storage.FilePathBuilder;
import com.workplace.file.storage.FileStore;
import com.workplace.file.storage.StorageDomain;
import com.workplace.issue.exception.AttachmentNotFoundException;
import java.nio.file.Path;
import java.time.OffsetDateTime;
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

  /** 테넌트 격리 경로 생성기 — tenant-{id}/issue/{date}/{uuid}.ext 형태로 빌드. */
  private final FilePathBuilder pathBuilder;

  /** 코어 파일 저장소 — store/resolve/deleteIfExists 위임. */
  private final FileStore fileStore;

  /** 임시 파일 만료 시간(시). 기본 24시간. workplace.storage.attachment.temp-expiry-hours 로 설정. */
  private final int tempExpiryHours;

  public IssueAttachmentStorage(
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
   * 디스크에 저장 후 file row 를 만들어 fileId 를 반환.
   *
   * <p>FilePathBuilder 가 tenant-{id}/issue/{date}/{uuid}.ext 형태의 상대 경로를 생성하므로 테넌트 격리가 자동 적용된다.
   * STORAGE_PATH 에는 상대 경로만 저장 — 절대 경로 복원은 load() 에서 FileStore.resolve() 가 담당.
   */
  public Long storeAndInsert(MultipartFile mf, Long uploaderId) {
    String originalName = mf.getOriginalFilename() != null ? mf.getOriginalFilename() : "file";
    // 코어 FilePathBuilder 가 UUID·날짜·확장자·테넌트 디렉토리를 일괄 생성
    String relativePath = pathBuilder.build(StorageDomain.ISSUE, originalName);
    fileStore.store(relativePath, mf);

    // 브라우저 Content-Type 이 비었거나 octet-stream 이면 확장자로 보정 — 추출 가능 판정이 mime 기준이라
    // 보정이 없으면 PDF 가 미지원으로 SKIPPED 된다(WP-242, 파일 업로드 경로와 같은 규칙).
    String mime = MimeNormalizer.normalize(originalName, mf.getContentType());

    return dsl.insertInto(FILE)
        .set(FILE.ORIGINAL_NAME, originalName)
        .set(FILE.STORED_NAME, relativePath) // stored_name 도 상대 경로(식별용)
        .set(FILE.MIME_TYPE, mime)
        .set(FILE.SIZE_BYTES, mf.getSize())
        .set(FILE.CATEGORY, "ATTACHMENT")
        .set(FILE.STORAGE_PATH, relativePath) // 상대 경로만 저장
        .set(FILE.UPLOADED_BY, uploaderId)
        .set(FILE.CREATED_AT, OffsetDateTime.now())
        .returning(FILE.ID)
        .fetchOne()
        .getId();
  }

  /**
   * 본문 이미지(WP-199)를 임시(expires_at) 파일로 저장한다. mime 은 브라우저 값이 아니라 호출자가 매직바이트로 판정한 값을 쓴다. 경로는 기존 이슈
   * 첨부와 같은 StorageDomain.ISSUE — 이슈 파일은 한 디렉터리에 모인다. originalName 은 호출자가 NFC 정규화·기본값 처리를 마친 표시
   * 이름이다(응답과 같은 값을 쓰려고 호출자가 한 번만 계산해 넘긴다).
   */
  public Long storeTemporaryImage(
      MultipartFile mf, Long uploaderId, String detectedMime, String originalName) {
    String relativePath = pathBuilder.build(StorageDomain.ISSUE, originalName);
    fileStore.store(relativePath, mf);
    OffsetDateTime now = OffsetDateTime.now();
    return dsl.insertInto(FILE)
        .set(FILE.ORIGINAL_NAME, originalName)
        .set(FILE.STORED_NAME, relativePath)
        .set(FILE.MIME_TYPE, detectedMime)
        .set(FILE.SIZE_BYTES, mf.getSize())
        .set(FILE.CATEGORY, "IMAGE")
        .set(FILE.STORAGE_PATH, relativePath)
        .set(FILE.UPLOADED_BY, uploaderId)
        .set(FILE.CREATED_AT, now)
        .set(FILE.EXPIRES_AT, now.plusHours(tempExpiryHours))
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
    // FileStore 에 위임 — 상대 경로를 절대 경로로 변환해 삭제
    path.ifPresent(
        p -> {
          try {
            fileStore.deleteIfExists(p);
          } catch (Exception ex) {
            log.warn("첨부 바이너리 삭제 실패 (DB row 는 제거됨): {}", p, ex);
          }
        });
  }

  /** 다운로드용 메타 + 디스크 경로 — 컨트롤러가 ResponseEntity 헤더에 세팅한다. */
  public record StoredFile(Path path, String mimeType, String originalName, long sizeBytes) {}

  /**
   * fileId 로 디스크 경로 + 메타 로드. file row 가 없으면 404.
   *
   * <p>STORAGE_PATH 는 상대 경로 — FileStore.resolve() 로 절대 경로를 복원한다. 컨트롤러가 path() 를 FileSystemResource
   * 에 그대로 넘기므로 절대 경로여야 한다.
   */
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
        fileStore.resolve(rec.get(FILE.STORAGE_PATH)), // 상대→절대 경로 복원
        rec.get(FILE.MIME_TYPE),
        rec.get(FILE.ORIGINAL_NAME),
        rec.get(FILE.SIZE_BYTES));
  }
}
