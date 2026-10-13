package com.workplace.drive.service;

import com.workplace.drive.dto.DriveDownloadLinkResponse;
import com.workplace.drive.exception.DriveFileNotFoundException;
import com.workplace.drive.exception.DriveForbiddenException;
import com.workplace.drive.exception.DriveSpaceNotFoundException;
import com.workplace.drive.exception.DriveTransferLinkForbiddenException;
import com.workplace.drive.exception.DriveTransferLinkGoneException;
import com.workplace.drive.exception.DriveTransferLinkNotFoundException;
import com.workplace.drive.repository.DriveFileRepository;
import com.workplace.drive.repository.DriveTransferLinkRepository;
import com.workplace.drive.repository.DriveTransferLinkRepository.TransferLinkRow;
import com.workplace.file.service.FileUploadService;
import com.workplace.file.service.FileUploadService.FileContentResult;
import com.workplace.global.tenant.MembershipGuard;
import com.workplace.global.tenant.TenantStatusChecker;
import java.io.IOException;
import java.math.BigInteger;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 드라이브 전송 링크(WP-369) — 외부 MCP 클라이언트(curl·브라우저)가 로그인 없이 쓰는 10분짜리 일회용 서명 링크의 발급·소비.
 *
 * <p>공유 링크({@link DriveShareLinkService})와 같은 방식을 따른다: 토큰은 접두사 + base62(32 랜덤 바이트), DB 에는 SHA-256
 * hex 만, 공개 경로의 조회·소비는 SECURITY DEFINER 함수. 공유 링크와 다른 점은 발급자에게 묶이고(쓸 때 발급자 권한을 다시 확인), 한 번만 쓸 수 있다는
 * 것이다.
 *
 * <p>공개 경로 순서(컨트롤러가 조립): {@link #consume}(트랜잭션 밖, 원자적 소비 + 테넌트 활성 확인) → 컨트롤러가 TenantContext 설정 →
 * {@link #openDownloadAsIssuer}(발급자 권한 재확인 + 파일 읽기) → finally 에서 컨텍스트 정리. 소비 뒤 실패해도 링크는 되살아나지 않는다.
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

  private static final String BASE62 =
      "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

  private final DriveTransferLinkRepository links;
  private final DriveFileRepository files;
  private final DrivePermissions perms;
  private final FileUploadService fileUpload;
  private final MembershipGuard membershipGuard;
  private final TenantStatusChecker tenantStatusChecker;
  private final SecureRandom secureRandom = new SecureRandom();

  /** 외부에서 닿는 웹 기준 주소(끝 슬래시 제거). 운영은 WEB_BASE_URL, 비면 기동 실패({@code PublicBaseUrlCheck}). */
  private final String publicBaseUrl;

  public DriveTransferLinkService(
      DriveTransferLinkRepository links,
      DriveFileRepository files,
      DrivePermissions perms,
      FileUploadService fileUpload,
      MembershipGuard membershipGuard,
      TenantStatusChecker tenantStatusChecker,
      @Value("${workplace.public-base-url}") String publicBaseUrl) {
    this.links = links;
    this.files = files;
    this.perms = perms;
    this.fileUpload = fileUpload;
    this.membershipGuard = membershipGuard;
    this.tenantStatusChecker = tenantStatusChecker;
    this.publicBaseUrl = stripTrailingSlash(publicBaseUrl);
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
    links.insert(
        KIND_DOWNLOAD,
        DriveShareLinkService.sha256Hex(token),
        callerId,
        row.spaceId(),
        null,
        driveFileId,
        null,
        expiresAt);
    return new DriveDownloadLinkResponse(
        publicUrl(token), expiresAt, meta.originalName(), meta.size(), meta.mimeType(), true);
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
   * "새 링크를 발급받으세요"로 끝난다 — 링크는 이미 소비됐다.
   */
  @Transactional(readOnly = true)
  public FileContentResult openDownloadAsIssuer(TransferLinkRow link) throws IOException {
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
    return fileUpload.getFileContentTrusted(row.fileId()).withName(row.name());
  }

  private static DriveTransferLinkForbiddenException lostPermission() {
    return new DriveTransferLinkForbiddenException(
        "링크를 발급한 사용자에게 더 이상 이 파일에 접근할 권한이 없습니다. 새 링크를 발급받으세요");
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
