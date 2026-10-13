package com.workplace.drive.service;

import static com.workplace.global.realtime.ResourceChangedEvent.OP_CREATED;
import static com.workplace.global.realtime.ResourceChangedEvent.OP_DELETED;
import static com.workplace.global.realtime.ResourceChangedEvent.OP_UPDATED;

import com.workplace.audit.service.AuditLogService;
import com.workplace.drive.dto.DriveFileResponse;
import com.workplace.drive.dto.FileSummaryResponse;
import com.workplace.drive.exception.DriveDuplicateNameException;
import com.workplace.drive.exception.DriveFileNotFoundException;
import com.workplace.drive.exception.DriveFolderNotFoundException;
import com.workplace.drive.exception.DriveInvalidTargetException;
import com.workplace.drive.exception.DriveNotTextFileException;
import com.workplace.drive.outbound.DriveChangeNotifier;
import com.workplace.drive.repository.DriveFileRepository;
import com.workplace.drive.repository.DriveFolderRepository;
import com.workplace.drive.repository.DriveQuotaRepository;
import com.workplace.file.dto.FileUploadResponse;
import com.workplace.file.exception.FileSizeLimitExceededException;
import com.workplace.file.service.FileUploadService;
import com.workplace.file.service.FileUploadService.FileContentResult;
import com.workplace.file.service.UploadSource;
import com.workplace.file.storage.FilePathBuilder;
import com.workplace.fileai.ExtractionProfile;
import com.workplace.fileai.ExtractionReasons;
import com.workplace.fileai.dto.ExtractedTextSlice;
import com.workplace.fileai.inbound.FileExtractionRequestedEvent;
import com.workplace.fileai.service.ExtractedTextService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.util.SafeFileNames;
import com.workplace.user.repository.UserRepository;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

/** 파일 업로드/다운로드/삭제. 바이트는 file core 재사용. */
@Service
@RequiredArgsConstructor
public class DriveFileService {
  private final DriveFileRepository files;
  private final FileUploadService fileUpload;
  private final DrivePermissions perms;
  private final DriveFolderRepository folders;
  private final org.jooq.DSLContext dsl;

  /** 업로드 시 쿼터 강제 — 테넌트 단위 직렬화 잠금 + 사용량 검사(#81). */
  private final DriveQuotaService quota;

  private final DriveQuotaRepository quotaRepo;

  /** 감사 로그 기록(#81). */
  private final AuditLogService auditLogService;

  /** 사용자명 조회용 — 감사 로그에 username 을 기록한다(#81). */
  private final UserRepository userRepository;

  /** 파일 버전 레포지토리 — 동명 업로드 자동 버전화(#79). */
  private final com.workplace.drive.repository.DriveFileVersionRepository versions;

  /** 파일 콘텐츠 요약 읽기(#526) — file_extraction.summary 조회. */
  private final com.workplace.drive.repository.DriveFileSummaryRepository summaries;

  /** 드라이브 변경 resource.changed 발행(WP-63). */
  private final DriveChangeNotifier notifier;

  /** 추출 텍스트 구간 읽기(WP-346) — 상태·사유·자르기는 fileai 공용 서비스가 맡는다. */
  private final ExtractedTextService extractedText;

  /** 텍스트로 만드는 파일의 크기 상한 — TEXT 카테고리 상한(10MB)과 같다. csv 는 DATA(256MB) 카테고리라 따로 막는다(WP-369). */
  public static final long TEXT_FILE_MAX_BYTES = FileUploadService.sizeLimitOf("TEXT");

  /**
   * 텍스트로 만들 때 확장자 → MIME(WP-369, R4). 이 넷만 허용하고 나머지 확장자는 text/plain 이다 — AI 가 쓴(주입됐을 수도 있는) HTML 이
   * {@code /content} 로 text/html 그대로 서빙되지 않게 html 은 넣지 않는다.
   */
  private static final Map<String, String> TEXT_MIME_BY_EXTENSION =
      Map.of(
          "md", "text/markdown",
          "txt", "text/plain",
          "csv", "text/csv",
          "json", "application/json");

  /** 텍스트로 읽는 application MIME(WP-369 텍스트 갱신 판정) — csv·json·xml·yaml·javascript·셸. */
  private static final Set<String> TEXT_APPLICATION_MIMES =
      Set.of(
          "application/csv",
          "application/json",
          "application/xml",
          "application/x-yaml",
          "application/yaml",
          "application/javascript",
          "application/x-sh");

  /** octet-stream 으로 저장됐어도 텍스트로 보는 확장자(WP-369) — 브라우저가 MIME 을 모르는 코드·설정 파일. */
  private static final Set<String> TEXT_EXTENSIONS =
      Set.of(
          "md", "txt", "csv", "tsv", "json", "yaml", "yml", "xml", "js", "ts", "py", "java", "sh",
          "sql", "css", "log");

  /** 멀티파트 업로드(웹 드라이브). 의미는 {@link #upload(long, long, Long, UploadSource)} 와 같다. */
  @Transactional
  public DriveFileResponse upload(long callerId, long spaceId, Long folderId, MultipartFile file)
      throws IOException {
    return upload(callerId, spaceId, folderId, UploadSource.of(file));
  }

