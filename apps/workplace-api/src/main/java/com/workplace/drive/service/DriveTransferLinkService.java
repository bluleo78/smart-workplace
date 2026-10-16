package com.workplace.drive.service;

import com.workplace.audit.service.AuditLogService;
import com.workplace.drive.dto.CreateUploadLinkRequest;
import com.workplace.drive.dto.DriveDownloadLinkResponse;
import com.workplace.drive.dto.DriveFileResponse;
import com.workplace.drive.dto.DriveUploadLinkResponse;
import com.workplace.drive.exception.DriveFileNotFoundException;
import com.workplace.drive.exception.DriveFolderNotFoundException;
import com.workplace.drive.exception.DriveForbiddenException;
import com.workplace.drive.exception.DriveInvalidTargetException;
import com.workplace.drive.exception.DriveQuotaExceededException;
import com.workplace.drive.exception.DriveSpaceNotFoundException;
import com.workplace.drive.exception.DriveTransferLinkForbiddenException;
import com.workplace.drive.exception.DriveTransferLinkGoneException;
import com.workplace.drive.exception.DriveTransferLinkNotFoundException;
import com.workplace.drive.exception.DriveTransferUploadRejectedException;
import com.workplace.drive.repository.DriveFileRepository;
import com.workplace.drive.repository.DriveTransferLinkRepository;
import com.workplace.drive.repository.DriveTransferLinkRepository.TransferLinkRow;
import com.workplace.file.exception.FileBlobMissingException;
import com.workplace.file.exception.FileSizeLimitExceededException;
import com.workplace.file.service.FileUploadService;
import com.workplace.file.service.FileUploadService.FileContentResult;
import com.workplace.file.service.MimeNormalizer;
import com.workplace.file.service.UploadSource;
import com.workplace.global.tenant.MembershipGuard;
import com.workplace.global.tenant.TenantStatusChecker;
import com.workplace.global.util.BoundedBody;
import com.workplace.global.util.CapabilityTokens;
import com.workplace.global.util.ClientIpExtractor;
import com.workplace.global.util.RawUploadContentTypes;
import com.workplace.global.util.SafeFileNames;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.Map;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.unit.DataSize;

/**
 * 드라이브 전송 링크(WP-369) — 외부 MCP 클라이언트(curl·브라우저)가 로그인 없이 쓰는 10분짜리 일회용 서명 링크의 발급·소비.
 *
 * <p>공유 링크({@link DriveShareLinkService})와 같은 방식을 따른다: 토큰은 접두사 + base62(32 랜덤 바이트), DB 에는 SHA-256
 * hex 만, 공개 경로의 조회·소비는 SECURITY DEFINER 함수. 공유 링크와 다른 점은 발급자에게 묶이고(쓸 때 발급자 권한을 다시 확인), 한 번만 쓸 수 있다는
 * 것이다.
 *
 * <p>공개 다운로드 순서(컨트롤러가 조립): {@link #consume}(트랜잭션 밖, 원자적 소비 + 테넌트 활성 확인) → 컨트롤러가 TenantContext 설정 →
 * {@link #openDownloadAsIssuer}(발급자 권한 재확인 + 파일 읽기 + 사용 감사) → finally 에서 컨텍스트 정리. 소비 뒤 실패해도 링크는
 * 되살아나지 않는다.
 *
 * <p>공개 업로드 순서(R2 — 테넌트 advisory lock 을 네트워크 전송 동안 잡지 않는다): {@link #consumeUpload}(토큰·종류·만료 확인 → 본문
 * 형식·선언 크기 확인 → 원자적 소비, 트랜잭션 밖) → 컨트롤러가 TenantContext 설정 → {@link #requireIssuerCanUpload}(발급자
 * EDITOR 재확인, 짧은 읽기 트랜잭션) → {@link #receiveBody}(세는 상한으로 임시 파일에 받기, 트랜잭션·DB 연결 없음) → {@link
 * #completeUpload}(업로드 공통 핵심: lock → 할당량 → 새 버전 또는 새 파일 → 감사 → 추출 이벤트 → 알림, 그리고 사용 감사).
 *
 * <p>공개 경로에는 인증 주체(SecurityContext)가 없다. 업로드 핵심과 그 아래(감사·알림·file core·추출 이벤트)는 행위자를 인자로만 받으므로 발급자
 * id 를 명시적으로 넘긴다(R3) — 감사 actor 는 발급자다.
 */
