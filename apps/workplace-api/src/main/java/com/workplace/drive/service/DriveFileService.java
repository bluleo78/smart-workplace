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
import com.workplace.file.exception.FileBlobMissingException;
import com.workplace.file.exception.FileSizeLimitExceededException;
import com.workplace.file.service.FileUploadService;
import com.workplace.file.service.FileUploadService.FileContentResult;
import com.workplace.file.service.MimeNormalizer;
import com.workplace.file.service.UploadSource;
import com.workplace.file.storage.FilePathBuilder;
import com.workplace.fileai.ExtractionProfile;
import com.workplace.fileai.ExtractionReasons;
import com.workplace.fileai.dto.ExtractedTextSlice;
import com.workplace.fileai.dto.ExtractionInfo;
import com.workplace.fileai.inbound.FileExtractionRequestedEvent;
import com.workplace.fileai.service.ExtractedTextService;
import com.workplace.filepreview.inbound.FilePreviewRequestedEvent;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.util.RawUploadContentTypes;
import com.workplace.global.util.SafeFileNames;
import com.workplace.user.repository.UserRepository;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.Reader;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CharsetDecoder;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
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
  private final DriveBlobCopier blobCopier;
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
   * <p>같은 폴더에 같은 이름의 활성 파일이 있어 그 파일의 새 버전이 될 때는 {@link #updateTextFile} 과 같은 규칙을 탄다(최종 리뷰 M2) — 텍스트
   * 계열이 아니면 409, 추출 텍스트가 원문과 다르면({@link #rewriteBlockerOf}) 409, MIME 은 {@link
   * #updatedTextMimeOf}(지금 MIME 유지). 이 판정은 저장 핵심이 잠근 그 행으로 한다.
   *
   * @throws IllegalArgumentException 허용하지 않는 mimeType(400)
   * @throws FileSizeLimitExceededException UTF-8 로 10MB 초과(400)
   * @throws DriveNotTextFileException 같은 이름의 기존 파일을 내용으로 고쳐 쓸 수 없음(409)
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
    return uploadInto(
        callerId,
        spaceId,
        folderId,
        UploadSource.ofBytes(name, mime, bytes),
        new TextRewrite(mimeType));
  }

  /**
   * 텍스트 파일 MIME 결정(R4) — 명시값은 허용 목록만(매개변수 제거·소문자), 없으면 확장자({@link MimeNormalizer#textMimeOf}), 모르면
   * text/plain.
   */
  static String textMimeOf(String name, String requested) {
    if (requested != null && !requested.isBlank()) {
      String mime = RawUploadContentTypes.bare(requested);
      // 명시값은 확장자 표의 넷만 — html 은 text/html 로 서빙되지 않게 뺐다. ";x" 처럼 본체가 빈 값(null)도 400.
      if (!MimeNormalizer.isTextMime(mime)) {
        throw new IllegalArgumentException(
            "mimeType 은 text/markdown, text/plain, text/csv, application/json 중 하나여야 합니다.");
      }
      return mime;
    }
    return MimeNormalizer.textMimeOf(name);
  }

  /**
   * 기존 파일을 텍스트 내용으로 갱신(WP-369) — 그 파일에 새 버전을 더한다. 이름·폴더는 바꾸지 않는다. 의미는 {@link #addVersion} 과 같다.
   *
   * <p>검사 순서가 존재 은닉을 지킨다: 없는·휴지통 파일 404 → 공간 비멤버 404 · EDITOR 미만 403 → 텍스트 계열이 아니면 409 → MIME(400)
   * → 크기(400) → (저장 핵심이 행을 잠근 뒤) 추출 텍스트가 원문과 다르면 409({@link #rewriteBlockerOf}). 역할 검사를 409 보다 먼저
   * 해야 비멤버가 파일 형식을 알아내지 못한다. 원문 판정은 blob 을 읽으므로 싼 검사를 모두 마친 뒤, 새 버전을 붙일 그 행을 잠근 상태에서 한다.
   *
   * <p>MIME 은 {@link #updatedTextMimeOf} 로 정한다 — 명시값은 R4 허용 목록만, 없으면 지금 MIME 을 유지한다(yaml·md·js 가
   * 버전마다 text/plain 으로 바뀌지 않게). 단 xml 계열과 확장자로만 텍스트로 본 octet-stream 은 파일 이름 확장자로 정해 xml 은
   * text/plain 이 된다(html 은 원문 판정에서 이미 409).
   *
   * @throws DriveFileNotFoundException 없거나 휴지통 파일(404)
   * @throws DriveNotTextFileException 현재 버전이 텍스트 계열({@link #isTextLike})이 아니거나 추출 텍스트가 원문과 다름(409)
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
    // 위 판정은 빠른 거절용이다 — 저장 핵심이 행을 잠근 뒤 그 행의 현재 버전으로 텍스트 계열·원문 판정·MIME 을 다시 정한다.
    return store(
        callerId,
        row.spaceId(),
        row.folderId(),
        UploadSource.ofBytes(row.name(), mime, bytes),
        row.id(),
        new TextRewrite(mimeType));
  }

  /**
   * 내용 모드(텍스트로 만들기·갱신, WP-369)가 기존 파일에 새 버전으로 들어갈 때의 표시 — 저장 핵심이 잠근 행으로 고쳐 쓰기 판정과 MIME 결정을 한다. 바이트
   * 업로드(멀티파트·업로드 링크)는 null 이다: 올린 파일이 원문 그대로라 추출과 무관하다.
   *
   * @param requestedMime 호출자가 명시한 mimeType(없으면 null — 지금 MIME 을 유지)
   */
  private record TextRewrite(String requestedMime) {}

  /** html 계열 — 워커 추출이 마크업을 걷어내 추출 텍스트가 원문이 아니다(최종 리뷰 I3). xml 은 워커가 원문 그대로 읽어 넣지 않는다. */
  private static final Set<String> MARKUP_STRIPPED_MIMES =
      Set.of("text/html", "application/xhtml+xml");

  private static final String UPLOAD_LINK_HINT = ". 업로드 링크로 파일을 올리세요";

  /**
   * 내용으로 고쳐 쓸 수 없는 사유(WP-369 최종 리뷰 I3·I4·m2). 경로마다 문구가 다르다 — 파일 지정 갱신({@code driveFileId})은 그 파일을
   * 고칠 수 없다는 문구, 같은 이름 텍스트 만들기는 "같은 이름의 파일(사유)이 있어" 다른 이름을 권하는 문구다. 호출자는 같은 이름 파일이 있는 줄 모를 수 있다.
   */
  private enum RewriteBlocker {
    NOT_TEXT("텍스트 아님", "텍스트 파일만 내용으로 갱신할 수 있습니다"),
    HTML("HTML", "HTML 파일은 읽은 텍스트가 마크업을 뺀 것이라 내용으로 고쳐 쓸 수 없습니다" + UPLOAD_LINK_HINT),
    TRUNCATED("추출 잘림", "파일이 커서 읽은 텍스트가 앞부분만이라 내용으로 고쳐 쓸 수 없습니다" + UPLOAD_LINK_HINT),
    TOO_LARGE("10MB 초과", "파일이 커서(10MB 초과) 내용으로 고쳐 쓸 수 없습니다" + UPLOAD_LINK_HINT),
    NOT_UTF8(
        "UTF-8 아님", "UTF-8 이 아닌 파일(예: CP949)이라 읽은 텍스트가 원문과 달라 내용으로 고쳐 쓸 수 없습니다" + UPLOAD_LINK_HINT);

    /** 같은 이름 경로 문구의 괄호 안 사유. */
    private final String label;

    /** 파일 지정 경로 문구. */
    private final String message;

    RewriteBlocker(String label, String message) {
      this.label = label;
      this.message = message;
    }

    /** 경로에 맞는 409 — {@code sameName} 이면 같은 이름 텍스트 만들기가 기존 파일에 흡수되려던 경우다. */
    DriveNotTextFileException toException(boolean sameName) {
      return new DriveNotTextFileException(
          sameName
              ? "같은 이름의 파일(" + label + ")이 있어 내용으로 새 버전을 만들 수 없습니다. 다른 이름을 쓰거나 업로드 링크로 올리세요"
              : message);
    }
  }

  /**
   * 잠근 기존 파일에 내용 모드 새 버전을 붙일 때의 MIME(WP-369) — 텍스트 계열이 아니거나 추출 텍스트가 원문과 다르면 409({@link
   * RewriteBlocker}), 그 밖은 {@link #updatedTextMimeOf}.
   *
   * @param sameName 이름 경로(같은 이름 텍스트 만들기)인지 — 409 문구를 고른다
   */
  private String rewriteMimeOf(
      DriveFileRepository.DriveFileRow locked, String requestedMime, boolean sameName)
      throws IOException {
    String currentMime = files.findCurrentMime(locked.fileId());
    RewriteBlocker blocker =
        isTextLike(currentMime, locked.name())
            ? rewriteBlockerOf(locked.fileId(), currentMime)
            : RewriteBlocker.NOT_TEXT;
    if (blocker != null) {
      throw blocker.toException(sameName);
    }
    return updatedTextMimeOf(locked.name(), currentMime, requestedMime);
  }

  /**
   * 내용으로 고쳐 써도 원문을 잃지 않는지(최종 리뷰 I3·I4) — AI 는 추출 텍스트를 읽고 고친 전문을 저장하므로, 추출 텍스트가 원문과 같은 파일만 허용한다. 막을
   * 사유가 있으면 그 사유, 없으면 null.
   *
   * <ol>
   *   <li>html 계열(text/html·application/xhtml+xml) — 워커가 마크업을 걷어낸다(xhtml 은 추출하지 않는다).
   *   <li>추출이 잘림(file_extraction.truncated) — 워커 MAX_CHARS 초과로 앞부분만 있다. 추출 행이 없거나 아직 PENDING 이면 알 수
   *       없어 다음 검사만으로 판단한다.
   *   <li>현재 버전이 텍스트 상한({@link #TEXT_FILE_MAX_BYTES}, 10MB)을 넘음 — 고쳐 쓴 전문도 10MB 를 넘을 수 없고, 잘리지 않은
   *       추출(기본 100만 자)은 UTF-8 로 4MB 이하라 읽을 수 있는 파일을 막지 않는다. 추출 상한(PDF·문서 100MB, 그 밖 25MB) 초과로
   *       SKIPPED 된 csv·추출하지 않는 octet-stream 로그처럼 잘림 표시가 없는 큰 파일을, 테넌트 advisory lock 을 쥔 채 끝까지 읽지
   *       않게 하는 상한이기도 하다.
   *   <li>현재 버전 blob 이 올바른 UTF-8 이 아님(예: CP949 CSV) — 워커가 대체 문자(U+FFFD)로 읽어 한글이 깨진다. 위 상한 덕에 많아야
   *       10MB 를 스트림으로 읽는다.
   * </ol>
   *
   * <p>blob 이 유실됐으면(행은 있고 바이트가 없음) 잃을 원문이 없으므로 크기·UTF-8 검사를 건너뛴다 — 추출 텍스트로 되살리는 것이 유일한 복구 길이다.
   */
  private RewriteBlocker rewriteBlockerOf(long fileId, String currentMime) throws IOException {
    String bare = RawUploadContentTypes.bare(currentMime);
    if (bare != null && MARKUP_STRIPPED_MIMES.contains(bare)) {
      return RewriteBlocker.HTML;
    }
    ExtractionInfo info = extractedText.info(List.of(fileId)).get(fileId);
    if (info != null && Boolean.TRUE.equals(info.truncated())) {
      return RewriteBlocker.TRUNCATED;
    }
    FileContentResult content;
    try {
      content = fileUpload.getFileContentTrusted(fileId);
    } catch (FileBlobMissingException e) {
      return null;
    }
    // 크기는 저장소 메타(fileStore.size)라 바이트를 읽지 않는다.
    if (content.size() > TEXT_FILE_MAX_BYTES) {
      return RewriteBlocker.TOO_LARGE;
    }
    return isUtf8(content) ? null : RewriteBlocker.NOT_UTF8;
  }

  /** blob 이 처음부터 끝까지 올바른 UTF-8 인지 — 엄격한 디코더(REPORT)로 스트림을 끝까지 읽는다. 끝의 잘린 바이트열도 거절된다. */
  private static boolean isUtf8(FileContentResult content) throws IOException {
    CharsetDecoder decoder =
        StandardCharsets.UTF_8
            .newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT);
    try (Reader reader = new InputStreamReader(content.resource().getInputStream(), decoder)) {
      char[] buffer = new char[8192];
      while (reader.read(buffer) != -1) {
        // 디코딩만 확인한다 — 글자는 버린다.
      }
      return true;
    } catch (CharacterCodingException e) {
      return false;
    }
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
    String current = RawUploadContentTypes.bare(currentMime);
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
    String bare = RawUploadContentTypes.bare(mime);
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
    return store(callerId, row.spaceId(), row.folderId(), source, row.id(), null);
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
    // 읽기 전용 사전 검사라 잠그지 않는다 — 실제 업로드가 다시 잠근 채 확인한다.
    validateTargetSameSpace(spaceId, folderId, UPLOAD_OTHER_SPACE_MESSAGE, false);
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
    return uploadInto(callerId, spaceId, folderId, source, null);
  }

  /** 이름으로 넣는 업로드 — 권한(EDITOR)·폴더 소속 검증 뒤 공유 핵심. {@code text} 는 내용 모드일 때만(동명 흡수 판정용). */
  private DriveFileResponse uploadInto(
      long callerId, long spaceId, Long folderId, UploadSource source, TextRewrite text)
      throws IOException {
    perms.requireRole(spaceId, callerId, "EDITOR");
    // 폴더가 이 공간 소속인지(WP-369 이전에는 검사하지 않아 다른 공간 폴더 id 로 올릴 수 있었다).
    validateTargetSameSpace(spaceId, folderId, UPLOAD_OTHER_SPACE_MESSAGE, true);
    return store(callerId, spaceId, folderId, source, null, text);
  }

  /**
   * 업로드 공유 핵심(권한 검사 뒤) — 할당량 검사(advisory lock) → 새 버전을 붙일 행 잠금 → file core 저장 → 영구화 → drive_file
   * 바인딩 → 감사 → 추출 이벤트 → 변경 알림.
   *
   * @param targetDriveFileId 새 버전을 더할 파일(WP-369, ID 지정 갱신). null 이면 같은 폴더의 동명 활성 파일을 찾아 있으면 새 버전,
   *     없으면 새 파일 + v1(#79). 어느 쪽이든 붙일 행을 잠가 살아 있는지 다시 보고, 저장 이름은 잠금 아래에서 읽은 지금 이름이다
   * @param text 내용 모드(텍스트로 만들기·갱신)면 그 표시, 바이트 업로드면 null — 기존 파일에 붙을 때 잠근 행으로 고쳐 쓰기 판정·MIME 을 정한다
   */
  private DriveFileResponse store(
      long callerId,
      long spaceId,
      Long folderId,
      UploadSource source,
      Long targetDriveFileId,
      TextRewrite text)
      throws IOException {
    // 쿼터 강제: 테넌트 단위 직렬화 잠금 후 사용량 검사(동시 업로드 레이스 방지, #81).
    Long tenantId = TenantContext.get();
    if (tenantId != null) {
      quotaRepo.advisoryLockTenant(tenantId);
    }
    // 휴지통·이름 변경·이동 경합(WP-369): 찾은 뒤 휴지통 이동이 커밋되면 휴지통 파일에 버전이 붙는다. 그래서 advisory lock 다음·blob
    // 저장 전에 붙일 행을 잠그고(FOR UPDATE) trashed_at 을 다시 본다. 순서는 반드시 advisory → 행(롤백과 같은 순서) — 반대로 잡으면 교착할
    // 수 있다. blob 저장 전이라 거절돼도 고아 blob 이 남지 않는다.
    DriveFileRepository.DriveFileRow locked;
    if (targetDriveFileId != null) {
      locked =
          files
              .lockActiveRow(targetDriveFileId)
              .orElseThrow(() -> new DriveFileNotFoundException(targetDriveFileId));
    } else {
      // 이름 경로(최종 리뷰 I1): file core 와 같은 정리로 이름을 먼저 정해 동명 행을 찾고 잠근다.
      locked =
          lockActiveByName(
              spaceId, folderId, SafeFileNames.sanitize(source.originalName(), "file"));
    }
    UploadSource toStore = source;
    if (locked != null) {
      // 내용 모드가 기존 파일에 붙으면 잠근 행의 현재 버전으로 고쳐 쓰기 판정·MIME 을 정한다(I3·M2). 바이트 업로드는 올린 형식 그대로.
      String contentType =
          text == null
              ? source.contentType()
              : rewriteMimeOf(locked, text.requestedMime(), targetDriveFileId == null);
      toStore = new UploadSource(locked.name(), contentType, source.size(), source.writer());
    }
    quota.assertWithinQuota(toStore.size());
    FileUploadResponse uploaded = fileUpload.upload(toStore, callerId);
    files.promoteFile(uploaded.id());

    String name = uploaded.originalName();
    long driveFileId;
    String actionType;
    int versionNo;
    // 잠근 행(지정 파일 또는 동명 활성 파일)이 있으면 새 버전으로 흡수, 없으면 새 파일 + v1 (#79)
    if (locked != null) {
      driveFileId = locked.id();
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
    // 문서 미리 변환(WP-431) — 드라이브 업로드·새 버전만. 커밋 후 리스너가 백그라운드 실행기에 넘긴다(첫 열람을 빠르게).
    // 롤백·복사로 생긴 버전은 발행하지 않는다 — 첫 열람 때 변환한다.
    eventPublisher.publishEvent(
        FilePreviewRequestedEvent.of(uploaded.id(), uploaded.mimeType(), uploaded.originalName()));

    // 새 버전 흡수도 created 로 둔다(프론트는 op 구분 없이 목록을 갱신).
    notifier.itemsChanged(OP_CREATED, spaceId, List.of(driveFileId), callerId);
    final long fid = driveFileId;
    return files.findResponse(fid).orElseThrow(() -> new DriveFileNotFoundException(fid));
  }

  /**
   * 같은 폴더의 동명 활성 파일을 찾아 잠근다(최종 리뷰 I1·m1). 잠그는 사이 그 파일이 휴지통으로 갔거나 이름·폴더가 바뀌었으면 한 번 더 찾는다 — 다른 파일이 막
   * 그 이름으로 바뀌어 들어온 3자 경합이면 그 파일을 잠가 새 버전으로 흡수한다. 그래도 없으면 null(새 파일 + v1, 거절이 아니다). 두 번째 조회 뒤에도 남는
   * 아주 좁은 경합은 유일 인덱스(uq_drive_file_active_name)가 막고 호출부가 409 로 바꾼다.
   */
  private DriveFileRepository.DriveFileRow lockActiveByName(
      long spaceId, Long folderId, String name) {
    for (int attempt = 0; attempt < 2; attempt++) {
      Optional<Long> found = files.findActiveByName(spaceId, folderId, name);
      if (found.isEmpty()) {
        return null;
      }
      Optional<DriveFileRepository.DriveFileRow> locked =
          found
              .flatMap(files::lockActiveRow)
              .filter(r -> r.name().equals(name) && Objects.equals(r.folderId(), folderId));
      if (locked.isPresent()) {
        return locked.get();
      }
    }
    return null;
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
    // 권한 규칙은 resolveViewFileId 한 곳에 — /text 와 /view 가 같은 가드를 쓴다(같은 readOnly 트랜잭션 안에서 실행).
    return extractedText.read(resolveViewFileId(callerId, driveFileId), offset, limit);
  }

  /**
   * 이미지 보기용 파일 id 확인(WP-250, R5) — {@link #readText} 와 같은 가드(없는·휴지통 파일 404, 스페이스 VIEWER 이상)를 거쳐 현재
   * 버전의 core file.id 만 돌려준다.
   */
  @Transactional(readOnly = true)
  public long resolveViewFileId(long callerId, long driveFileId) {
    DriveFileRepository.DriveFileRow row =
        files.findRow(driveFileId).orElseThrow(() -> new DriveFileNotFoundException(driveFileId));
    perms.requireRole(row.spaceId(), callerId, "VIEWER");
    return row.fileId();
  }

  /**
   * 공유 링크 다운로드. 멤버십 검사 없이(capability URL) 컨텍스트 설정 후 file core 신뢰 read. trashed 파일은 findRow 가 제외 →
   * 없는 토큰과 같은 「공유 링크 없음」(404). 비로그인 사용자에게 내부 파일 id 와 토큰이 유효하다는 사실을 드러내지 않는다(WP-533).
   */
  @Transactional(readOnly = true)
  public FileContentResult downloadViaShareLink(long driveFileId) throws IOException {
    DriveFileRepository.DriveFileRow row =
        files
            .findRow(driveFileId)
            .orElseThrow(com.workplace.drive.exception.DriveShareLinkNotFoundException::new);
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
    // 휴지통 경합(최종 리뷰 I1): findRow 뒤에 휴지통 이동이 커밋되면 휴지통 파일에 버전이 붙고 복제 blob 이 남는다. advisory 다음·복제 전에
    // 행을 잠가(FOR UPDATE) 살아 있는지 다시 본다 — 업로드 핵심과 같은 advisory → 행 순서. 감사 이름도 잠근 행(지금 이름)에서 읽는다.
    DriveFileRepository.DriveFileRow locked =
        files
            .lockActiveRow(driveFileId)
            .orElseThrow(() -> new DriveFileNotFoundException(driveFileId));
    quota.assertWithinQuota(target.sizeBytes());
    // 복제 + 내용 추출 요청(WP-695) — 되돌린 버전이 원본의 검색·요약을 잃지 않게.
    long newFileId = blobCopier.copy(target.fileId(), callerId);
    int newVersionNo = versions.nextVersionNo(driveFileId);
    versions.insert(
        driveFileId,
        newVersionNo,
        newFileId,
        target.sizeBytes(),
        callerId,
        "v" + targetVersionNo + "에서 복원");
    files.setCurrentVersion(driveFileId, newFileId, newVersionNo);
    notifier.itemsChanged(OP_UPDATED, locked.spaceId(), List.of(driveFileId), callerId);

    auditLogService.log(
        callerId,
        usernameOf(callerId),
        "FILE_ROLLBACK",
        "drive",
        String.valueOf(driveFileId),
        "드라이브 파일 롤백: " + locked.name() + " (v" + targetVersionNo + " → v" + newVersionNo + ")",
        null,
        null,
        "SUCCESS",
        null,
        Map.of(
            "fromVersionNo", targetVersionNo,
            "toVersionNo", newVersionNo,
            "fileName", locked.name()));

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
    // 복제 + 내용 추출 요청(WP-695) — 복사본도 내용 검색·AI 요약 대상.
    long newFileId = blobCopier.copy(row.fileId(), callerId);
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
    validateTargetSameSpace(spaceId, targetFolderId, "다른 공간으로는 이동/복사할 수 없습니다.", true);
  }

  /**
   * 대상 폴더(있으면)가 같은 공간의 활성 폴더인지 검증. null = 공간 루트(항상 같은 공간). 없거나 휴지통이면 404, 다른 공간이면 400. lock 이면 대상
   * 폴더 행을 공유 잠금한 채 확인해, 동시에 그 폴더를 지우는 요청과 차례를 정한다(WP-764) — 쓰기 경로는 모두 lock.
   */
  private void validateTargetSameSpace(
      long spaceId, Long targetFolderId, String otherSpaceMessage, boolean lock) {
    if (targetFolderId == null) {
      return;
    }
    long targetSpace =
        (lock ? folders.lockLiveSpaceId(targetFolderId) : folders.findSpaceId(targetFolderId))
            .orElseThrow(() -> new DriveFolderNotFoundException(targetFolderId));
    if (targetSpace != spaceId) {
      throw new DriveInvalidTargetException(otherSpaceMessage);
    }
  }
}