  /**
   * 텍스트로 파일 만들기(WP-369) — AI·MCP 가 쓴 내용을 UTF-8 로 저장한다. 업로드와 같은 의미(권한·폴더 검증·할당량·동명 새 버전·감사·추출·알림)다.
   *
   * <p>MIME 은 {@code mimeType} 이 있으면 허용 목록(text/markdown·text/plain·text/csv·application/json) 안에서만
   * 쓰고, 없으면 확장자(md·txt·csv·json, 그 밖은 text/plain)로 정한다. 크기 상한은 TEXT 상한(10MB).
   *
   * @throws IllegalArgumentException 허용하지 않는 mimeType(400)
   * @throws FileSizeLimitExceededException UTF-8 로 10MB 초과(400)
   */
  @Transactional
  public DriveFileResponse createTextFile(
      long callerId, long spaceId, Long folderId, String name, String content, String mimeType)
      throws IOException {
    String mime = textMimeOf(name, mimeType);
    byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
    if (bytes.length > TEXT_FILE_MAX_BYTES) {
      throw new FileSizeLimitExceededException("TEXT", TEXT_FILE_MAX_BYTES);
    }
    return upload(callerId, spaceId, folderId, UploadSource.ofBytes(name, mime, bytes));
  }

  /** 텍스트 파일 MIME 결정(R4) — 명시값은 허용 목록만(매개변수 제거·소문자), 없으면 확장자, 모르면 text/plain. */
  static String textMimeOf(String name, String requested) {
    if (requested != null && !requested.isBlank()) {
      String mime = bareMime(requested);
      // ";x" 처럼 본체가 빈 값은 null — Map.of 의 containsValue(null) 은 NPE 라 먼저 거른다(400 유지).
      if (mime == null || !TEXT_MIME_BY_EXTENSION.containsValue(mime)) {
        throw new IllegalArgumentException(
            "mimeType 은 text/markdown, text/plain, text/csv, application/json 중 하나여야 합니다.");
      }
      return mime;
    }
    String ext = FilePathBuilder.extensionOf(name == null ? "" : name).toLowerCase(Locale.ROOT);
    return TEXT_MIME_BY_EXTENSION.getOrDefault(ext, "text/plain");
  }

  /**
   * 기존 파일을 텍스트 내용으로 갱신(WP-369) — 그 파일에 새 버전을 더한다. 이름·폴더는 바꾸지 않는다. 의미는 {@link #addVersion} 과 같다.
   *
   * <p>검사 순서가 존재 은닉을 지킨다: 없는·휴지통 파일 404 → 공간 비멤버 404 · EDITOR 미만 403 → 텍스트 계열이 아니면 409 → MIME(400)
   * → 크기(400). 역할 검사를 409 보다 먼저 해야 비멤버가 파일 형식을 알아내지 못한다.
   *
   * <p>MIME 은 {@link #updatedTextMimeOf} 로 정한다 — 명시값은 R4 허용 목록만, 없으면 지금 MIME 을 유지한다(yaml·md·js 가
   * 버전마다 text/plain 으로 바뀌지 않게). 단 html·xml 계열과 확장자로만 텍스트로 본 octet-stream 은 파일 이름 확장자로 정해 html·xml 은
   * text/plain 이 된다.
   *
   * @throws DriveFileNotFoundException 없거나 휴지통 파일(404)
   * @throws DriveNotTextFileException 현재 버전이 텍스트 계열({@link #isTextLike})이 아님(409)
   * @throws IllegalArgumentException 허용하지 않는 mimeType(400)
   * @throws FileSizeLimitExceededException UTF-8 로 10MB 초과(400)
   */
  @Transactional
  public DriveFileResponse updateTextFile(
      long callerId, long driveFileId, String content, String mimeType) throws IOException {
    DriveFileRepository.DriveFileRow row =
        files.findRow(driveFileId).orElseThrow(() -> new DriveFileNotFoundException(driveFileId));
    perms.requireRole(row.spaceId(), callerId, "EDITOR");
    String currentMime = files.findCurrentMime(row.fileId());
    if (!isTextLike(currentMime, row.name())) {
      throw new DriveNotTextFileException();
    }
    String mime = updatedTextMimeOf(row.name(), currentMime, mimeType);
    byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
    if (bytes.length > TEXT_FILE_MAX_BYTES) {
      throw new FileSizeLimitExceededException("TEXT", TEXT_FILE_MAX_BYTES);
    }
    return bindVersion(callerId, row, UploadSource.ofBytes(row.name(), mime, bytes));
  }