@Slf4j
@Service
public class DriveTransferLinkService {
  /** 다운로드 링크 종류. 토큰 접두사는 {@code dl_}. */
  public static final String KIND_DOWNLOAD = "DOWNLOAD";

  /** 업로드 링크 종류(Task 1b). 토큰 접두사는 {@code ul_}. */
  public static final String KIND_UPLOAD = "UPLOAD";

  /** 공개 전송 경로 — SecurityConfig permitAll 과 공개 컨트롤러 매핑이 같은 값을 쓴다. */
  public static final String PUBLIC_PATH = "/api/v1/public/drive/transfer/";

  /** 링크 수명(사용자 결정: 10분). */
  public static final Duration TTL = Duration.ofMinutes(10);

  /** 감사 action — 링크 발급(R11). */
  public static final String AUDIT_LINK_CREATE = "TRANSFER_LINK_CREATE";

  /** 감사 action — 링크 사용 성공(R11). 무인증 접근이라 요청 IP·User-Agent 를 함께 남긴다. */
  public static final String AUDIT_LINK_USE = "TRANSFER_LINK_USE";

  private final DriveTransferLinkRepository links;
  private final DriveFileRepository files;
  private final DrivePermissions perms;
  private final FileUploadService fileUpload;
  private final MembershipGuard membershipGuard;
  private final TenantStatusChecker tenantStatusChecker;
  private final DriveFileService fileService;
  private final AuditLogService auditLogService;

  /**
   * PUT 본문 임시 파일 디렉터리(기본·공백이면 java.io.tmpdir). 생성자에서 한 번 만들어 두고 요청마다 만들지 않는다. 테스트는 Gradle 워커별로 나눠
   * 남은 임시 파일을 결정적으로 센다.
   */
  private final Path tempDir;

  /** 멀티파트 파일 상한(spring.servlet.multipart.max-file-size, 25MB) — 업로드 링크도 같은 상한을 넘지 않는다. */
  private final long multipartMaxBytes;

  /** 외부에서 닿는 웹 기준 주소(끝 슬래시 제거). 운영은 WEB_BASE_URL, 비면 기동 실패({@code PublicBaseUrlCheck}). */
  private final String publicBaseUrl;

  public DriveTransferLinkService(
      DriveTransferLinkRepository links,
      DriveFileRepository files,
      DrivePermissions perms,
      FileUploadService fileUpload,
      MembershipGuard membershipGuard,
      TenantStatusChecker tenantStatusChecker,
      DriveFileService fileService,
      AuditLogService auditLogService,
      @Value("${workplace.public-base-url}") String publicBaseUrl,
      @Value("${spring.servlet.multipart.max-file-size:25MB}") String multipartMaxFileSize,
      @Value("${workplace.drive.transfer-temp-dir:${java.io.tmpdir}}") String tempDir) {
    this.links = links;
    this.files = files;
    this.perms = perms;
    this.fileUpload = fileUpload;
    this.membershipGuard = membershipGuard;
    this.tenantStatusChecker = tenantStatusChecker;
    this.fileService = fileService;
    this.auditLogService = auditLogService;
    this.tempDir = BoundedBody.prepareTempDir(tempDir, "workplace.drive.transfer-temp-dir");
    this.publicBaseUrl = CapabilityTokens.normalizeBaseUrl(publicBaseUrl);
    this.multipartMaxBytes = DataSize.parse(multipartMaxFileSize).toBytes();
  }

