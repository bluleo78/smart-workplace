package com.workplace.file.service;

import static com.workplace.jooq.Tables.FILE;

import com.workplace.file.dto.FileUploadResponse;
import com.workplace.file.exception.FileNotFoundException;
import com.workplace.file.exception.FileSizeLimitExceededException;
import com.workplace.file.storage.FilePathBuilder;
import com.workplace.file.storage.FileStore;
import com.workplace.file.storage.StorageDomain;
import com.workplace.global.util.UnicodeNames;
import java.io.IOException;
import java.nio.file.Path;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import lombok.extern.slf4j.Slf4j;
import org.jooq.DSLContext;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

@Service
@Slf4j
public class FileUploadService {

  private static final Map<String, String> MIME_TO_CATEGORY =
      Map.ofEntries(
          Map.entry("image/png", "IMAGE"),
          Map.entry("image/jpeg", "IMAGE"),
          Map.entry("image/gif", "IMAGE"),
          Map.entry("image/webp", "IMAGE"),
          Map.entry("image/svg+xml", "IMAGE"),
          Map.entry("application/pdf", "PDF"),
          Map.entry("text/plain", "TEXT"),
          Map.entry("text/markdown", "TEXT"),
          Map.entry("application/json", "TEXT"),
          Map.entry("text/xml", "TEXT"),
          Map.entry("application/xml", "TEXT"),
          Map.entry("text/yaml", "TEXT"),
          Map.entry("application/x-yaml", "TEXT"),
          Map.entry("text/csv", "DATA"),
          Map.entry("application/csv", "DATA"),
          Map.entry(
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              "DOCUMENT"),
          Map.entry("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "DATA"),
          // #735 추출 범위 확장에 따른 추가 — ExtractableTypes/MimeNormalizer 지원 목록과 동기화.
          Map.entry("text/html", "TEXT"),
          Map.entry("application/yaml", "TEXT"),
          Map.entry("application/javascript", "TEXT"),
          Map.entry("application/x-sh", "TEXT"),
          Map.entry(
              "application/vnd.openxmlformats-officedocument.presentationml.presentation",
              "DOCUMENT"),
          Map.entry("application/msword", "DOCUMENT"),
          Map.entry("application/vnd.ms-powerpoint", "DOCUMENT"),
          Map.entry("application/vnd.ms-excel", "DATA"),
          Map.entry("application/x-hwp", "DOCUMENT"),
          Map.entry("application/hwp+zip", "DOCUMENT"));

  // 카테고리별 첨부 사이즈 제한 (바이트). DATA는 대용량 CSV/XLSX 적재를 위해 256MB까지 허용,
  // 나머지(IMAGE/PDF/TEXT/DOCUMENT)는 10MB로 통일한다. OTHER(미분류 allow-all)는 파일당 multipart
  // 상한(application.yml max-file-size 25MB)과 동일한 25MB.
  private static final Map<String, Long> CATEGORY_SIZE_LIMITS =
      Map.of(
          "IMAGE", 10L * 1024 * 1024,
          "PDF", 10L * 1024 * 1024,
          "TEXT", 10L * 1024 * 1024,
          "DATA", 256L * 1024 * 1024,
          "DOCUMENT", 10L * 1024 * 1024,
          "OTHER", 25L * 1024 * 1024);

  private final DSLContext dsl;
  private final ThumbnailGenerator thumbnailGenerator;
  private final FilePathBuilder pathBuilder;
  private final FileStore fileStore;
  private final int maxFilesPerRequest;
  private final int expiryHours;

  public FileUploadService(
      DSLContext dsl,
      ThumbnailGenerator thumbnailGenerator,
      FilePathBuilder pathBuilder,
      FileStore fileStore,
      @Value("${workplace.storage.max-files-per-request:3}") int maxFilesPerRequest,
      @Value("${workplace.storage.expiry-hours:24}") int expiryHours) {
    this.dsl = dsl;
    this.thumbnailGenerator = thumbnailGenerator;
    this.pathBuilder = pathBuilder;
    this.fileStore = fileStore;
    this.maxFilesPerRequest = maxFilesPerRequest;
    this.expiryHours = expiryHours;
  }

  // RLS 적용 후 FILE INSERT 는 트랜잭션-로컬 GUC(app.tenant_id)가 채워진 트랜잭션 안에서 일어나야 한다(없으면
  // tenant_id 디폴트가 NULL → NOT NULL 위반). public 진입점에 @Transactional 을 두어 프록시가 트랜잭션을 시작하게 한다
  // — private uploadSingleFile 에 두면 자기-호출로 프록시를 우회해 트랜잭션이 시작되지 않는다.
  @Transactional
  public List<FileUploadResponse> uploadFiles(List<MultipartFile> files, Long userId)
      throws IOException {
    if (files.size() > maxFilesPerRequest) {
      throw new IllegalArgumentException(
          "Too many files. Maximum " + maxFilesPerRequest + " files per request.");
    }

    List<FileUploadResponse> results = new java.util.ArrayList<>();
    for (MultipartFile file : files) {
      results.add(uploadSingleFile(file, userId));
    }
    return results;
  }

  private FileUploadResponse uploadSingleFile(MultipartFile file, Long userId) throws IOException {
    // #735: mime 정규화를 MimeNormalizer 단일 지점으로 통일한다(추출 판정·프리뷰가 같은 값을 보게 함).
    String mimeType = MimeNormalizer.normalize(file.getOriginalFilename(), file.getContentType());

    // 저장 게이트 없음(allow-all): 유형은 저장을 막지 않는다. 미분류 유형은 OTHER 카테고리로 폴백해
    // 크기 한도 조회/저장이 NPE·null 없이 동작하게 한다. 유형별 정책 제어는 별도 이슈(#725)에서 도입.
    String category = MIME_TO_CATEGORY.getOrDefault(mimeType, "OTHER");
    long sizeLimit = CATEGORY_SIZE_LIMITS.get(category);
    if (file.getSize() > sizeLimit) {
      throw new FileSizeLimitExceededException(category, sizeLimit);
    }

    // 파일명은 NFC 로 정규화해 저장한다. macOS 업로드는 NFD(분해형)로 들어와, NFC 검색어와 ILIKE 미스를 유발하기 때문(UnicodeNames 참조).
    // 이 값은 FileUploadResponse → drive_file.name 및 첨부 import 경로까지 흐르므로, 여기 한 곳이 모든 파일명 쓰기 통로다.
    String originalName =
        UnicodeNames.toNfc(
            file.getOriginalFilename() != null ? file.getOriginalFilename() : "file");

    // FilePathBuilder 가 테넌트 prefix + 도메인 세그먼트(files) + 날짜 + UUID 를 조립한다(테넌트 컨텍스트 필수).
    // 경로 예: tenant-1/files/2024-01-15/{uuid}.png
    String relativePath = pathBuilder.build(StorageDomain.FILES, originalName);

    // FileStore 에 위임하여 루트-기준 상대경로로 저장(디스크 직접 접근 제거).
    fileStore.store(relativePath, file);

    // stored_name = 경로의 마지막 세그먼트(uuid.ext) — DB 인바리언트 유지.
    String storedName = relativePath.substring(relativePath.lastIndexOf('/') + 1);

    // IMAGE 카테고리는 썸네일 생성(실패해도 원본 업로드는 유지). 그 외는 null.
    // ThumbnailGenerator.generate() 는 절대경로 문자열을 반환하므로 toRelative 로 상대경로로 변환 후 저장.
    String thumbnailPath = null;
    if ("IMAGE".equals(category)) {
      Path absDir = fileStore.resolve(relativePath).getParent();
      thumbnailPath =
          thumbnailGenerator
              .generate(fileStore.resolve(relativePath), absDir)
              .map(abs -> fileStore.toRelative(Path.of(abs)))
              .orElse(null);
    }

    Instant now = Instant.now();
    Instant expiresAt = now.plusSeconds((long) expiryHours * 3600);

    Long fileId =
        dsl.insertInto(FILE)
            .set(FILE.ORIGINAL_NAME, originalName)
            .set(FILE.STORED_NAME, storedName)
            .set(FILE.MIME_TYPE, mimeType)
            .set(FILE.SIZE_BYTES, file.getSize())
            .set(FILE.CATEGORY, category)
            .set(FILE.STORAGE_PATH, relativePath) // 상대경로 저장
            .set(FILE.UPLOADED_BY, userId)
            .set(FILE.CREATED_AT, OffsetDateTime.ofInstant(now, ZoneOffset.UTC))
            .set(FILE.EXPIRES_AT, OffsetDateTime.ofInstant(expiresAt, ZoneOffset.UTC))
            .set(FILE.THUMBNAIL_PATH, thumbnailPath) // 상대경로(or null)
            .returning(FILE.ID)
            .fetchOne()
            .getId();

    log.info(
        "File uploaded: id={}, name={}, category={}, size={}",
        fileId,
        originalName,
        category,
        file.getSize());

    return new FileUploadResponse(fileId, originalName, mimeType, file.getSize(), category, now);
  }

  // RLS GUC 주입 위해 @Transactional 필요 — 없으면 app_tenant 런타임에서 SELECT 가 빈 결과 → 거짓 404(local/prod
  // fail-closed).
  @Transactional(readOnly = true)
  public FileUploadResponse getFileInfo(Long fileId, Long userId) {
    var record =
        dsl.selectFrom(FILE).where(FILE.ID.eq(fileId)).and(FILE.UPLOADED_BY.eq(userId)).fetchOne();

    if (record == null) {
      throw new FileNotFoundException(fileId);
    }

    return new FileUploadResponse(
        record.getId(),
        record.getOriginalName(),
        record.getMimeType(),
        record.getSizeBytes(),
        record.getCategory(),
        record.getCreatedAt().toInstant());
  }

  /** 파일 다운로드 결과 레코드. byte[] 대신 Resource를 사용하여 대용량 파일(최대 256MB)을 스트리밍으로 전송하고 힙 메모리 과소비를 방지한다. */
  public record FileContentResult(
      Resource resource, String mimeType, String originalName, long size) {}

  // RLS GUC 주입 위해 @Transactional 필요 — 없으면 SELECT 가 빈 결과 → 거짓 404(local/prod fail-closed).
  @Transactional(readOnly = true)
  public FileContentResult getFileContent(Long fileId, Long userId) throws IOException {
    var record =
        dsl.selectFrom(FILE).where(FILE.ID.eq(fileId)).and(FILE.UPLOADED_BY.eq(userId)).fetchOne();

    if (record == null) {
      throw new FileNotFoundException(fileId);
    }

    // fileStore.resolve() 가 상대경로 → 절대경로 복원(레거시 절대경로도 호환).
    // 존재 확인은 FileStore API를 경유하여 추상화 경계를 유지한다.
    if (!fileStore.exists(record.getStoragePath())) {
      throw new FileNotFoundException(fileId);
    }
    Path storagePath = fileStore.resolve(record.getStoragePath());

    // Files.readAllBytes() 대신 FileSystemResource로 스트리밍 반환.
    // DATA 카테고리 파일은 최대 256MB이므로 전체 로드 시 OOM 위험 → 스트리밍 방식 필수.
    long fileSize = fileStore.size(record.getStoragePath());
    Resource resource = new FileSystemResource(storagePath);
    return new FileContentResult(
        resource, record.getMimeType(), record.getOriginalName(), fileSize);
  }

  /** 업로더 검증 없이 파일 콘텐츠를 반환한다. drive 처럼 자체 권한 모델을 가진 호출자가 공간 권한을 검증한 뒤 사용한다. 절대 인증 없이 노출하지 말 것. */
  public FileContentResult getFileContentTrusted(Long fileId) throws IOException {
    var record = dsl.selectFrom(FILE).where(FILE.ID.eq(fileId)).fetchOne();
    if (record == null) {
      throw new FileNotFoundException(fileId);
    }
    // fileStore.resolve() 로 상대/레거시 절대경로 모두 복원.
    // 존재 확인은 FileStore API를 경유하여 추상화 경계를 유지한다.
    if (!fileStore.exists(record.getStoragePath())) {
      throw new FileNotFoundException(fileId);
    }
    Path storagePath = fileStore.resolve(record.getStoragePath());
    long fileSize = fileStore.size(record.getStoragePath());
    Resource resource = new FileSystemResource(storagePath);
    return new FileContentResult(
        resource, record.getMimeType(), record.getOriginalName(), fileSize);
  }

  /**
   * 썸네일 콘텐츠를 업로더 검증 없이 반환한다(drive 처럼 자체 권한 모델 호출자용). thumbnail_path 가 없거나(비이미지/생성실패) 디스크에 파일이 없으면 빈
   * Optional → 호출자는 404 로 매핑한다.
   */
  public Optional<FileContentResult> getThumbnailContentTrusted(Long fileId) throws IOException {
    var record = dsl.selectFrom(FILE).where(FILE.ID.eq(fileId)).fetchOne();
    if (record == null) {
      throw new FileNotFoundException(fileId);
    }
    // 중간 변수로 보존 — 인라인 시 게이트 패턴에 걸릴 수 있어 변수로 분리.
    String tp = record.getThumbnailPath();
    if (tp == null) {
      return Optional.empty();
    }
    // fileStore.resolve() 로 상대/레거시 절대경로 모두 복원.
    // 존재 확인은 FileStore API를 경유하여 추상화 경계를 유지한다.
    if (!fileStore.exists(tp)) {
      return Optional.empty();
    }
    Path thumbPath = fileStore.resolve(tp);
    long size = fileStore.size(tp);
    Resource resource = new FileSystemResource(thumbPath);
    return Optional.of(new FileContentResult(resource, "image/png", "thumbnail.png", size));
  }

  /**
   * 기존 FILE 의 디스크 blob 을 새 파일로 물리 복제하고 새 FILE row(영구, expires_at=null)를 만든다. drive 복사용.
   *
   * <p>별도 @Transactional 을 두지 않으므로 호출자(drive copy 서비스)의 트랜잭션에 합류한다(propagation REQUIRED). 따라서 복사
   * 작업이 실패해 롤백되면 새 FILE row·drive_file row 가 함께 사라진다(부분 커밋 없음). 단, 이미 디스크에 기록된 blob 은 비-트랜잭션 리소스라
   * DB row 없이 디스크에 남을 수 있다(드문 실패경로 한계 — 후속 하드닝/스윕 대상, leak-free 아님). 해피패스(커밋)에서는 원본과 완전히 독립된 영구 파일이
   * 된다.
   *
   * @return 새로 만든 FILE.id
   */
  public long copyFile(long srcFileId, Long callerId) throws IOException {
    var record = dsl.selectFrom(FILE).where(FILE.ID.eq(srcFileId)).fetchOne();
    if (record == null) {
      throw new FileNotFoundException(srcFileId);
    }
    // fileStore.resolve() 로 원본 절대경로 복원 후 존재 확인.
    // 존재 확인은 FileStore API를 경유하여 추상화 경계를 유지한다.
    if (!fileStore.exists(record.getStoragePath())) {
      throw new FileNotFoundException(srcFileId);
    }
    Path srcPath = fileStore.resolve(record.getStoragePath());

    // 복사본도 같은 도메인(FILES)·현재 테넌트·오늘 날짜 경로에 저장.
    String destRel = pathBuilder.buildWithExtensionOf(StorageDomain.FILES, record.getStoredName());
    fileStore.copy(record.getStoragePath(), destRel);

    // stored_name = 경로의 마지막 세그먼트(uuid.ext).
    String storedName = destRel.substring(destRel.lastIndexOf('/') + 1);

    // expires_at 미설정(null = 영구). drive 복사는 단일 트랜잭션이라 임시-expiry→promote 단계가 불필요.
    Long newId =
        dsl.insertInto(FILE)
            .set(FILE.ORIGINAL_NAME, record.getOriginalName())
            .set(FILE.STORED_NAME, storedName)
            .set(FILE.MIME_TYPE, record.getMimeType())
            .set(FILE.SIZE_BYTES, record.getSizeBytes())
            .set(FILE.CATEGORY, record.getCategory())
            .set(FILE.STORAGE_PATH, destRel) // 상대경로 저장
            .set(FILE.UPLOADED_BY, callerId)
            .set(FILE.CREATED_AT, OffsetDateTime.now(ZoneOffset.UTC))
            .returning(FILE.ID)
            .fetchOne()
            .getId();
    log.info("File copied: src={}, new={}, name={}", srcFileId, newId, record.getOriginalName());
    return newId;
  }
}