  /**
   * 텍스트 갱신 새 버전의 MIME(WP-369).
   *
   * <ul>
   *   <li>{@code requested} 가 있으면 R4 허용 목록만({@link #textMimeOf}, 아니면 400).
   *   <li>없고 지금 MIME 이 텍스트 MIME 이며 html·xml 계열이 아니면 그대로 둔다(매개변수는 뗀다 — 내용을 UTF-8 로 다시 쓰므로 옛 charset
   *       을 남기지 않는다).
   *   <li>그 밖(html·xml 계열, 확장자로만 텍스트로 본 octet-stream)은 파일 이름 확장자로 정한다 — html·xml 은 text/plain 이 된다.
   *       {@code /content} 가 저장 MIME 으로 인라인 서빙하므로 AI 가 쓴 내용이 문서로 렌더링·실행되지 않게 한다.
   * </ul>
   */
  static String updatedTextMimeOf(String name, String currentMime, String requested) {
    if (requested != null && !requested.isBlank()) {
      return textMimeOf(name, requested);
    }
    String current = bareMime(currentMime);
    if (current != null && isTextMime(current) && !isHtmlLike(current)) {
      return current;
    }
    return textMimeOf(name, null);
  }

  /**
   * 내용으로 갱신해도 되는 파일인지(WP-369) — 현재 버전 MIME 이 텍스트 MIME({@link #isTextMime})이거나, octet-stream 으로
   * 저장됐지만 이름이 알려진 텍스트 확장자({@link #TEXT_EXTENSIONS})다. 브라우저는 .py·.js 를 octet-stream 으로 보내는 일이 많다.
   * pdf·docx·이미지·모르는 바이너리는 아니다.
   */
  static boolean isTextLike(String mime, String name) {
    String bare = bareMime(mime);
    if (bare == null) {
      return false;
    }
    if (isTextMime(bare)) {
      return true;
    }
    String ext = FilePathBuilder.extensionOf(name == null ? "" : name).toLowerCase(Locale.ROOT);
    return bare.equals("application/octet-stream") && TEXT_EXTENSIONS.contains(ext);
  }

  /**
   * 텍스트 MIME 인지(매개변수를 뗀 소문자 값) — text/* 전부, 텍스트로 읽는 application 형식들, application/*+json·*+xml.
   * image/svg+xml 은 이미지라 넣지 않는다.
   */
  static boolean isTextMime(String bare) {
    return bare.startsWith("text/")
        || TEXT_APPLICATION_MIMES.contains(bare)
        || (bare.startsWith("application/") && (bare.endsWith("+json") || bare.endsWith("+xml")));
  }

  /** html·xml 계열인지 — 브라우저가 문서로 렌더링해 스크립트를 실행할 수 있는 형식(XHTML 네임스페이스 스크립트 포함). */
  static boolean isHtmlLike(String bare) {
    return bare.equals("text/html")
        || bare.equals("text/xml")
        || bare.equals("application/xml")
        || bare.endsWith("+xml");
  }

  /**
   * Content-Type·MIME 에서 매개변수(charset 등)를 떼고 소문자로 — "text/plain; charset=utf-8" 이 범주표·허용 목록에서 빠지지
   * 않게. 없거나 본체가 비면 null. 업로드 링크(Content-Type)와 텍스트 갱신(저장 MIME)이 같이 쓴다.
   */
  static String bareMime(String contentType) {
    if (contentType == null || contentType.isBlank()) {
      return null;
    }
    String mime = contentType.split(";", 2)[0].strip().toLowerCase(Locale.ROOT);
    return mime.isEmpty() ? null : mime;
  }

  /**
   * ID 로 지정한 파일에 새 버전 추가(WP-369) — 이름으로 찾지 않는다. 파일 지정 업로드 링크 PUT 이 쓴다. 이름·폴더는 그대로이고, 저장 이름(FILE 원본
   * 이름·확장자로 정하는 MIME)은 파일의 <b>지금 이름</b>이다 — 링크 발급 뒤 이름이 바뀌어도 같은 파일에 들어간다.
   *
   * @throws DriveFileNotFoundException 없거나 휴지통 파일(404)
   * @throws com.workplace.drive.exception.DriveSpaceNotFoundException 공간 비멤버(존재 은닉)
   * @throws com.workplace.drive.exception.DriveForbiddenException EDITOR 미만 · 보관된 공간
   */
  @Transactional
  public DriveFileResponse addVersion(long callerId, long driveFileId, UploadSource source)
      throws IOException {
    DriveFileRepository.DriveFileRow row =
        files.findRow(driveFileId).orElseThrow(() -> new DriveFileNotFoundException(driveFileId));
    perms.requireRole(row.spaceId(), callerId, "EDITOR");
    // 저장 이름은 store 가 행 잠금 아래에서 읽은 지금 이름으로 바꾼다.
    return bindVersion(callerId, row, source);
  }

  /**
   * 파일 지정 버전 추가 사전 검사(쓰기 없음) — 파일이 살아 있고 호출자가 그 파일 공간의 EDITOR 이상인지. 파일 지정 업로드 링크 발급과 PUT 의 발급자 재확인이
   * 쓴다(WP-369).
   *
   * @return 대상 파일 행(이름·공간)
   * @throws DriveFileNotFoundException 없거나 휴지통 파일(404)
   * @throws com.workplace.drive.exception.DriveSpaceNotFoundException 공간 비멤버(존재 은닉)
   * @throws com.workplace.drive.exception.DriveForbiddenException EDITOR 미만 · 보관된 공간
   */
  @Transactional(readOnly = true)
  public DriveFileRepository.DriveFileRow validateVersionTarget(long callerId, long driveFileId) {
    DriveFileRepository.DriveFileRow row =
        files.findRow(driveFileId).orElseThrow(() -> new DriveFileNotFoundException(driveFileId));
    perms.requireRole(row.spaceId(), callerId, "EDITOR");
    return row;
  }