  /**
   * 다운로드 링크 발급. 휴지통·없는 파일은 404, 공간 비멤버는 404(존재 은닉), VIEWER 이상이면 발급한다. 발급자의 만료 행을 함께 정리한다.
   *
   * <p>원본 blob 이 유실된 파일은 발급 단계에서 404(FileBlobMissing)로 거른다 — 받을 수 없는 링크를 만들지 않는다.
   */
  @Transactional
  public DriveDownloadLinkResponse issueDownloadLink(long callerId, long driveFileId)
      throws IOException {
    DriveFileRepository.DriveFileRow row =
        files.findRow(driveFileId).orElseThrow(() -> new DriveFileNotFoundException(driveFileId));
    perms.requireRole(row.spaceId(), callerId, "VIEWER");
    FileContentResult meta = fileUpload.getFileContentTrusted(row.fileId()).withName(row.name());

    links.deleteExpiredByUser(callerId);
    String token = CapabilityTokens.generate("dl_");
    OffsetDateTime expiresAt = OffsetDateTime.now(ZoneOffset.UTC).plus(TTL);
    long linkId =
        links.insert(
            KIND_DOWNLOAD,
            CapabilityTokens.sha256Hex(token),
            callerId,
            row.spaceId(),
            null,
            driveFileId,
            null,
            expiresAt);
    // 발급 감사(R11) — 토큰·해시는 남기지 않는다.
    auditLogService.log(
        callerId,
        fileService.usernameOf(callerId),
        AUDIT_LINK_CREATE,
        "drive",
        String.valueOf(driveFileId),
        "드라이브 다운로드 링크 발급: " + row.name(),
        null,
        null,
        "SUCCESS",
        null,
        Map.of(
            "kind",
            KIND_DOWNLOAD,
            "transferLinkId",
            linkId,
            "spaceId",
            row.spaceId(),
            "expiresAt",
            expiresAt.toString()));
    return new DriveDownloadLinkResponse(
        publicUrl(token), expiresAt, meta.originalName(), meta.size(), meta.mimeType(), true);
  }

  /**
   * 업로드 링크 발급 — EDITOR 이상, 폴더(있으면)가 그 공간의 활성 폴더여야 한다(공간 비멤버 404 은닉·역할 미달 403·없는 폴더 404·다른 공간 폴더
   * 400). 이름은 {@link SafeFileNames#sanitize} 로 정리해 링크에 묶는다. 발급자의 만료 행을 함께 정리한다.
   *
   * <p>{@code maxBytes} 는 이름의 확장자로 정한 범주 상한과 멀티파트 상한 중 작은 값이다 — PUT 에 Content-Type 을 주면 그 MIME 의
   * 범주로 다시 정한다.
   */
  @Transactional
  public DriveUploadLinkResponse issueUploadLink(
      long callerId, long spaceId, CreateUploadLinkRequest req) {
    fileService.validateUploadTarget(callerId, spaceId, req.folderId());
    String name = SafeFileNames.sanitize(req.name(), "file");

    links.deleteExpiredByUser(callerId);
    String token = CapabilityTokens.generate("ul_");
    OffsetDateTime expiresAt = OffsetDateTime.now(ZoneOffset.UTC).plus(TTL);
    long linkId =
        links.insert(
            KIND_UPLOAD,
            CapabilityTokens.sha256Hex(token),
            callerId,
            spaceId,
            req.folderId(),
            null,
            name,
            expiresAt);
    // 발급 감사(R11) — 아직 파일이 없어 resource_id 는 비운다. 토큰·해시는 남기지 않는다.
    Map<String, Object> meta = new HashMap<>();
    meta.put("kind", KIND_UPLOAD);
    meta.put("transferLinkId", linkId);
    meta.put("spaceId", spaceId);
    meta.put("fileName", name);
    meta.put("expiresAt", expiresAt.toString());
    if (req.folderId() != null) {
      meta.put("folderId", req.folderId());
    }
    auditLogService.log(
        callerId,
        fileService.usernameOf(callerId),
        AUDIT_LINK_CREATE,
        "drive",
        null,
        "드라이브 업로드 링크 발급: " + name,
        null,
        null,
        "SUCCESS",
        null,
        meta);
    return new DriveUploadLinkResponse(
        publicUrl(token), "PUT", expiresAt, uploadCapFor(name, null), name, true);
  }

