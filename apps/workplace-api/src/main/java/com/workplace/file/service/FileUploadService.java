package com.workplace.file.service;

import static com.workplace.jooq.Tables.FILE;

import com.workplace.file.dto.FileUploadResponse;
import com.workplace.file.exception.FileNotFoundException;
import com.workplace.file.exception.FileSizeLimitExceededException;
import com.workplace.file.exception.UnsupportedUploadFileTypeException;
import com.workplace.global.tenant.TenantContext;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
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

  private static final Set<String> ALLOWED_MIME_TYPES =
      Set.of(
          "image/png",
          "image/jpeg",
          "image/gif",
          "image/webp",
          "application/pdf",
          "text/plain",
          "text/markdown",
          "application/json",
          "text/xml",
          "application/xml",
          "text/yaml",
          "application/x-yaml",
          "text/csv",
          "application/csv",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

  private static final Map<String, String> MIME_TO_CATEGORY =
      Map.ofEntries(
          Map.entry("image/png", "IMAGE"),
          Map.entry("image/jpeg", "IMAGE"),
          Map.entry("image/gif", "IMAGE"),
          Map.entry("image/webp", "IMAGE"),
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
          Map.entry("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "DATA"));

  // 카테고리별 첨부 사이즈 제한 (바이트). DATA는 대용량 CSV/XLSX 적재를 위해 256MB까지 허용,
  // 나머지(IMAGE/PDF/TEXT/DOCUMENT)는 10MB로 통일한다.
  private static final Map<String, Long> CATEGORY_SIZE_LIMITS =
      Map.of(
          "IMAGE", 10L * 1024 * 1024,
          "PDF", 10L * 1024 * 1024,
          "TEXT", 10L * 1024 * 1024,
          "DATA", 256L * 1024 * 1024,
          "DOCUMENT", 10L * 1024 * 1024);

  private final DSLContext dsl;
  private final ThumbnailGenerator thumbnailGenerator;
  private final String uploadDir;
  private final int maxFilesPerRequest;
  private final int expiryHours;

  public FileUploadService(
      DSLContext dsl,
      ThumbnailGenerator thumbnailGenerator,
      @Value("${firehub.file.upload-dir:./uploads}") String uploadDir,
      @Value("${firehub.file.max-files-per-request:3}") int maxFilesPerRequest,
      @Value("${firehub.file.expiry-hours:24}") int expiryHours) {
    this.dsl = dsl;
    this.thumbnailGenerator = thumbnailGenerator;
    this.uploadDir = uploadDir;
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
    String mimeType = resolveMimeType(file);

    if (!ALLOWED_MIME_TYPES.contains(mimeType)) {
      throw new UnsupportedUploadFileTypeException(mimeType);
    }

    String category = MIME_TO_CATEGORY.get(mimeType);
    long sizeLimit = CATEGORY_SIZE_LIMITS.get(category);
    if (file.getSize() > sizeLimit) {
      throw new FileSizeLimitExceededException(category, sizeLimit);
    }

    String originalName = file.getOriginalFilename() != null ? file.getOriginalFilename() : "file";
    String ext = getExtension(originalName);
    String storedName = UUID.randomUUID().toString() + (ext.isEmpty() ? "" : "." + ext);

    String datePath = LocalDate.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd"));
    // 스토리지 경로에 테넌트 prefix 를 넣어 테넌트 간 파일을 물리적으로 분리한다.
    Path dir = tenantScopedDir(datePath);
    Files.createDirectories(dir);

    Path storagePath = dir.resolve(storedName);
    file.transferTo(storagePath.toFile());

    // IMAGE 카테고리는 썸네일 생성(실패해도 원본 업로드는 유지). 그 외는 null.
    String thumbnailPath = null;
    if ("IMAGE".equals(category)) {
      thumbnailPath = thumbnailGenerator.generate(storagePath, dir).orElse(null);
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
            .set(FILE.STORAGE_PATH, storagePath.toAbsolutePath().toString())
            .set(FILE.UPLOADED_BY, userId)
            .set(FILE.CREATED_AT, OffsetDateTime.ofInstant(now, ZoneOffset.UTC))
            .set(FILE.EXPIRES_AT, OffsetDateTime.ofInstant(expiresAt, ZoneOffset.UTC))
            .set(FILE.THUMBNAIL_PATH, thumbnailPath)
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

  public FileContentResult getFileContent(Long fileId, Long userId) throws IOException {
    var record =
        dsl.selectFrom(FILE).where(FILE.ID.eq(fileId)).and(FILE.UPLOADED_BY.eq(userId)).fetchOne();

    if (record == null) {
      throw new FileNotFoundException(fileId);
    }

    Path storagePath = Path.of(record.getStoragePath());
    if (!Files.exists(storagePath)) {
      throw new FileNotFoundException(fileId);
    }

    // Files.readAllBytes() 대신 FileSystemResource로 스트리밍 반환.
    // DATA 카테고리 파일은 최대 256MB이므로 전체 로드 시 OOM 위험 → 스트리밍 방식 필수.
    long fileSize = Files.size(storagePath);
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
    Path storagePath = Path.of(record.getStoragePath());
    if (!Files.exists(storagePath)) {
      throw new FileNotFoundException(fileId);
    }
    long fileSize = Files.size(storagePath);
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
    String tp = record.getThumbnailPath();
    if (tp == null) {
      return Optional.empty();
    }
    Path thumbPath = Path.of(tp);
    if (!Files.exists(thumbPath)) {
      return Optional.empty();
    }
    long size = Files.size(thumbPath);
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
    Path srcPath = Path.of(record.getStoragePath());
    if (!Files.exists(srcPath)) {
      throw new FileNotFoundException(srcFileId);
    }

    String ext = getExtension(record.getStoredName());
    String storedName = UUID.randomUUID().toString() + (ext.isEmpty() ? "" : "." + ext);
    String datePath = LocalDate.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd"));
    // 복사도 업로드와 동일하게 현재 테넌트 prefix 경로에 둔다(drive 복사는 요청 스레드).
    Path dir = tenantScopedDir(datePath);
    Files.createDirectories(dir);
    Path destPath = dir.resolve(storedName);
    Files.copy(srcPath, destPath);

    // expires_at 미설정(null = 영구). drive 복사는 단일 트랜잭션이라 임시-expiry→promote 단계가 불필요.
    Long newId =
        dsl.insertInto(FILE)
            .set(FILE.ORIGINAL_NAME, record.getOriginalName())
            .set(FILE.STORED_NAME, storedName)
            .set(FILE.MIME_TYPE, record.getMimeType())
            .set(FILE.SIZE_BYTES, record.getSizeBytes())
            .set(FILE.CATEGORY, record.getCategory())
            .set(FILE.STORAGE_PATH, destPath.toAbsolutePath().toString())
            .set(FILE.UPLOADED_BY, callerId)
            .set(FILE.CREATED_AT, OffsetDateTime.now(ZoneOffset.UTC))
            .returning(FILE.ID)
            .fetchOne()
            .getId();
    log.info("File copied: src={}, new={}, name={}", srcFileId, newId, record.getOriginalName());
    return newId;
  }

  private String resolveMimeType(MultipartFile file) {
    String contentType = file.getContentType();
    if (contentType != null
        && !contentType.isBlank()
        && !contentType.equals("application/octet-stream")) {
      return contentType.split(";")[0].trim().toLowerCase();
    }
    // Fallback: derive from filename extension
    String name = file.getOriginalFilename();
    if (name != null) {
      String ext = getExtension(name).toLowerCase();
      return switch (ext) {
        case "png" -> "image/png";
        case "jpg", "jpeg" -> "image/jpeg";
        case "gif" -> "image/gif";
        case "webp" -> "image/webp";
        case "pdf" -> "application/pdf";
        case "txt" -> "text/plain";
        case "md" -> "text/markdown";
        case "json" -> "application/json";
        case "xml" -> "text/xml";
        case "yaml", "yml" -> "text/yaml";
        case "csv" -> "text/csv";
        case "xlsx" -> "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        default -> contentType != null ? contentType : "application/octet-stream";
      };
    }
    return contentType != null ? contentType : "application/octet-stream";
  }

  private String getExtension(String filename) {
    int dotIdx = filename.lastIndexOf('.');
    return dotIdx >= 0 ? filename.substring(dotIdx + 1) : "";
  }

  /**
   * 현재 테넌트로 스코핑된 저장 디렉터리({uploadDir}/tenant-{tenantId}/chat-files/{date})를 만든다. 테넌트 컨텍스트가 없으면 업로드를
   * 차단(테넌트 미선택 상태 업로드 금지) — RLS GUC 와 파일시스템 경로의 테넌트 일관성을 보장한다.
   */
  private Path tenantScopedDir(String datePath) {
    Long tenantId = TenantContext.get();
    if (tenantId == null) {
      throw new IllegalStateException("테넌트 컨텍스트 없이 파일 업로드 불가");
    }
    return Paths.get(uploadDir, "tenant-" + tenantId, "chat-files", datePath).toAbsolutePath();
  }
}