  /**
   * 업로드 대상 사전 검사(쓰기 없음) — EDITOR 이상이고 폴더(있으면)가 그 공간의 활성 폴더인지. 업로드 링크 발급이 쓴다(WP-369).
   *
   * @throws com.workplace.drive.exception.DriveSpaceNotFoundException 공간 비멤버(존재 은닉)
   * @throws com.workplace.drive.exception.DriveForbiddenException EDITOR 미만 · 보관된 공간
   * @throws DriveFolderNotFoundException 없거나 휴지통 폴더
   * @throws DriveInvalidTargetException 다른 공간의 폴더
   */
  @Transactional(readOnly = true)
  public void validateUploadTarget(long callerId, long spaceId, Long folderId) {
    perms.requireRole(spaceId, callerId, "EDITOR");
    validateTargetSameSpace(spaceId, folderId, UPLOAD_OTHER_SPACE_MESSAGE);
  }

  /**
   * 업로드 공통 핵심(WP-369 에서 바이트 출처와 분리) — 멀티파트·텍스트로 만들기·업로드 링크가 모두 이 순서를 탄다: 권한(EDITOR) → 폴더 소속 검증 →
   * 할당량 검사(advisory lock) → file core 저장 → 영구화 → drive_file 바인딩 → 감사 → 추출 이벤트 → 변경 알림. 동명 활성 파일이
   * 있으면 새 버전으로 흡수(#79), 없으면 새 파일 + v1.
   *
   * <p>행위자는 {@code callerId} 로만 받는다 — 아래(감사·알림·추출·file core) 어디도 SecurityContext 를 읽지 않아, 인증 주체가 없는
   * 공개 업로드 링크 경로도 발급자를 그대로 넘기면 된다(R3).
   */
  @Transactional
  public DriveFileResponse upload(long callerId, long spaceId, Long folderId, UploadSource source)
      throws IOException {
    perms.requireRole(spaceId, callerId, "EDITOR");
    // 폴더가 이 공간 소속인지(WP-369 이전에는 검사하지 않아 다른 공간 폴더 id 로 올릴 수 있었다).
    validateTargetSameSpace(spaceId, folderId, UPLOAD_OTHER_SPACE_MESSAGE);
    return store(callerId, spaceId, folderId, source, null);
  }

  /** 지정 파일에 새 버전 — 권한 검사를 마친 호출부(텍스트 갱신·{@link #addVersion})가 부른다. 파일의 공간·폴더로 공유 핵심을 탄다. */
  private DriveFileResponse bindVersion(
      long callerId, DriveFileRepository.DriveFileRow row, UploadSource source) throws IOException {
    return store(callerId, row.spaceId(), row.folderId(), source, row.id());
  }