  /**
   * 기존 파일 지정 업로드 링크 발급(WP-369) — 그 파일 공간의 EDITOR 이상. 링크 행에 {@code drive_file_id} 를 묶어 PUT 이 이름으로 찾지
   * 않고 그 파일에 새 버전을 더하게 한다(발급 뒤 이름이 바뀌어도 같은 파일). 없는·휴지통 파일 404, 공간 비멤버 404(은닉), 역할 미달 403.
   *
   * <p>행의 {@code file_name} 에는 발급 시점 이름을 넣는다(종류 CHECK 가 업로드 행에 이름을 요구하고, PUT 본문 전 상한 계산에 쓴다).
   * {@code folder_id} 는 비운다 — 파일이 다른 폴더로 옮겨져도 링크가 살아 있게.
   */
  @Transactional
  public DriveUploadLinkResponse issueFileUploadLink(long callerId, long driveFileId) {
    DriveFileRepository.DriveFileRow row = fileService.validateVersionTarget(callerId, driveFileId);

    links.deleteExpiredByUser(callerId);
    String token = CapabilityTokens.generate("ul_");
    OffsetDateTime expiresAt = OffsetDateTime.now(ZoneOffset.UTC).plus(TTL);
    long linkId =
        links.insert(
            KIND_UPLOAD,
            CapabilityTokens.sha256Hex(token),
            callerId,
            row.spaceId(),
            null,
            driveFileId,
            row.name(),
            expiresAt);
    // 발급 감사(R11) — 대상 파일이 있어 resource_id 에 넣는다. 토큰·해시는 남기지 않는다.
    auditLogService.log(
        callerId,
        fileService.usernameOf(callerId),
        AUDIT_LINK_CREATE,
        "drive",
        String.valueOf(driveFileId),
        "드라이브 업로드 링크 발급(새 버전): " + row.name(),
        null,
        null,
        "SUCCESS",
        null,
        Map.of(
            "kind",
            KIND_UPLOAD,
            "transferLinkId",
            linkId,
            "spaceId",
            row.spaceId(),
            "fileName",
            row.name(),
            "driveFileId",
            driveFileId,
            "expiresAt",
            expiresAt.toString()));
    return new DriveUploadLinkResponse(
        publicUrl(token), "PUT", expiresAt, uploadCapFor(row.name(), null), row.name(), true);
  }

  /**
   * 공개 경로의 원자적 소비. 트랜잭션 밖에서 불러야 한다(소비가 뒤이은 실패와 함께 롤백되지 않게). 테넌트 컨텍스트가 필요 없다.
   *
   * <ul>
   *   <li>접두사가 종류와 다르거나 없는 토큰 → 404
   *   <li>있지만 이미 사용·만료(동시 요청에서 진 쪽 포함) → 410
   *   <li>테넌트가 비활성(정지·삭제) → 404(링크 존재를 드러내지 않음). 이 경우에도 링크는 이미 소비됐다
   * </ul>
   *
   * @param kind {@link #KIND_DOWNLOAD} | {@link #KIND_UPLOAD}
   * @return 소비된 행(발급자·테넌트·대상)
   */
  public TransferLinkRow consume(String token, String kind) {
    String tokenHash = tokenHashFor(token, kind);
    TransferLinkRow link = links.consume(tokenHash, kind).orElse(null);
    if (link == null) {
      // 0행 — 없는 토큰(404)인지 사용·만료(410)인지 본문 전 확인과 같은 판정으로 가른다. 판정이 "쓸 수 있음"이면 그 사이 다른 요청이 소비한
      // 것이므로 410.
      requireUsable(tokenHash, kind);
      throw new DriveTransferLinkGoneException();
    }
    if (!tenantStatusChecker.isActive(link.tenantId())) {
      throw new DriveTransferLinkNotFoundException();
    }
    return link;
  }

