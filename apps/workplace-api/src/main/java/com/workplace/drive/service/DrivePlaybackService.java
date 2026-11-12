package com.workplace.drive.service;

import com.workplace.audit.service.AuditLogService;
import com.workplace.drive.dto.DrivePlaybackUrlResponse;
import com.workplace.drive.exception.DriveFileNotFoundException;
import com.workplace.drive.exception.DriveForbiddenException;
import com.workplace.drive.exception.DriveNotPlayableException;
import com.workplace.drive.exception.DriveSpaceNotFoundException;
import com.workplace.drive.repository.DriveFileRepository;
import com.workplace.drive.service.DrivePlaybackTokens.Claims;
import com.workplace.file.exception.FileBlobMissingException;
import com.workplace.file.exception.FileNotFoundException;
import com.workplace.file.service.FileUploadService;
import com.workplace.file.service.FileUploadService.FileContentResult;
import com.workplace.global.tenant.MembershipGuard;
import com.workplace.global.tenant.TenantContext;
import java.io.IOException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 드라이브 영상·오디오 바로 재생(WP-1532) — 봉인 재생 주소 발급과, 그 주소로 들어온 요청의 매번 재검증.
 *
 * <p>발급(로그인 필요): 볼 권한(VIEWER 이상, 휴지통·비멤버는 404) → 영상·오디오만 → 열람 감사 1건 → 봉인 주소. 범위 요청은 영상 하나에 수십 번 오므로
 * 감사는 여기서 한 번만 남긴다.
 *
 * <p>열기(공개 경로, 토큰이 곧 권한): 봉인(변조)·만료는 컨트롤러가 {@link DrivePlaybackTokens#verify} 로 본 뒤 TenantContext 를
 * 토큰의 테넌트로 세우고 이 서비스를 부른다. 여기서 파일이 아직 살아 있는지(휴지통·삭제), 현재 버전이 발급 때와 같은지, 발급받은 사용자가 아직 볼 수 있는지를 매 요청
 * 다시 확인한다. 어떤 실패든 같은 404 로 돌려 토큰·파일 존재 여부를 드러내지 않는다.
 */
@Slf4j
@Service
public class DrivePlaybackService {

  /** 공개 재생 경로 — SecurityConfig permitAll·속도 제한 필터·공개 컨트롤러 매핑이 모두 이 값을 쓴다(따로 적으면 어긋난다). */
  public static final String PUBLIC_PATH = "/api/v1/public/drive/playback/";

  /**
   * 재생 주소 수명 — 4시간. 1GB(WP-1519 상한) 영상은 저비트레이트면 몇 시간짜리일 수 있고, 재생 중 멈췄다 한참 뒤 탐색해도 만료로 끊기지 않아야
   * 한다(플레이어는 오류를 「재생할 수 없는 형식」으로 보여 준다). 새어 나간 주소의 위험은 매 요청 재검증(권한·휴지통·버전)으로 줄인다 — 볼 권한을 잃거나 파일이
   * 휴지통에 가거나 새 버전이 오르면 만료 전이라도 바로 404 다.
   */
  static final Duration TTL = Duration.ofHours(4);

  /** 감사 action — 재생 주소 발급(= 영상·오디오 열람). 범위 요청마다가 아니라 발급 때 한 번. */
  public static final String AUDIT_PLAYBACK = "FILE_PLAYBACK";

  /**
   * 바로 재생할 형식 — 브라우저 미디어 요소가 한 파일로 여는 구체적인 컨테이너만(파라미터·대소문자 무시). 재생 목록(m3u8·mpegurl)은 다른 주소를 불러오는
   * 문서이고 asf·wmv 같은 형식은 브라우저가 열지 못하므로 뺀다 — 목록 밖 형식은 발급하지 않고(409), 웹은 같은 목록으로 판정해 기존 blob 경로(미지원 화면
   * + 다운로드)로 둔다. 별칭(audio/x-wav·audio/x-m4a·audio/mp3)은 업로드 때 흔히 붙는 값이라 함께 받는다.
   */
  public static final Set<String> PLAYABLE_MIMES =
      Set.of(
          "video/mp4",
          "video/webm",
          "video/quicktime",
          "video/ogg",
          "video/x-matroska",
          "audio/mpeg",
          "audio/mp3",
          "audio/mp4",
          "audio/x-m4a",
          "audio/aac",
          "audio/ogg",
          "audio/wav",
          "audio/x-wav",
          "audio/webm",
          "audio/flac");

  private final DriveFileService fileService;
  private final DriveFileRepository files;
  private final DrivePermissions perms;
  private final FileUploadService fileUpload;
  private final MembershipGuard membershipGuard;
  private final DrivePlaybackTokens tokens;
  private final AuditLogService auditLogService;
  private final Clock clock;

  @Autowired
  public DrivePlaybackService(
      DriveFileService fileService,
      DriveFileRepository files,
      DrivePermissions perms,
      FileUploadService fileUpload,
      MembershipGuard membershipGuard,
      DrivePlaybackTokens tokens,
      AuditLogService auditLogService) {
    this(
        fileService,
        files,
        perms,
        fileUpload,
        membershipGuard,
        tokens,
        auditLogService,
        Clock.systemUTC());
  }

  /** 테스트용 — 시계를 고정해 만료 시각(발급 + TTL) 경계를 본다(DrivePlaybackTokens 와 같은 방식). */
  DrivePlaybackService(
      DriveFileService fileService,
      DriveFileRepository files,
      DrivePermissions perms,
      FileUploadService fileUpload,
      MembershipGuard membershipGuard,
      DrivePlaybackTokens tokens,
      AuditLogService auditLogService,
      Clock clock) {
    this.fileService = fileService;
    this.files = files;
    this.perms = perms;
    this.fileUpload = fileUpload;
    this.membershipGuard = membershipGuard;
    this.tokens = tokens;
    this.auditLogService = auditLogService;
    this.clock = clock;
  }

  /**
   * 재생 주소 발급. 볼 수 없는(없는·휴지통·비멤버) 파일은 404, 영상·오디오가 아니면 409 — 공개 경로로 HTML·SVG 같은 문서를 inline 으로 내주는
   * 주소가 생기지 않게 미디어만 받는다. 감사는 같은 트랜잭션에서 남긴다.
   *
   * @return 상대 경로 url(같은 출처 — dev 는 Vite 프록시, 운영은 nginx 를 거친다)과 만료 시각
   */
  @Transactional
  public DrivePlaybackUrlResponse issue(long callerId, long driveFileId) {
    DriveFileRepository.DriveFileRow row = fileService.viewableRow(callerId, driveFileId);
    String mime = files.findCurrentMime(row.fileId());
    if (!isPlayable(mime)) {
      throw new DriveNotPlayableException();
    }
    Instant expiresAt = clock.instant().plus(TTL).truncatedTo(ChronoUnit.SECONDS);
    String token =
        tokens.seal(
            new Claims(TenantContext.get(), callerId, driveFileId, row.fileId(), expiresAt));
    auditLogService.log(
        callerId,
        fileService.usernameOf(callerId),
        AUDIT_PLAYBACK,
        "drive",
        String.valueOf(driveFileId),
        "드라이브 파일 재생: " + row.name(),
        null,
        null,
        "SUCCESS",
        null,
        Map.of("fileId", row.fileId(), "mimeType", mime));
    return new DrivePlaybackUrlResponse(
        PUBLIC_PATH + token, expiresAt.atOffset(ZoneOffset.UTC), mime);
  }

  /**
   * 토큰이 확인된 재생 요청의 파일을 연다. 호출부가 TenantContext 를 토큰의 테넌트로 세운 뒤 부른다(트랜잭션이 테넌트 GUC 를 주입한다). 파일이
   * 휴지통·삭제(findRow 가 제외)거나, 현재 버전이 발급 때와 다르거나, 사용자가 더는 워크스페이스·공간 구성원이 아니거나, 저장된 형식이 재생 목록 밖이거나, 원본을
   * 읽을 수 없으면 모두 404.
   */
  @Transactional(readOnly = true)
  public FileContentResult open(Claims c) throws IOException {
    DriveFileRepository.DriveFileRow row =
        files
            .findRow(c.driveFileId())
            .filter(r -> r.fileId() == c.coreFileId())
            .orElseThrow(() -> new DriveFileNotFoundException(c.driveFileId()));
    if (membershipGuard.isForeignUser(c.userId())) {
      throw new DriveFileNotFoundException(c.driveFileId());
    }
    try {
      perms.requireFileViewer(row.spaceId(), c.userId(), c.driveFileId());
      FileContentResult content =
          fileUpload.getFileContentTrusted(row.fileId()).withName(row.name());
      if (!isPlayable(content.mimeType())) {
        throw new DriveFileNotFoundException(c.driveFileId());
      }
      return content;
    } catch (DriveSpaceNotFoundException
        | DriveForbiddenException
        | FileNotFoundException
        | FileBlobMissingException e) {
      throw new DriveFileNotFoundException(c.driveFileId());
    } catch (IOException e) {
      // 원본 크기·경로를 읽다 난 I/O 오류 — 공개 경로라 500 으로 사정을 드러내지 않고 같은 404, 원인은 서버 로그에만.
      log.warn("재생 원본 읽기 실패 — driveFileId={}", c.driveFileId(), e);
      throw new DriveFileNotFoundException(c.driveFileId());
    }
  }

  /** 바로 재생할 형식인가 — {@link #PLAYABLE_MIMES} 에 든 기본 형식(`;` 앞, 대소문자·공백 무시)일 때만. */
  public static boolean isPlayable(String mime) {
    if (mime == null) return false;
    int semi = mime.indexOf(';');
    String base = (semi >= 0 ? mime.substring(0, semi) : mime).trim().toLowerCase(Locale.ROOT);
    return PLAYABLE_MIMES.contains(base);
  }
}