  /**
   * 업로드 공유 핵심(권한 검사 뒤) — 할당량 검사(advisory lock) → (지정 파일이면 행 잠금) → file core 저장 → 영구화 → drive_file
   * 바인딩 → 감사 → 추출 이벤트 → 변경 알림.
   *
   * @param targetDriveFileId 새 버전을 더할 파일(WP-369, ID 지정 갱신). null 이면 같은 폴더의 동명 활성 파일을 찾아 있으면 새 버전,
   *     없으면 새 파일 + v1(#79). 지정하면 그 행을 잠가 살아 있는지 다시 보고, 저장 이름은 잠금 아래에서 읽은 지금 이름이다
   */
  private DriveFileResponse store(
      long callerId, long spaceId, Long folderId, UploadSource source, Long targetDriveFileId)
      throws IOException {
    // 쿼터 강제: 테넌트 단위 직렬화 잠금 후 사용량 검사(동시 업로드 레이스 방지, #81).
    Long tenantId = TenantContext.get();
    if (tenantId != null) {
      quotaRepo.advisoryLockTenant(tenantId);
    }
    UploadSource toStore = source;
    if (targetDriveFileId != null) {
      // 휴지통·이름 변경 경합(WP-369): 호출부의 findRow 뒤에 휴지통 이동이 커밋되면 휴지통 파일에 버전이 붙는다. 그래서 advisory lock
      // 다음·blob 저장 전에 행을 잠그고(FOR UPDATE) trashed_at 을 다시 본다. 순서는 반드시 advisory → 행(동명 업로드·롤백과 같은
      // 순서) — findRow 에서 잠그면 순서가 뒤집혀 교착할 수 있다. blob 저장 전이라 거절돼도 고아 blob 이 남지 않는다.
      DriveFileRepository.DriveFileRow locked =
          files
              .lockActiveRow(targetDriveFileId)
              .orElseThrow(() -> new DriveFileNotFoundException(targetDriveFileId));
      toStore =
          new UploadSource(locked.name(), source.contentType(), source.size(), source.writer());
    }
    quota.assertWithinQuota(toStore.size());
    FileUploadResponse uploaded = fileUpload.upload(toStore, callerId);
    files.promoteFile(uploaded.id());

    String name = uploaded.originalName();
    long driveFileId;
    String actionType;
    int versionNo;
    // 지정 파일이 있으면 그 파일, 아니면 동명 활성 파일을 새 버전으로 흡수. 둘 다 없으면 새 파일 + v1 (#79)
    var existing =
        targetDriveFileId != null
            ? Optional.of(targetDriveFileId)
            : files.findActiveByName(spaceId, folderId, name);
    if (existing.isPresent()) {
      driveFileId = existing.get();
      versionNo = versions.nextVersionNo(driveFileId);
      versions.insert(driveFileId, versionNo, uploaded.id(), uploaded.fileSize(), callerId, null);
      files.setCurrentVersion(driveFileId, uploaded.id(), versionNo);
      actionType = "FILE_VERSION_CREATED";
    } else {
      // insertWithInitialVersion 이 drive_file + v1 버전 행을 원자적으로 생성(#79 불변식 강제)
      driveFileId =
          files.insertWithInitialVersion(
              spaceId, folderId, uploaded.id(), name, uploaded.fileSize(), callerId);
      versionNo = 1;
      actionType = "FILE_UPLOAD";
    }

    // 감사 로그 — 같은 @Transactional 안에서 기록(#81).
    auditLogService.log(
        callerId,
        usernameOf(callerId),
        actionType,
        "drive",
        String.valueOf(driveFileId),
        ("FILE_VERSION_CREATED".equals(actionType) ? "드라이브 파일 새 버전: " : "드라이브 파일 업로드: ")
            + name
            + " (v"
            + versionNo
            + ")",
        null,
        null,
        "SUCCESS",
        null,
        Map.of(
            "spaceId", spaceId,
            "fileName", name,
            "sizeBytes", uploaded.fileSize(),
            "versionNo", versionNo));

    // 추출 파이프라인 트리거(WP-242) — 같은 트랜잭션에서 file_extraction 행이 생기고, 커밋 후 워커로 디스패치된다.
    // 드라이브는 요약·임베딩까지 하는 FULL 프로파일.
    eventPublisher.publishEvent(
        FileExtractionRequestedEvent.of(
            uploaded.id(), uploaded.mimeType(), ExtractionProfile.FULL));

    // 새 버전 흡수도 created 로 둔다(프론트는 op 구분 없이 목록을 갱신).
    notifier.itemsChanged(OP_CREATED, spaceId, List.of(driveFileId), callerId);
    final long fid = driveFileId;
    return files.findResponse(fid).orElseThrow(() -> new DriveFileNotFoundException(fid));
  }

  /** 다운로드. drive 권한(VIEWER+)으로 인가한 뒤 file core 신뢰 read. */
  @Transactional(readOnly = true)
  public FileContentResult download(long callerId, long driveFileId) throws IOException {
    DriveFileRepository.DriveFileRow row =
        files.findRow(driveFileId).orElseThrow(() -> new DriveFileNotFoundException(driveFileId));
    perms.requireRole(row.spaceId(), callerId, "VIEWER");
    return fileUpload.getFileContentTrusted(row.fileId()).withName(row.name());
  }

  /**
   * 파일 콘텐츠 요약 조회(#526). drive 권한(VIEWER+)으로 인가 후 file_extraction 신뢰 read. 접근 게이트는 download 와
   * 동일(스페이스 멤버십). 트랜잭션 안에서 호출되어 테넌트 GUC 가 주입된다.
   */
  @Transactional(readOnly = true)
  public FileSummaryResponse fileSummary(long callerId, long driveFileId) {
    DriveFileRepository.DriveFileRow row =
        files.findRow(driveFileId).orElseThrow(() -> new DriveFileNotFoundException(driveFileId));
    perms.requireRole(row.spaceId(), callerId, "VIEWER");
    var r = summaries.findSummary(row.fileId());
    // 사유 문구는 fileai 공용 변환을 쓴다(WP-242) — 첨부 구간 읽기와 같은 코드·문구.
    String reason =
        ExtractionReasons.message(ExtractionReasons.classify(r.status(), r.error(), r.mime()));
    return new FileSummaryResponse(r.summary(), r.status(), reason);
  }

  /**
   * 파일 추출 텍스트 구간 읽기(WP-346). 게이트는 download·summary 와 같다 — drive 권한(VIEWER+)으로 인가하고, 없는·휴지통 파일은 404,
   * 스페이스 비멤버는 존재 은닉. 현재 버전의 file.id 로 읽으며 상태(PENDING·EXTRACTING·FAILED·SKIPPED 등)·사유·자르기는 {@link
   * ExtractedTextService#read} 가 이슈 첨부 /text 와 같은 형식으로 돌려준다.
   */
  @Transactional(readOnly = true)
  public ExtractedTextSlice readText(long callerId, long driveFileId, int offset, int limit) {
    DriveFileRepository.DriveFileRow row =
        files.findRow(driveFileId).orElseThrow(() -> new DriveFileNotFoundException(driveFileId));
    perms.requireRole(row.spaceId(), callerId, "VIEWER");
    return extractedText.read(row.fileId(), offset, limit);
  }