  /**
   * 소비된 다운로드 링크로 파일 열기. 호출부가 {@code TenantContext} 를 링크의 테넌트로 설정한 뒤 부른다.
   *
   * <p>발급자가 지금도 워크스페이스 ACTIVE 멤버이고 공간 VIEWER 이상인지 다시 확인한다(빠졌으면 403). 파일이 휴지통·삭제됐으면 404. 오류 문구는 모두
   * "새 링크를 발급받으세요"로 끝난다 — 링크는 이미 소비됐다. 원본 blob 유실도 전송 링크 예외(404)로 바꿔 내부 id 가 새지 않게 한다.
   *
   * <p>성공하면 사용 감사(R11, actor = 발급자, 요청 IP·User-Agent)를 남긴다 — 그래서 쓰기 트랜잭션이다.
   */
  @Transactional
  public FileContentResult openDownloadAsIssuer(
      TransferLinkRow link, String clientIp, String userAgent) throws IOException {
    long issuerId = link.userId();
    if (membershipGuard.isForeignUser(issuerId)) {
      throw lostPermission();
    }
    DriveFileRepository.DriveFileRow row =
        files
            .findRow(link.driveFileId())
            .orElseThrow(
                () -> new DriveTransferLinkNotFoundException("파일을 찾을 수 없습니다. 새 링크를 발급받으세요"));
    try {
      perms.requireRole(row.spaceId(), issuerId, "VIEWER");
    } catch (DriveSpaceNotFoundException | DriveForbiddenException e) {
      // 공간 비멤버(404 은닉)·역할 미달 모두 "권한 상실" 403 으로 — 링크 소지자에게는 링크가 권한을 잃은 것이다.
      throw lostPermission();
    }
    FileContentResult content;
    try {
      content = fileUpload.getFileContentTrusted(row.fileId()).withName(row.name());
    } catch (FileBlobMissingException e) {
      // 발급 때는 있던 원본이 사라졌다 — 새 링크로도 받을 수 없으므로 "새 링크" 안내 없이 알린다.
      throw new DriveTransferLinkNotFoundException("파일 원본이 유실되어 내려받을 수 없습니다");
    }
    auditUse(link, row.id(), row.name(), content.size(), clientIp, userAgent);
    return content;
  }

  private static DriveTransferLinkForbiddenException lostPermission() {
    return new DriveTransferLinkForbiddenException(
        "링크를 발급한 사용자에게 더 이상 이 파일에 접근할 권한이 없습니다. 새 링크를 발급받으세요");
  }

  /**
   * 공개 업로드 1·2단계(R2) — 본문을 읽기 전에 토큰·종류·만료를 확인하고, 본문 형식(폼·멀티파트 거부)과 선언된 크기(Content-Length)를 본 뒤
   * 원자적으로 소비한다. 트랜잭션 밖에서 부른다. 1단계의 거부(404·410·415·400)는 링크를 소비하지 않는다.
   *
   * <p>폼(application/x-www-form-urlencoded)은 Spring 의 FormContentFilter 가 PUT 본문을 미리 읽어 버려 빈 파일이
   * 저장되므로 받지 않는다 — curl 의 {@code --data-binary} 기본값이다. 원시 바이트({@code curl -T})로 보내야 한다.
   *
   * @param contentLength 요청 Content-Length(없으면 -1 — chunked). 넘치면 본문을 받기 전에 거부한다
   * @return 소비된 행
   */
  public TransferLinkRow consumeUpload(String token, String contentType, long contentLength) {
    TransferLinkRow pending = requireUsable(tokenHashFor(token, KIND_UPLOAD), KIND_UPLOAD);
    // 폼·멀티파트·깨진·와일드카드 Content-Type 거부 — 스테이징 업로드 링크와 같은 규칙(RawUploadContentTypes)
    RawUploadContentTypes.rejectReason(contentType)
        .ifPresent(
            r -> {
              throw new DriveTransferUploadRejectedException(
                  HttpStatus.UNSUPPORTED_MEDIA_TYPE, r.message());
            });
    String mime = RawUploadContentTypes.bare(contentType);
    long cap = uploadCapFor(pending.fileName(), mime);
    if (contentLength > cap) {
      throw new DriveTransferUploadRejectedException(
          HttpStatus.BAD_REQUEST, "파일이 너무 큽니다 (최대 " + BoundedBody.toMb(cap) + "MB)");
    }
    return consume(token, KIND_UPLOAD);
  }

