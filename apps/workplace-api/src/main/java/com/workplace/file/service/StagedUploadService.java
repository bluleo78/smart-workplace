package com.workplace.file.service;

import static com.workplace.jooq.Tables.FILE;

import com.workplace.audit.service.AuditLogService;
import com.workplace.file.api.StagedFileClaimer;
import com.workplace.file.dto.StagedFileResponse;
import com.workplace.file.dto.StagedUploadLinkResponse;
import com.workplace.file.exception.FileSizeLimitExceededException;
import com.workplace.file.exception.StagedUploadLinkForbiddenException;
import com.workplace.file.exception.StagedUploadLinkGoneException;
import com.workplace.file.exception.StagedUploadLinkNotFoundException;
import com.workplace.file.exception.StagedUploadRejectedException;
import com.workplace.file.repository.StagedUploadLinkRepository;
import com.workplace.file.repository.StagedUploadLinkRepository.StagedLinkRow;
import com.workplace.file.storage.FilePathBuilder;
import com.workplace.file.storage.FileStore;
import com.workplace.file.storage.StorageDomain;
import com.workplace.global.tenant.MembershipGuard;
import com.workplace.global.tenant.TenantStatusChecker;
import com.workplace.global.util.BoundedBody;
import com.workplace.global.util.CapabilityTokens;
import com.workplace.global.util.ClientIpExtractor;
import com.workplace.global.util.RawUploadContentTypes;
import com.workplace.global.util.SafeFileNames;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.repository.UserRepository;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Map;
import lombok.extern.slf4j.Slf4j;
import org.jooq.DSLContext;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 스테이징 업로드(WP-421) — MCP·AI 가 이슈·메시지·노트 등에 붙일 파일을 먼저 올려 두는 임시 첨부. 두 가지 길이 있다.
 *
 * <ul>
 *   <li><b>텍스트</b>({@link #createText}): AI 가 쓴 내용을 UTF-8 로 바로 저장(10MB 이하).
 *   <li><b>일회용 PUT 링크</b>({@link #issueLink} → 공개 PUT): 바이트가 MCP 를 거치지 않게 셸의 {@code curl -T} 가 공개
 *       경로로 직접 올린다(25MB 이하, 10분, 한 번).
 * </ul>
 *
 * <p>어느 길이든 결과는 같은 모양의 FILE 행이다: 업로더 = 호출자(링크는 발급자), category ATTACHMENT, 경로 {@code
 * tenant-*&#47;staged/…}, 만료 = 지금 + {@code temp-expiry-hours}(24). 그래야 {@link
 * com.workplace.file.api.StagedFileClaimer} 가 클레임할 수 있고, 아무도 클레임하지 않으면 일반 만료 스윕({@link
 * FileCleanupService})이 지운다. 범주별 MIME 상한·추출 이벤트는 여기서 보지 않는다 — 목적지 상한과 추출은 클레임한 도메인이 다시 본다.
 *
 * <p>공개 PUT 순서는 드라이브 업로드 링크({@code DriveTransferLinkService})와 같다(컨트롤러가 조립): {@link
 * #consumeUpload}(토큰·만료·본문 형식·선언 크기 확인 → 원자적 소비, 트랜잭션 밖) → TenantContext 설정 → {@link
 * #requireIssuerActive}(발급자 멤버십 재확인) → {@link #receiveBody}(세는 상한으로 임시 파일에 받기, DB 연결 없음) → {@link
 * #completeUpload}(저장·FILE INSERT·사용 감사, 한 트랜잭션) → finally 에서 컨텍스트 정리.
 */
@Slf4j
@Service
public class StagedUploadService {
  /** 링크 토큰 접두사 — 드라이브 전송 링크(dl_·ul_)·공유 링크(sl_)와 겹치지 않는다. */
  static final String TOKEN_PREFIX = "su_";

  /** 공개 업로드 경로 — SecurityConfig permitAll 과 공개 컨트롤러 매핑이 같은 값을 쓴다. */
  public static final String PUBLIC_PATH = "/api/v1/public/staged-files/";

  /** 링크 수명(드라이브 전송 링크와 같은 10분). */
  public static final Duration TTL = Duration.ofMinutes(10);

  /** 텍스트 모드 상한 — TEXT 범주 상한(10MB, UTF-8 바이트). */
  static final long TEXT_MAX_BYTES = FileUploadService.sizeLimitOf("TEXT");

  /** 감사 action — 링크 사용 성공. 무인증 접근이라 요청 IP·User-Agent 를 함께 남긴다. */
  public static final String AUDIT_LINK_USE = "STAGED_LINK_USE";

  private final StagedUploadLinkRepository links;
  private final DSLContext dsl;
  private final FilePathBuilder pathBuilder;
  private final FileStore fileStore;
  private final MembershipGuard membershipGuard;
  private final TenantStatusChecker tenantStatusChecker;
  private final AuditLogService auditLogService;
  private final UserRepository userRepository;

  /** 외부에서 닿는 웹 기준 주소(끝 슬래시 제거). 운영은 WEB_BASE_URL. */
  private final String publicBaseUrl;

  /** 링크 모드 상한 — 첨부 일률 25MB(범주 상한을 쓰지 않는다. 목적지 상한은 클레임에서 본다). */
  private final long linkMaxBytes;

  /** 임시 첨부 만료(시) — 이슈·메시지·노트 첨부의 임시 파일과 같은 값. */
  private final int tempExpiryHours;

  /** PUT 본문 임시 파일 디렉터리. 생성자에서 한 번 만들어 두고 요청마다 만들지 않는다. */
  private final Path tempDir;

  public StagedUploadService(
      StagedUploadLinkRepository links,
      DSLContext dsl,
      FilePathBuilder pathBuilder,
      FileStore fileStore,
      MembershipGuard membershipGuard,
      TenantStatusChecker tenantStatusChecker,
      AuditLogService auditLogService,
      UserRepository userRepository,
      @Value("${workplace.public-base-url}") String publicBaseUrl,
      @Value("${workplace.storage.attachment.max-file-size-bytes:26214400}") long linkMaxBytes,
      @Value("${workplace.storage.attachment.temp-expiry-hours:24}") int tempExpiryHours,
      @Value(
              "${workplace.storage.staged.temp-dir:${workplace.drive.transfer-temp-dir:${java.io.tmpdir}}}")
          String tempDir) {
    this.links = links;
    this.dsl = dsl;
    this.pathBuilder = pathBuilder;
    this.fileStore = fileStore;
    this.membershipGuard = membershipGuard;
    this.tenantStatusChecker = tenantStatusChecker;
    this.auditLogService = auditLogService;
    this.userRepository = userRepository;
    this.publicBaseUrl = CapabilityTokens.normalizeBaseUrl(publicBaseUrl);
    this.linkMaxBytes = linkMaxBytes;
    this.tempExpiryHours = tempExpiryHours;
    this.tempDir = BoundedBody.prepareTempDir(tempDir, "workplace.storage.staged.temp-dir");
  }

  /**
   * 텍스트로 스테이징 파일 만들기 — UTF-8 로 저장한다. MIME 은 이름 확장자로 정한다({@link MimeNormalizer#textMimeOf}:
   * md·txt·csv·json 외 text/plain — html 이 text/html 로 서빙되지 않게).
   *
   * @throws FileSizeLimitExceededException UTF-8 로 10MB 초과(400)
   */
  @Transactional
  public StagedFileResponse createText(long callerId, String name, String content) {
    String safeName = SafeFileNames.sanitize(name, "file");
    // UTF-8 바이트 수는 문자(UTF-16 코드 단위) 수 이상이다 — 문자 수만으로 넘으면 인코딩하지 않고 바로 거절한다.
    if (content.length() > TEXT_MAX_BYTES) {
      throw new FileSizeLimitExceededException("TEXT", TEXT_MAX_BYTES);
    }
    byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
    if (bytes.length > TEXT_MAX_BYTES) {
      throw new FileSizeLimitExceededException("TEXT", TEXT_MAX_BYTES);
    }
    String relativePath = pathBuilder.build(StorageDomain.STAGED, safeName);
    fileStore.storeBytes(relativePath, bytes);
    fileStore.deleteOnRollback(relativePath);
    return insertStagedFile(
        callerId, safeName, MimeNormalizer.textMimeOf(safeName), bytes.length, relativePath);
  }

  /**
   * 일회용 PUT 링크 발급 — 이름을 {@link SafeFileNames#sanitize} 로 정리해 링크에 묶는다. 발급자의 만료 행을 함께 정리한다. 권한 검사는 하지
   * 않는다(인증만) — 파일을 묶는 쪽 도메인이 클레임 때 권한을 본다.
   */
  @Transactional
  public StagedUploadLinkResponse issueLink(long callerId, String name) {
    String safeName = SafeFileNames.sanitize(name, "file");
    links.deleteExpiredByUser(callerId);
    String token = CapabilityTokens.generate(TOKEN_PREFIX);
    OffsetDateTime expiresAt = OffsetDateTime.now(ZoneOffset.UTC).plus(TTL);
    links.insert(CapabilityTokens.sha256Hex(token), callerId, safeName, expiresAt);
    return new StagedUploadLinkResponse(
        publicBaseUrl + PUBLIC_PATH + token, "PUT", expiresAt, linkMaxBytes, safeName, true);
  }

  /**
   * 공개 업로드 1·2단계 — 본문을 읽기 전에 토큰·만료를 확인하고, 본문 형식(폼·멀티파트·깨진·와일드카드 Content-Type 거부)과 선언된
   * 크기(Content-Length)를 본 뒤 원자적으로 소비한다. 트랜잭션 밖에서 부른다(소비가 뒤이은 실패와 함께 롤백되지 않게). 소비 전
   * 거부(404·410·415·400)는 링크를 태우지 않는다.
   *
   * <p>폼(application/x-www-form-urlencoded)은 Spring 의 FormContentFilter 가 PUT 본문을 미리 읽어 버려 빈 파일이
   * 저장되므로 받지 않는다 — curl 의 {@code --data-binary} 기본값이다. 형식이 깨졌거나 와일드카드인 Content-Type 은
   * FILE.mime_type 으로 저장되면 다운로드 응답 헤더를 만들 때마다 500 이 나므로 막는다.
   *
   * @param contentLength 요청 Content-Length(없으면 -1 — chunked). 넘치면 본문을 받기 전에 거부한다
   * @return 소비된 행
   */
  public StagedLinkRow consumeUpload(String token, String contentType, long contentLength) {
    String tokenHash = tokenHashFor(token);
    requireUsable(tokenHash);
    // 폼·멀티파트·깨진·와일드카드 Content-Type 거부 — 드라이브 업로드 링크와 같은 규칙(RawUploadContentTypes)
    RawUploadContentTypes.rejectReason(contentType)
        .ifPresent(
            r -> {
              throw new StagedUploadRejectedException(
                  HttpStatus.UNSUPPORTED_MEDIA_TYPE, r.message());
            });
    if (contentLength > linkMaxBytes) {
      throw new StagedUploadRejectedException(
          HttpStatus.BAD_REQUEST, "파일이 너무 큽니다 (최대 " + BoundedBody.toMb(linkMaxBytes) + "MB)");
    }
    StagedLinkRow link = links.consume(tokenHash).orElse(null);
    if (link == null) {
      // 0행 — 본문 전 확인과 같은 판정으로 404·410 을 가른다. 판정이 "쓸 수 있음"이면 그 사이 다른 요청이 소비한 것이므로 410.
      requireUsable(tokenHash);
      throw new StagedUploadLinkGoneException();
    }
    if (!tenantStatusChecker.isActive(link.tenantId())) {
      // 확인과 소비 사이에 테넌트가 정지됐다 — 링크 존재를 드러내지 않는다(이미 소비됐다).
      throw new StagedUploadLinkNotFoundException();
    }
    return link;
  }

  /**
   * 공개 업로드 3단계 — 소비된 링크의 발급자가 지금도 워크스페이스 ACTIVE 멤버인지 다시 확인한다(WP-417 멤버십 정지 반영). 본문을 받기 전에 부른다. 호출부가
   * TenantContext 를 링크의 테넌트로 설정한다.
   *
   * @throws StagedUploadLinkForbiddenException 발급자가 정지·탈퇴됨(403)
   */
  @Transactional(readOnly = true)
  public void requireIssuerActive(StagedLinkRow link) {
    if (membershipGuard.isForeignUser(link.userId())) {
      throw new StagedUploadLinkForbiddenException();
    }
  }

  /**
   * 공개 업로드 4단계 — 본문을 세는 스트림으로 임시 파일에 받는다. 트랜잭션·DB 연결 없이 돈다. 원시 PUT 본문에는 멀티파트 상한이 걸리지 않고
   * Content-Length 가 없을 수도 있어(chunked) 이 세기가 유일한 제한이다. 넘으면 그 자리에서 끊는다.
   *
   * @return 받은 본문(닫으면 임시 파일을 지운다)
   * @throws StagedUploadRejectedException 크기 초과·본문 중단(400), 임시 파일 생성·쓰기 실패(500). 링크는 이미 소비됐다
   */
  public BoundedBody.Received receiveBody(
      StagedLinkRow link, InputStream body, String contentType) {
    Path temp;
    try {
      temp = Files.createTempFile(tempDir, "staged-upload-", ".part");
    } catch (IOException e) {
      throw storageFailed(link.id(), e);
    }
    try {
      long size =
          BoundedBody.copyWithCap(body, temp, linkMaxBytes, StagedUploadRejectedException::new);
      return new BoundedBody.Received(temp, size, RawUploadContentTypes.bare(contentType));
    } catch (IOException e) {
      BoundedBody.deleteQuietly(temp);
      throw storageFailed(link.id(), e);
    } catch (RuntimeException e) {
      // 어떤 실패든(상한 초과·중단·예상 못 한 런타임 예외) 임시 파일을 남기지 않는다 — 드라이브 업로드 링크와 같은 규칙.
      BoundedBody.deleteQuietly(temp);
      throw e;
    }
  }

  /**
   * 공개 업로드 5단계 — 받아 둔 본문을 저장소({@code staged} 도메인)로 옮기고 발급자의 임시 ATTACHMENT FILE 행을 만든 뒤 사용 감사(actor
   * = 발급자, 요청 IP·User-Agent)를 같은 트랜잭션에 남긴다. 저장 MIME 은 {@link MimeNormalizer#normalize}(링크 이름, 매개변수를
   * 뗀 Content-Type).
   */
  @Transactional
  public StagedFileResponse completeUpload(
      StagedLinkRow link, BoundedBody.Received body, String clientIp, String userAgent) {
    String relativePath = pathBuilder.build(StorageDomain.STAGED, link.fileName());
    try {
      fileStore.storeFrom(relativePath, body.path());
    } catch (UncheckedIOException e) {
      throw storageFailed(link.id(), e);
    }
    fileStore.deleteOnRollback(relativePath);
    StagedFileResponse saved =
        insertStagedFile(
            link.userId(),
            link.fileName(),
            MimeNormalizer.normalize(link.fileName(), body.mimeType()),
            body.size(),
            relativePath);
    auditLogService.log(
        link.userId(),
        usernameOf(link.userId()),
        AUDIT_LINK_USE,
        "file",
        String.valueOf(saved.fileId()),
        "스테이징 업로드 링크 사용: " + saved.name(),
        ClientIpExtractor.forAudit(clientIp),
        userAgent,
        "SUCCESS",
        null,
        Map.of("stagedLinkId", link.id(), "sizeBytes", saved.sizeBytes()));
    return saved;
  }

  /** 임시 ATTACHMENT FILE 행을 만든다 — 클레임({@code StagedFileClaimer})이 요구하는 모양(업로더·category·만료)으로. */
  private StagedFileResponse insertStagedFile(
      long uploaderId, String name, String mimeType, long sizeBytes, String relativePath) {
    OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
    OffsetDateTime expiresAt = now.plusHours(tempExpiryHours);
    long fileId =
        dsl.insertInto(FILE)
            .set(FILE.ORIGINAL_NAME, name)
            // stored_name = 경로의 마지막 세그먼트(uuid.ext) — 코어 업로드와 같은 인바리언트
            .set(FILE.STORED_NAME, relativePath.substring(relativePath.lastIndexOf('/') + 1))
            .set(FILE.MIME_TYPE, mimeType)
            .set(FILE.SIZE_BYTES, sizeBytes)
            .set(FILE.CATEGORY, StagedFileClaimer.CATEGORY_ATTACHMENT)
            .set(FILE.STORAGE_PATH, relativePath)
            .set(FILE.UPLOADED_BY, uploaderId)
            .set(FILE.CREATED_AT, now)
            .set(FILE.EXPIRES_AT, expiresAt)
            .returning(FILE.ID)
            .fetchOne()
            .getId();
    return new StagedFileResponse(fileId, name, sizeBytes, mimeType, expiresAt);
  }

  /** 토큰 접두사가 {@code su_} 인지 보고 해시를 돌려준다. 아니면 404(DB 를 건드리지 않는다). */
  private static String tokenHashFor(String token) {
    if (token == null || !token.startsWith(TOKEN_PREFIX)) {
      throw new StagedUploadLinkNotFoundException();
    }
    return CapabilityTokens.sha256Hex(token);
  }

  /**
   * 소비 없이 링크 상태를 판정한다 — 본문 전 확인과 소비 실패 분류가 같이 써서 판정이 갈라지지 않게 한다: 없음·비활성 테넌트는 404(존재 은닉), 사용·만료는
   * 410, 쓸 수 있으면 그 행.
   */
  private StagedLinkRow requireUsable(String tokenHash) {
    StagedLinkRow link =
        links.resolve(tokenHash).orElseThrow(StagedUploadLinkNotFoundException::new);
    if (!tenantStatusChecker.isActive(link.tenantId())) {
      throw new StagedUploadLinkNotFoundException();
    }
    if (link.usedAt() != null || !link.expiresAt().isAfter(OffsetDateTime.now())) {
      throw new StagedUploadLinkGoneException();
    }
    return link;
  }

  /**
   * 소비 뒤 서버 쪽 입출력 실패(임시 파일 생성·쓰기, 저장소 복사) — 500 은 그대로 두되 새 링크 발급을 안내한다. 원인은 서버 로그에만 남기고, 어떤 링크인지
   * 추적할 수 있게 링크 행 id 를 남긴다(토큰은 남기지 않는다).
   */
  private static StagedUploadRejectedException storageFailed(long linkId, Exception cause) {
    log.error("스테이징 업로드 링크 본문 저장 실패 stagedLinkId={}", linkId, cause);
    return new StagedUploadRejectedException(
        HttpStatus.INTERNAL_SERVER_ERROR, "업로드한 파일을 저장하지 못했습니다. 새 링크를 발급받으세요");
  }

  private String usernameOf(long userId) {
    return userRepository
        .findById(userId)
        .map(UserResponse::username)
        .orElse(String.valueOf(userId));
  }
}