  /**
   * 공유 링크 다운로드. 멤버십 검사 없이(capability URL) 컨텍스트 설정 후 file core 신뢰 read. trashed 파일은 findRow 가 제외 →
   * 호출부에서 NotFound 처리.
   */
  @Transactional(readOnly = true)
  public FileContentResult downloadViaShareLink(long driveFileId) throws IOException {
    DriveFileRepository.DriveFileRow row =
        files.findRow(driveFileId).orElseThrow(() -> new DriveFileNotFoundException(driveFileId));
    return fileUpload.getFileContentTrusted(row.fileId()).withName(row.name());
  }

  /** 썸네일. drive 권한(VIEWER+)으로 인가한 뒤 file core 신뢰 read. 없으면 빈 Optional → 컨트롤러 404. */
  @Transactional(readOnly = true)
  public Optional<FileContentResult> thumbnail(long callerId, long driveFileId) throws IOException {
    DriveFileRepository.DriveFileRow row =
        files.findRow(driveFileId).orElseThrow(() -> new DriveFileNotFoundException(driveFileId));
    perms.requireRole(row.spaceId(), callerId, "VIEWER");
    return fileUpload.getThumbnailContentTrusted(row.fileId());
  }

  /**
   * 파일 삭제 가능 여부만 판정한다(쓰기 없음 — 시퀀스 증가·감사 로그 미수행). #842 — 확인 카드 사전검증(dry-run)과 실행 경로가 공유하는 술어. {@link
   * #delete} 가 같은 {@link #checkDeletable} 을 호출하므로 술어 포크가 없다.
   *
   * @throws DriveFileNotFoundException 파일 없음(또는 이미 휴지통)
   * @throws com.workplace.drive.exception.DriveSpaceNotFoundException 공간 비멤버(존재 은닉)
   * @throws com.workplace.drive.exception.DriveForbiddenException EDITOR 미만 · 보관된 공간
   */
  @Transactional(readOnly = true)
  public void validateDeletable(long callerId, long driveFileId) {
    checkDeletable(callerId, driveFileId);
  }

  /** 삭제 술어 본체 — 존재·권한을 확인하고 대상 행을 돌려준다(실행 경로가 감사 로그용으로 재사용). */
  private DriveFileRepository.DriveFileRow checkDeletable(long callerId, long driveFileId) {
    DriveFileRepository.DriveFileRow row =
        files.findRow(driveFileId).orElseThrow(() -> new DriveFileNotFoundException(driveFileId));
    perms.requireRole(row.spaceId(), callerId, "EDITOR");
    return row;
  }

  /** 삭제 = 휴지통으로(soft). drive_file 행 보존·trashed 표시. blob 은 영구삭제 시점까지 보존. */
  @Transactional
  public void delete(long callerId, long driveFileId) {
    DriveFileRepository.DriveFileRow row = checkDeletable(callerId, driveFileId);
    long opId = dsl.nextval(com.workplace.jooq.Sequences.DRIVE_TRASH_OP_SEQ);
    files.markTrashed(driveFileId, opId);
    // 감사 로그 — FILE_DELETE(#81), 같은 @Transactional 안에서 기록.
    auditLogService.log(
        callerId,
        usernameOf(callerId),
        "FILE_DELETE",
        "drive",
        String.valueOf(driveFileId),
        "드라이브 파일 삭제: " + row.name(),
        null,
        null,
        "SUCCESS",
        null,
        Map.of("spaceId", row.spaceId(), "fileName", row.name()));
    notifier.itemsChanged(OP_DELETED, row.spaceId(), List.of(driveFileId), callerId);
  }

  /** 추출 파이프라인 이벤트 발행용 — 업로드 커밋 후 FileExtractionListener 가 file_extraction 행 생성. */
  private final ApplicationEventPublisher eventPublisher;

  /** 버전 이력 목록(VIEWER). 최신(version_no 최대) 행을 current 로 표시. */
  @Transactional(readOnly = true)
  public java.util.List<com.workplace.drive.dto.DriveFileVersionResponse> listVersions(
      long callerId, long driveFileId) {
    DriveFileRepository.DriveFileRow row =
        files.findRow(driveFileId).orElseThrow(() -> new DriveFileNotFoundException(driveFileId));
    perms.requireRole(row.spaceId(), callerId, "VIEWER");
    var rows = versions.listForDriveFile(driveFileId); // version_no DESC
    java.util.List<com.workplace.drive.dto.DriveFileVersionResponse> out =
        new java.util.ArrayList<>();
    for (int i = 0; i < rows.size(); i++) {
      var v = rows.get(i);
      out.add(
          new com.workplace.drive.dto.DriveFileVersionResponse(
              v.versionNo(),
              v.fileId(),
              v.sizeBytes(),
              v.uploadedBy(),
              v.uploadedByName(),
              v.createdAt(),
              v.comment(),
              i == 0)); // DESC 정렬의 첫 행이 최신=현재
    }
    return out;
  }