  /** 토큰 접두사가 종류와 맞는지 보고 해시를 돌려준다. 다르거나 없으면 404(DB 를 건드리지 않는다). */
  private static String tokenHashFor(String token, String kind) {
    String prefix = KIND_UPLOAD.equals(kind) ? "ul_" : "dl_";
    if (token == null || !token.startsWith(prefix)) {
      throw new DriveTransferLinkNotFoundException();
    }
    return CapabilityTokens.sha256Hex(token);
  }

  /**
   * 소비 없이 링크 상태를 판정한다 — {@link #consume}(소비 실패 분류)와 {@link #consumeUpload}(본문 전 확인)가 같이 써서 판정이 갈라지지
   * 않게 한다: 없음·종류 다름·비활성 테넌트는 404(존재 은닉), 사용·만료는 410, 쓸 수 있으면 그 행.
   */
  private TransferLinkRow requireUsable(String tokenHash, String kind) {
    TransferLinkRow link =
        links
            .resolve(tokenHash)
            .filter(r -> kind.equals(r.kind()))
            .orElseThrow(DriveTransferLinkNotFoundException::new);
    if (!tenantStatusChecker.isActive(link.tenantId())) {
      throw new DriveTransferLinkNotFoundException();
    }
    if (link.usedAt() != null || !link.expiresAt().isAfter(OffsetDateTime.now())) {
      throw new DriveTransferLinkGoneException();
    }
    return link;
  }

  /**
   * 공개 업로드 3단계(R2) — 소비된 업로드 링크의 발급자가 지금도 워크스페이스 ACTIVE 멤버이고 공간 EDITOR 이상이며, 대상 폴더가 그대로인지 다시 확인한다.
   * 본문을 받기 전에 부른다. 호출부가 TenantContext 를 링크의 테넌트로 설정한다.
   *
   * <p>파일 지정 링크({@code drive_file_id} 있음)는 폴더 대신 그 파일이 살아 있는지, 발급자가 <b>그 파일 공간</b>의 EDITOR 인지 본다.
   *
   * @throws DriveTransferLinkForbiddenException 권한 상실(403)
   * @throws DriveTransferLinkNotFoundException 폴더 또는 대상 파일이 휴지통·삭제됨(404)
   */
  @Transactional(readOnly = true)
  public void requireIssuerCanUpload(TransferLinkRow link) {
    if (membershipGuard.isForeignUser(link.userId())) {
      throw lostUploadPermission();
    }
    try {
      if (link.driveFileId() != null) {
        // 파일 지정 링크 — 그 파일이 살아 있고 발급자가 파일 공간의 EDITOR 인지(이름·폴더는 보지 않는다).
        fileService.validateVersionTarget(link.userId(), link.driveFileId());
      } else {
        fileService.validateUploadTarget(link.userId(), link.spaceId(), link.folderId());
      }
    } catch (DriveFileNotFoundException e) {
      throw uploadFileGone();
    } catch (DriveSpaceNotFoundException | DriveForbiddenException e) {
      throw lostUploadPermission();
    } catch (DriveFolderNotFoundException | DriveInvalidTargetException e) {
      throw uploadFolderGone();
    }
  }

