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
import com.workplace.global.util.SafeFileNames;
import com.workplace.user.repository.UserRepository;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.UncheckedIOException;
import java.math.BigInteger;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Locale;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
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

  /** audit_log.ip_address 열 길이 — 익명 요청의 X-Forwarded-For 는 임의 길이라 잘라 넣는다. */
  private static final int AUDIT_IP_MAX = 45;

  private static final String BASE62 =
      "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

  private final DriveTransferLinkRepository links;
  private final DriveFileRepository files;
  private final DrivePermissions perms;
  private final FileUploadService fileUpload;
  private final MembershipGuard membershipGuard;
  private final TenantStatusChecker tenantStatusChecker;
  private final DriveFileService fileService;
  private final AuditLogService auditLogService;
  private final UserRepository userRepository;
  private final SecureRandom secureRandom = new SecureRandom();

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
      UserRepository userRepository,
      @Value("${workplace.public-base-url}") String publicBaseUrl,
      @Value("${spring.servlet.multipart.max-file-size:25MB}") String multipartMaxFileSize) {
    this.links = links;
    this.files = files;
    this.perms = perms;
    this.fileUpload = fileUpload;
    this.membershipGuard = membershipGuard;
    this.tenantStatusChecker = tenantStatusChecker;
    this.fileService = fileService;
    this.auditLogService = auditLogService;
    this.userRepository = userRepository;
    this.publicBaseUrl = stripTrailingSlash(publicBaseUrl);
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
    String token = generateToken("dl_");
    OffsetDateTime expiresAt = OffsetDateTime.now(ZoneOffset.UTC).plus(TTL);
    long linkId =
        links.insert(
            KIND_DOWNLOAD,
            DriveShareLinkService.sha256Hex(token),
            callerId,
            row.spaceId(),
            null,
            driveFileId,
            null,
            expiresAt);
    // 발급 감사(R11) — 토큰·해시는 남기지 않는다.
    auditLogService.log(
        callerId,
        usernameOf(callerId),
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
    String token = generateToken("ul_");
    OffsetDateTime expiresAt = OffsetDateTime.now(ZoneOffset.UTC).plus(TTL);
    long linkId =
        links.insert(
            KIND_UPLOAD,
            DriveShareLinkService.sha256Hex(token),
            callerId,
            spaceId,
            req.folderId(),
            null,
            name,
            expiresAt);
    // 발급 감사(R11) — 아직 파일이 없어 resource_id 는 비운다. 토큰·해시는 남기지 않는다.
    Map<String, Object> meta = new java.util.HashMap<>();
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
        usernameOf(callerId),
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
    String prefix = KIND_UPLOAD.equals(kind) ? "ul_" : "dl_";
    if (token == null || !token.startsWith(prefix)) {
      throw new DriveTransferLinkNotFoundException();
    }
    String tokenHash = DriveShareLinkService.sha256Hex(token);
    TransferLinkRow link = links.consume(tokenHash, kind).orElse(null);
    if (link == null) {
      // 0행 — 없는 토큰(404)인지 사용·만료(410)인지 가른다. 비활성 테넌트는 존재를 숨겨 404.
      TransferLinkRow existing =
          links
              .resolve(tokenHash)
              .filter(r -> kind.equals(r.kind()))
              .orElseThrow(DriveTransferLinkNotFoundException::new);
      if (!tenantStatusChecker.isActive(existing.tenantId())) {
        throw new DriveTransferLinkNotFoundException();
      }
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
    TransferLinkRow pending = resolveUsable(token, KIND_UPLOAD);
    String mime = bareMime(contentType);
    if (mime != null
        && (mime.equals("application/x-www-form-urlencoded") || mime.startsWith("multipart/"))) {
      throw new DriveTransferUploadRejectedException(
          HttpStatus.UNSUPPORTED_MEDIA_TYPE,
          "파일을 원시 바이트로 보내세요(curl -T 파일 URL). 폼·멀티파트 본문은 받지 않습니다");
    }
    long cap = uploadCapFor(pending.fileName(), mime);
    if (contentLength > cap) {
      throw new DriveTransferUploadRejectedException(
          HttpStatus.BAD_REQUEST, "파일이 너무 큽니다 (최대 " + toMb(cap) + "MB)");
    }
    return consume(token, KIND_UPLOAD);
  }

  /** 소비 없이 링크 상태 확인 — {@link #consume} 와 같은 판정(없음·종류 다름·비활성 테넌트 404, 사용·만료 410). */
  private TransferLinkRow resolveUsable(String token, String kind) {
    String prefix = KIND_UPLOAD.equals(kind) ? "ul_" : "dl_";
    if (token == null || !token.startsWith(prefix)) {
      throw new DriveTransferLinkNotFoundException();
    }
    TransferLinkRow link =
        links
            .resolve(DriveShareLinkService.sha256Hex(token))
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
   * @throws DriveTransferLinkForbiddenException 권한 상실(403)
   * @throws DriveTransferLinkNotFoundException 폴더가 휴지통·삭제됨(404)
   */
  @Transactional(readOnly = true)
  public void requireIssuerCanUpload(TransferLinkRow link) {
    if (membershipGuard.isForeignUser(link.userId())) {
      throw lostUploadPermission();
    }
    try {
      fileService.validateUploadTarget(link.userId(), link.spaceId(), link.folderId());
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
   * @throws DriveTransferUploadRejectedException 크기 초과·본문 중단(400). 링크는 이미 소비됐다
   */
  public ReceivedBody receiveBody(TransferLinkRow link, InputStream body, String contentType) {
    String mime = bareMime(contentType);
    long cap = uploadCapFor(link.fileName(), mime);
    Path temp;
    try {
      temp = Files.createTempFile("drive-transfer-", ".part");
    } catch (IOException e) {
      throw new UncheckedIOException("업로드 임시 파일 생성 실패", e);
    }
    try {
      long size = copyWithCap(body, temp, cap);
      return new ReceivedBody(temp, size, mime);
    } catch (RuntimeException e) {
      deleteQuietly(temp);
      throw e;
    }
  }

  /** 본문을 상한까지 복사한다. 읽기 실패(클라이언트 중단)는 400, 쓰기 실패(서버 디스크)는 500. */
  private static long copyWithCap(InputStream in, Path target, long cap) {
    byte[] buf = new byte[64 * 1024];
    long total = 0;
    try (OutputStream out = Files.newOutputStream(target)) {
      while (true) {
        int n;
        try {
          n = in.read(buf);
        } catch (IOException e) {
          throw new DriveTransferUploadRejectedException(
              HttpStatus.BAD_REQUEST, "업로드 본문을 끝까지 받지 못했습니다. 새 링크를 발급받으세요");
        }
        if (n < 0) {
          return total;
        }
        total += n;
        if (total > cap) {
          throw new DriveTransferUploadRejectedException(
              HttpStatus.BAD_REQUEST, "파일이 너무 큽니다 (최대 " + toMb(cap) + "MB). 새 링크를 발급받으세요");
        }
        out.write(buf, 0, n);
      }
    } catch (IOException e) {
      throw new UncheckedIOException("업로드 임시 파일 쓰기 실패", e);
    }
  }

  /**
   * 공개 업로드 5단계(R2) — 받아 둔 본문을 업로드 공통 핵심({@link DriveFileService#upload(long, long, Long,
   * UploadSource)})에 발급자 이름으로 넘긴다: lock → 할당량 → 같은 이름이면 새 버전·아니면 새 파일 → 감사(actor = 발급자) → 추출 이벤트 →
   * 알림. 이어 사용 감사(R11)를 같은 트랜잭션에 남긴다.
   *
   * <p>핵심의 예외는 내부 id 가 없는 전송 링크 예외로 바꾼다(문구는 "새 링크를 발급받으세요" — 링크는 이미 소비됐다).
   */
  @Transactional
  public DriveFileResponse completeUpload(
      TransferLinkRow link, ReceivedBody body, String clientIp, String userAgent)
      throws IOException {
    DriveFileResponse saved;
    try {
      saved =
          fileService.upload(
              link.userId(),
              link.spaceId(),
              link.folderId(),
              UploadSource.ofFile(link.fileName(), body.mimeType(), body.path(), body.size()));
    } catch (DriveSpaceNotFoundException | DriveForbiddenException e) {
      throw lostUploadPermission();
    } catch (DriveFolderNotFoundException | DriveInvalidTargetException e) {
      throw uploadFolderGone();
    } catch (DriveQuotaExceededException e) {
      throw new DriveTransferUploadRejectedException(
          HttpStatus.CONFLICT, e.getMessage() + " 공간을 비운 뒤 새 링크를 발급받으세요");
    } catch (FileSizeLimitExceededException e) {
      throw new DriveTransferUploadRejectedException(
          HttpStatus.BAD_REQUEST, e.getMessage() + ". 새 링크를 발급받으세요");
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

  /**
   * Content-Type 에서 매개변수(charset 등)를 떼고 소문자로 — "text/plain; charset=utf-8" 이 범주표에서 빠지지 않게. 없으면
   * null.
   */
  static String bareMime(String contentType) {
    if (contentType == null || contentType.isBlank()) {
      return null;
    }
    String mime = contentType.split(";", 2)[0].strip().toLowerCase(Locale.ROOT);
    return mime.isEmpty() ? null : mime;
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
        usernameOf(link.userId()),
        AUDIT_LINK_USE,
        "drive",
        String.valueOf(driveFileId),
        (upload ? "드라이브 업로드 링크 사용: " : "드라이브 다운로드 링크 사용: ") + name,
        clientIp == null || clientIp.length() <= AUDIT_IP_MAX
            ? clientIp
            : clientIp.substring(0, AUDIT_IP_MAX),
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

  private static DriveTransferLinkNotFoundException uploadFolderGone() {
    return new DriveTransferLinkNotFoundException("올릴 폴더를 찾을 수 없습니다. 새 링크를 발급받으세요");
  }

  private static long toMb(long bytes) {
    return bytes / (1024 * 1024);
  }

  private static void deleteQuietly(Path p) {
    try {
      Files.deleteIfExists(p);
    } catch (IOException ignored) {
      // 임시 파일 정리 실패는 응답을 바꾸지 않는다(OS 임시 디렉터리 정리에 맡긴다).
    }
  }

  /** 감사 로그용 사용자명. 없으면 userId 문자열(DriveFileService 와 같은 규칙). */
  private String usernameOf(long userId) {
    return userRepository
        .findById(userId)
        .map(com.workplace.user.dto.UserResponse::username)
        .orElse(String.valueOf(userId));
  }

  /**
   * 업로드 링크 PUT 본문을 받아 둔 임시 파일. 닫으면(try-with-resources) 지운다 — 저장소에는 복사본이 들어간다.
   *
   * @param mimeType 매개변수를 뗀 Content-Type(없으면 null — 확장자로 정한다)
   */
  public record ReceivedBody(Path path, long size, String mimeType) implements AutoCloseable {
    @Override
    public void close() {
      deleteQuietly(path);
    }
  }

  /** 공개 링크 URL — {publicBaseUrl}/api/v1/public/drive/transfer/{token}. */
  public String publicUrl(String token) {
    return publicBaseUrl + PUBLIC_PATH + token;
  }

  /** 접두사({@code dl_}·{@code ul_}) + base62(32 랜덤 바이트). 공유 링크·PAT 생성기와 같은 방식. */
  public String generateToken(String prefix) {
    byte[] bytes = new byte[32];
    secureRandom.nextBytes(bytes);
    BigInteger n = new BigInteger(1, bytes);
    BigInteger base = BigInteger.valueOf(62);
    StringBuilder sb = new StringBuilder();
    while (n.signum() > 0) {
      BigInteger[] qr = n.divideAndRemainder(base);
      sb.insert(0, BASE62.charAt(qr[1].intValue()));
      n = qr[0];
    }
    return prefix + (sb.length() > 0 ? sb.toString() : "0");
  }

  private static String stripTrailingSlash(String url) {
    String s = url == null ? "" : url.trim();
    while (s.endsWith("/")) {
      s = s.substring(0, s.length() - 1);
    }
    return s;
  }
}