  /** 특정 버전 blob 다운로드(VIEWER). */
  @Transactional(readOnly = true)
  public FileContentResult downloadVersion(long callerId, long driveFileId, int versionNo)
      throws IOException {
    DriveFileRepository.DriveFileRow row =
        files.findRow(driveFileId).orElseThrow(() -> new DriveFileNotFoundException(driveFileId));
    perms.requireRole(row.spaceId(), callerId, "VIEWER");
    var v =
        versions
            .findVersion(driveFileId, versionNo)
            .orElseThrow(() -> new DriveFileNotFoundException(driveFileId));
    // 지난 버전은 올릴 때 이름 그대로 — 확장자를 바꿔 이름을 고친 뒤에도 옛 형식 버전이 새 확장자로 내려가지 않게.
    return fileUpload.getFileContentTrusted(v.fileId());
  }

  /** 롤백(#79) — 대상 버전 blob 을 물리 클론해 새 버전으로 append(비파괴). EDITOR. */
  @Transactional
  public DriveFileResponse rollback(long callerId, long driveFileId, int targetVersionNo)
      throws IOException {
    DriveFileRepository.DriveFileRow row =
        files.findRow(driveFileId).orElseThrow(() -> new DriveFileNotFoundException(driveFileId));
    perms.requireRole(row.spaceId(), callerId, "EDITOR");
    var target =
        versions
            .findVersion(driveFileId, targetVersionNo)
            .orElseThrow(() -> new DriveFileNotFoundException(driveFileId));
    // 새 blob 이 생기므로 쿼터 검사(테넌트 직렬화 잠금).
    Long tenantId = TenantContext.get();
    if (tenantId != null) {
      quotaRepo.advisoryLockTenant(tenantId);
    }
    quota.assertWithinQuota(target.sizeBytes());
    long newFileId = fileUpload.copyFile(target.fileId(), callerId);
    int newVersionNo = versions.nextVersionNo(driveFileId);
    versions.insert(
        driveFileId,
        newVersionNo,
        newFileId,
        target.sizeBytes(),
        callerId,
        "v" + targetVersionNo + "에서 복원");
    files.setCurrentVersion(driveFileId, newFileId, newVersionNo);
    notifier.itemsChanged(OP_UPDATED, row.spaceId(), List.of(driveFileId), callerId);

    auditLogService.log(
        callerId,
        usernameOf(callerId),
        "FILE_ROLLBACK",
        "drive",
        String.valueOf(driveFileId),
        "드라이브 파일 롤백: " + row.name() + " (v" + targetVersionNo + " → v" + newVersionNo + ")",
        null,
        null,
        "SUCCESS",
        null,
        Map.of(
            "fromVersionNo", targetVersionNo,
            "toVersionNo", newVersionNo,
            "fileName", row.name()));

    return files
        .findResponse(driveFileId)
        .orElseThrow(() -> new DriveFileNotFoundException(driveFileId));
  }

  /**
   * 이름 변경(WP-335). EDITOR 이상·보관되지 않은 공간만(requireRole 이 보관 공간 쓰기를 막는다). 이름은 NFC 정규화·앞뒤 공백 제거 후 저장하고,
   * 같은 폴더의 다른 활성 파일과 겹치면 409. 현재 이름과 같으면 쓰기·발행 없이 그대로 돌려준다.
   */
  @Transactional
  public DriveFileResponse rename(long callerId, long driveFileId, String name) {
    DriveFileRepository.DriveFileRow row =
        files.findRow(driveFileId).orElseThrow(() -> new DriveFileNotFoundException(driveFileId));
    perms.requireRole(row.spaceId(), callerId, "EDITOR");
    String newName = SafeFileNames.validate(name, "파일");
    if (!newName.equals(row.name())) {
      requireNameFree(row.spaceId(), row.folderId(), newName);
      files.rename(driveFileId, newName);
      auditLogService.log(
          callerId,
          usernameOf(callerId),
          "FILE_RENAME",
          "drive",
          String.valueOf(driveFileId),
          "드라이브 파일 이름 변경: " + row.name() + " → " + newName,
          null,
          null,
          "SUCCESS",
          null,
          Map.of("spaceId", row.spaceId(), "fileName", newName, "previousName", row.name()));
      notifier.itemsChanged(OP_UPDATED, row.spaceId(), List.of(driveFileId), callerId);
    }
    return files
        .findResponse(driveFileId)
        .orElseThrow(() -> new DriveFileNotFoundException(driveFileId));
  }

  /** 이동 — 같은 공간 다른 폴더로 folder_id 변경. 같은 폴더면 no-op. 동명 충돌 시 409. */
  @Transactional
  public void move(long callerId, long driveFileId, Long targetFolderId) {
    move(callerId, driveFileId, targetFolderId, true);
  }