  /**
   * 공개 업로드 4단계(R2) — 본문을 세는 스트림으로 임시 파일에 받는다. 트랜잭션·DB 연결·테넌트 lock 없이 돈다. 상한은 이름·Content-Type 으로 정한
   * 범주 상한(멀티파트 25MB 이하)이며, 원시 PUT 본문에는 멀티파트 상한이 걸리지 않고 Content-Length 가 없을 수도 있어(chunked) 이 세기가 유일한
   * 제한이다. 넘으면 그 자리에서 끊는다.
   *
   * @return 받은 본문(닫으면 임시 파일을 지운다)
   * @throws DriveTransferUploadRejectedException 크기 초과·본문 중단(400), 임시 파일 생성·쓰기 실패(500). 링크는 이미 소비됐다
   */
  public BoundedBody.Received receiveBody(
      TransferLinkRow link, InputStream body, String contentType) {
    String mime = RawUploadContentTypes.bare(contentType);
    long cap = uploadCapFor(link.fileName(), mime);
    Path temp;
    try {
      temp = Files.createTempFile(tempDir, "drive-transfer-", ".part");
    } catch (IOException e) {
      throw storageFailed(link.id(), e);
    }
    try {
      long size =
          BoundedBody.copyWithCap(body, temp, cap, DriveTransferUploadRejectedException::new);
      return new BoundedBody.Received(temp, size, mime);
    } catch (IOException e) {
      BoundedBody.deleteQuietly(temp);
      throw storageFailed(link.id(), e);
    } catch (RuntimeException e) {
      BoundedBody.deleteQuietly(temp);
      throw e;
    }
  }

  /**
   * 소비 뒤 서버 쪽 입출력 실패(임시 파일 생성·쓰기, 저장소 복사) — 500 은 그대로 두되 일반 500 문구 대신 새 링크 발급을 안내한다. 원인은 서버 로그에만
   * 남긴다. 어떤 링크인지 추적할 수 있게 링크 행 id 를 남긴다(토큰은 남기지 않는다 — 예외 문구의 경로에도 토큰이 없다).
   */
  private static DriveTransferUploadRejectedException storageFailed(long linkId, Exception cause) {
    log.error("업로드 링크 본문 저장 실패 transferLinkId={}", linkId, cause);
    return new DriveTransferUploadRejectedException(
        HttpStatus.INTERNAL_SERVER_ERROR, "업로드한 파일을 저장하지 못했습니다. 새 링크를 발급받으세요");
  }

  /**
   * 공개 업로드 5단계(R2) — 받아 둔 본문을 업로드 공통 핵심({@link DriveFileService#upload(long, long, Long,
   * UploadSource)})에 발급자 이름으로 넘긴다: lock → 할당량 → 같은 이름이면 새 버전·아니면 새 파일 → 감사(actor = 발급자) → 추출 이벤트 →
   * 알림. 이어 사용 감사(R11)를 같은 트랜잭션에 남긴다. 파일 지정 링크는 {@link DriveFileService#addVersion} 으로 그 파일 ID 에 새
   * 버전을 더한다(감사 FILE_VERSION_CREATED).
   *
   * <p>핵심의 예외는 내부 id 가 없는 전송 링크 예외로 바꾼다(문구는 "새 링크를 발급받으세요" — 링크는 이미 소비됐다).
   */
  @Transactional
  public DriveFileResponse completeUpload(
      TransferLinkRow link, BoundedBody.Received body, String clientIp, String userAgent) {
    DriveFileResponse saved;
    try {
      UploadSource source =
          UploadSource.ofFile(link.fileName(), body.mimeType(), body.path(), body.size());
      saved =
          link.driveFileId() != null
              // 파일 지정 링크 — 이름으로 찾지 않고 그 파일에 새 버전(저장 이름은 파일의 지금 이름)
              ? fileService.addVersion(link.userId(), link.driveFileId(), source)
              : fileService.upload(link.userId(), link.spaceId(), link.folderId(), source);
    } catch (DriveFileNotFoundException e) {
      // 재확인과 이 트랜잭션 사이에 대상 파일이 휴지통으로 갔다(예외 문구의 내부 id 를 드러내지 않는다).
      throw uploadFileGone();
    } catch (DriveSpaceNotFoundException | DriveForbiddenException e) {
      throw lostUploadPermission();
    } catch (DriveFolderNotFoundException | DriveInvalidTargetException e) {
      throw uploadFolderGone();
    } catch (DuplicateKeyException e) {
      // 이름 경로에서 동명 행을 못 찾은 직후 다른 요청이 같은 이름을 만들었다(유일 인덱스 uq_drive_file_active_name, 최종 리뷰 m1).
      // 다른 무결성 위반까지 이 문구로 감추지 않게 유일 위반(DuplicateKeyException)만 받는다.
      throw new DriveTransferUploadRejectedException(
          HttpStatus.CONFLICT, "같은 이름의 파일이 방금 생겼습니다. 새 링크를 발급받으세요");
    } catch (DriveQuotaExceededException e) {
      // 익명 링크 소지자에게 테넌트 사용량·한도를 드러내지 않는다.
      throw new DriveTransferUploadRejectedException(
          HttpStatus.CONFLICT, "저장 용량이 부족합니다. 공간을 비운 뒤 새 링크를 발급받으세요");
    } catch (FileSizeLimitExceededException e) {
      throw new DriveTransferUploadRejectedException(
          HttpStatus.BAD_REQUEST, e.getMessage() + ". 새 링크를 발급받으세요");
    } catch (IOException | UncheckedIOException e) {
      // 저장소 복사(FileStore.storeFrom) 등 서버 쪽 입출력 실패
      throw storageFailed(link.id(), e);
    }
    auditUse(link, saved.id(), saved.name(), saved.sizeBytes(), clientIp, userAgent);
    return saved;
  }

  /**
   * 업로드 링크로 받을 최대 바이트 — 이름·MIME 으로 정한 범주 상한(file core 와 같은 규칙)과 멀티파트 상한 중 작은 값.
   *
   * @param bareMime 매개변수를 뗀 Content-Type(없으면 null — 확장자로 정한다)
   */
  long uploadCapFor(String fileName, String bareMime) {
    String mime = MimeNormalizer.normalize(fileName, bareMime);
    return Math.min(
        FileUploadService.sizeLimitOf(FileUploadService.categoryOf(mime)), multipartMaxBytes);
  }

  /** 링크 사용 성공 감사(R11) — actor 는 발급자, 실제 요청자는 익명이라 IP·User-Agent 를 남긴다. 토큰·해시는 남기지 않는다. */
  private void auditUse(
      TransferLinkRow link,
      long driveFileId,
      String name,
      long sizeBytes,
      String clientIp,
      String userAgent) {
    boolean upload = KIND_UPLOAD.equals(link.kind());
    auditLogService.log(
        link.userId(),
        fileService.usernameOf(link.userId()),
        AUDIT_LINK_USE,
        "drive",
        String.valueOf(driveFileId),
        (upload ? "드라이브 업로드 링크 사용: " : "드라이브 다운로드 링크 사용: ") + name,
        ClientIpExtractor.forAudit(clientIp),
        userAgent,
        "SUCCESS",
        null,
        Map.of(
            "kind", link.kind(),
            "transferLinkId", link.id(),
            "spaceId", link.spaceId(),
            "sizeBytes", sizeBytes));
  }

  private static DriveTransferLinkForbiddenException lostUploadPermission() {
    return new DriveTransferLinkForbiddenException(
        "링크를 발급한 사용자에게 더 이상 이 공간에 파일을 올릴 권한이 없습니다. 새 링크를 발급받으세요");
  }

  /** 파일 지정 업로드 링크의 대상 파일이 휴지통·삭제됨 — 그 파일에는 더 올릴 수 없다. */
  private static DriveTransferLinkNotFoundException uploadFileGone() {
    return new DriveTransferLinkNotFoundException("올릴 파일을 찾을 수 없습니다. 새 링크를 발급받으세요");
  }

  private static DriveTransferLinkNotFoundException uploadFolderGone() {
    return new DriveTransferLinkNotFoundException("올릴 폴더를 찾을 수 없습니다. 새 링크를 발급받으세요");
  }

  /** 공개 링크 URL — {publicBaseUrl}/api/v1/public/drive/transfer/{token}. */
  public String publicUrl(String token) {
    return publicBaseUrl + PUBLIC_PATH + token;
  }
}