  /**
   * 이동 본체. notify=false 면 resource.changed 를 발행하지 않는다 — 벌크 이동이 항목마다 발행하지 않고 끝에서 1건으로 묶기 위함(WP-63).
   * 반환값은 파일이 속한 공간 id(no-op 이동 포함) — 벌크 이동이 공간별 통지를 묶을 때 항목마다 사전 조회하지 않게 한다.
   */
  @Transactional
  public long move(long callerId, long driveFileId, Long targetFolderId, boolean notify) {
    DriveFileRepository.DriveFileRow row =
        files.findRow(driveFileId).orElseThrow(() -> new DriveFileNotFoundException(driveFileId));
    perms.requireRole(row.spaceId(), callerId, "EDITOR");
    validateTargetSameSpace(row.spaceId(), targetFolderId);
    // 같은 폴더로의 이동은 no-op — 자기 자신과의 이름 충돌로 인한 잘못된 409 방지
    if (java.util.Objects.equals(row.folderId(), targetFolderId)) {
      return row.spaceId();
    }
    requireNameFree(row.spaceId(), targetFolderId, row.name());
    files.updateFolder(driveFileId, targetFolderId);
    if (notify) {
      notifier.itemsChanged(OP_UPDATED, row.spaceId(), List.of(driveFileId), callerId);
    }
    return row.spaceId();
  }

  /** 복사 — blob 물리 복제(영구) 후 새 drive_file 바인딩. 단일 txn(promote 단계 없음). */
  @Transactional
  public DriveFileResponse copy(long callerId, long driveFileId, Long targetFolderId)
      throws IOException {
    DriveFileRepository.DriveFileRow row =
        files.findRow(driveFileId).orElseThrow(() -> new DriveFileNotFoundException(driveFileId));
    perms.requireRole(row.spaceId(), callerId, "EDITOR");
    validateTargetSameSpace(row.spaceId(), targetFolderId);
    // 쿼터 강제: 복사도 새 바이트를 소비하므로 upload 와 동일하게 advisory lock + 검사(#81).
    Long tenantId = TenantContext.get();
    if (tenantId != null) {
      quotaRepo.advisoryLockTenant(tenantId);
    }
    // 복사 원본의 파일 크기를 FILE 테이블에서 직접 조회한다.
    Long copiedSizeBytes =
        dsl.select(com.workplace.jooq.Tables.FILE.SIZE_BYTES)
            .from(com.workplace.jooq.Tables.FILE)
            .where(com.workplace.jooq.Tables.FILE.ID.eq(row.fileId()))
            .fetchOne(com.workplace.jooq.Tables.FILE.SIZE_BYTES);
    quota.assertWithinQuota(copiedSizeBytes == null ? 0L : copiedSizeBytes);
    requireNameFree(row.spaceId(), targetFolderId, row.name());
    long newFileId = fileUpload.copyFile(row.fileId(), callerId);
    // insertWithInitialVersion 으로 복사본도 v1 버전 행을 즉시 생성(#79 불변식 — copy 도 quota 집계·purge 대상)
    long newDriveFileId =
        files.insertWithInitialVersion(
            row.spaceId(),
            targetFolderId,
            newFileId,
            row.name(),
            copiedSizeBytes == null ? 0L : copiedSizeBytes,
            callerId);
    notifier.itemsChanged(OP_CREATED, row.spaceId(), List.of(newDriveFileId), callerId);
    return files.listInFolder(row.spaceId(), targetFolderId).stream()
        .filter(f -> f.id() == newDriveFileId)
        .findFirst()
        .orElseThrow(() -> new DriveFileNotFoundException(newDriveFileId));
  }

  /**
   * 감사 로그용 사용자명 조회. 없으면 userId 문자열로 대체(#81). 전송 링크 감사(WP-369)도 같은 규칙을 쓰도록 공개한다.
   *
   * <p>AuthService 와 동일하게 UserRepository.findById 를 통해 username 을 얻는다.
   */
  public String usernameOf(long userId) {
    return userRepository
        .findById(userId)
        .map(com.workplace.user.dto.UserResponse::username)
        .orElse(String.valueOf(userId));
  }

  /** 폴더에 같은 이름의 활성 파일이 있으면 409(#79 부분 유니크 인덱스 대응) — 이름 변경·이동·복사 공용. */
  private void requireNameFree(long spaceId, Long folderId, String name) {
    if (files.findActiveByName(spaceId, folderId, name).isPresent()) {
      throw new DriveDuplicateNameException(name);
    }
  }

  /** 업로드 대상 폴더가 다른 공간일 때 문구(WP-369) — 이동·복사 문구와 구분한다. */
  private static final String UPLOAD_OTHER_SPACE_MESSAGE = "다른 공간의 폴더에는 파일을 올릴 수 없습니다.";

  /** 이동·복사 대상 폴더(있으면)가 같은 공간인지 검증. */
  private void validateTargetSameSpace(long spaceId, Long targetFolderId) {
    validateTargetSameSpace(spaceId, targetFolderId, "다른 공간으로는 이동/복사할 수 없습니다.");
  }

  /** 대상 폴더(있으면)가 같은 공간의 활성 폴더인지 검증. null = 공간 루트(항상 같은 공간). 없거나 휴지통이면 404, 다른 공간이면 400. */
  private void validateTargetSameSpace(
      long spaceId, Long targetFolderId, String otherSpaceMessage) {
    if (targetFolderId == null) {
      return;
    }
    long targetSpace =
        folders
            .findSpaceId(targetFolderId)
            .orElseThrow(() -> new DriveFolderNotFoundException(targetFolderId));
    if (targetSpace != spaceId) {
      throw new DriveInvalidTargetException(otherSpaceMessage);
    }
  }
}
