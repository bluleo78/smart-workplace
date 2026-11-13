package com.workplace.drive.service;

import com.workplace.audit.service.AuditLogService;
import com.workplace.drive.dto.CreateShareLinkRequest;
import com.workplace.drive.dto.ShareFolderListing;
import com.workplace.drive.dto.ShareInfoResponse;
import com.workplace.drive.dto.ShareLinkResponse;
import com.workplace.drive.exception.DriveFileNotFoundException;
import com.workplace.drive.exception.DriveFolderNotFoundException;
import com.workplace.drive.exception.DriveInvalidTargetException;
import com.workplace.drive.exception.DriveShareLinkGoneException;
import com.workplace.drive.exception.DriveShareLinkNotFoundException;
import com.workplace.drive.repository.DriveFileRepository;
import com.workplace.drive.repository.DriveFolderRepository;
import com.workplace.drive.repository.DriveShareLinkRepository;
import com.workplace.drive.repository.DriveShareLinkVisitRepository;
import com.workplace.drive.repository.DriveSharedFolderRepository;
import com.workplace.drive.repository.DriveSpaceMemberRepository;
import com.workplace.drive.repository.DriveSpaceRepository;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.tenant.TenantStatusChecker;
import com.workplace.global.util.CapabilityTokens;
import com.workplace.global.util.PersonNames;
import com.workplace.user.repository.UserRepository;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 공유 링크 관리(생성/목록/폐기). 생성 권한 EDITOR. 토큰은 해시(resolve 용)와 AES-GCM 암호문(WP-1528, 목록에서 다시 보여주기 용)으로만 저장하고
 * 평문은 저장하지 않는다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class DriveShareLinkService {
  private static final Set<String> AUDIENCES = Set.of("EXTERNAL", "INTERNAL");

  /** 폴더 공유 하위 목록 한 번에 싣는 상한(WP-1538, P8) — 폴더를 먼저 채우고 남은 칸만큼 파일. */
  static final int CHILDREN_LIMIT = 1000;

  private final DriveShareLinkRepository links;
  private final DriveFileRepository files;

  /** 폴더 공유 링크의 살아 있는 폴더·공간 확인(WP-1538). */
  private final DriveFolderRepository folders;

  private final DrivePermissions perms;
  private final PasswordEncoder passwordEncoder;

  /** 토큰 암호문 저장·복호화(WP-1528) — 공유받은 항목(WP-1539)과 같은 규칙. */
  private final ShareLinkTokenCodec tokenCodec;

  /** 공유 링크 비밀번호 브루트포스 방어(#700). */
  private final DriveShareLinkAttemptService attemptService;

  /** 감사 로그 기록(#81). */
  private final AuditLogService auditLogService;

  /** 사용자명 조회용 — 감사 로그에 username 을 기록한다(#81). */
  private final UserRepository userRepository;

  // WP-341: 정지·삭제된 테넌트의 공유 링크를 "없음"으로 처리하기 위한 테넌트 상태 확인.
  private final TenantStatusChecker tenantStatusChecker;

  /**
   * 익명 공개 경로에서 링크의 워크스페이스로 감사를 남기거나(WP-789 — logInTenant 는 트랜잭션 안에서만) 공유 정보를 읽을 때(WP-1227 — FORCE
   * RLS 라 트랜잭션 밖 조회는 빈 결과) 쓰는 트랜잭션.
   */
  private final TransactionTemplate tx;

  /** 공유 링크 열람 토큰 발급·검증(WP-1227). */
  private final ShareViewTokens viewTokens;

  /** 「드라이브에서 열기」 판정 — 요청자의 공간 역할(부서 역할 포함, WP-1227). */
  private final DriveSpaceMemberRepository spaceMembers;

  /** 앱 카드 Member 판정과 공간 이름(WP-1474) — 실효 역할(부서 역할 포함)이 있는 공간만 돌려준다. */
  private final DriveSpaceRepository spaces;

  /** 「공유받은 항목」 기록(WP-1539) — 사내 링크를 연 같은 워크스페이스 사람. */
  private final DriveShareLinkVisitRepository visits;

  /** 폴더 공유 링크의 자손 사슬·하위 목록(WP-1538). */
  private final DriveSharedFolderRepository sharedFolders;

  /**
   * 공유 링크를 거는 대상(WP-1538) — 파일 또는 폴더. 관리 API 가 한 흐름으로 다루려고 묶는다.
   *
   * <p>저장 칸(drive_file_id·drive_folder_id)과 감사 칸(action·요약·detail)은 종류마다 정해져 있어 각 record 가 직접 답한다 —
   * 생성 흐름이 대상 종류를 다시 가려내지 않게 한다.
   */
  public sealed interface Target {
    /** 대상 id(파일이면 드라이브 파일 id, 폴더면 드라이브 폴더 id) — 감사 targetId 로도 쓴다. */
    long id();

    /** 링크 행의 drive_file_id — 파일 대상만 채운다. */
    Long driveFileId();

    /** 링크 행의 drive_folder_id — 폴더 대상만 채운다. */
    Long driveFolderId();

    /** 생성 감사 action — 파일 FILE_SHARE(#81), 폴더 FOLDER_SHARE(WP-1538). */
    String auditAction();

    /** 생성 감사 요약 문구. */
    String auditSummary();

    /** 생성 감사 detail — 파일은 예전 칸 그대로(#81, 칸 불변), 폴더는 target 칸을 더한다. */
    Map<String, Object> auditDetail(long spaceId, String audience);

    /** 드라이브 파일 id. */
    record File(long id) implements Target {
      @Override
      public Long driveFileId() {
        return id;
      }

      @Override
      public Long driveFolderId() {
        return null;
      }

      @Override
      public String auditAction() {
        return "FILE_SHARE";
      }

      @Override
      public String auditSummary() {
        return "공유 링크 생성";
      }

      @Override
      public Map<String, Object> auditDetail(long spaceId, String audience) {
        return Map.of("spaceId", spaceId, "audience", audience);
      }
    }

    /** 드라이브 폴더 id. */
    record Folder(long id) implements Target {
      @Override
      public Long driveFileId() {
        return null;
      }

      @Override
      public Long driveFolderId() {
        return id;
      }

      @Override
      public String auditAction() {
        return "FOLDER_SHARE";
      }

      @Override
      public String auditSummary() {
        return "폴더 공유 링크 생성";
      }

      @Override
      public Map<String, Object> auditDetail(long spaceId, String audience) {
        return Map.of("spaceId", spaceId, "audience", audience, "target", "FOLDER");
      }
    }
  }

  /** 파일 링크 생성 — {@link #create(long, Target, CreateShareLinkRequest)} 위임(기존 호출부 유지). */
  @Transactional
  public ShareLinkResponse create(long callerId, long driveFileId, CreateShareLinkRequest req) {
    return create(callerId, new Target.File(driveFileId), req);
  }

  /**
   * 링크 생성. 대상(파일·폴더)의 공간 EDITOR 검증 → 토큰 생성 → 해시+암호문 저장 → 목록과 같은 모양의 항목(평문 토큰·만든 사람 이름·만든 시각 포함)을
   * 돌려준다 (WP-1528). 예전 생성 응답의 칸(id·token·audience·hasPassword·expiresAt)은 그대로 들어 있어 기존 호출부와 호환된다.
   * 폴더 대상(WP-1538)은 비멤버를 「폴더 없음」 404 로 숨기고, 감사는 FOLDER_SHARE 로 남긴다.
   */
  @Transactional
  public ShareLinkResponse create(long callerId, Target target, CreateShareLinkRequest req) {
    long spaceId;
    switch (target) {
      case Target.File f -> {
        DriveFileRepository.DriveFileRow row =
            files.findRow(f.id()).orElseThrow(() -> new DriveFileNotFoundException(f.id()));
        // WP-1424: 비멤버는 공간 없음 대신 파일 없음(404)으로 파일 id 존재를 숨긴다.
        perms.requireFileRole(row.spaceId(), callerId, f.id(), "EDITOR");
        spaceId = row.spaceId();
      }
      case Target.Folder f -> {
        spaceId =
            folders.findSpaceId(f.id()).orElseThrow(() -> new DriveFolderNotFoundException(f.id()));
        // WP-1538: 비멤버는 공간 없음 대신 폴더 없음(404), 보관 공간은 403.
        perms.hidingNonMember(
            () -> perms.requireRole(spaceId, callerId, "EDITOR"),
            () -> new DriveFolderNotFoundException(f.id()));
      }
    }

    String audience = req.audience();
    if (audience == null || !AUDIENCES.contains(audience)) {
      throw new DriveInvalidTargetException("공유 대상이 올바르지 않습니다.");
    }
    String token = CapabilityTokens.generate("sl_");
    String tokenHash = CapabilityTokens.sha256Hex(token);
    String pwHash = encodePasswordOrNull(req.password());
    OffsetDateTime expiresAt =
        req.expiresAt() == null ? null : req.expiresAt().atOffset(ZoneOffset.UTC);
    // 과거 만료일 차단(#673) — 프런트 가드가 우회되더라도(직접 API 호출 등) 생성 시점부터
    // 이미 무효인 링크가 만들어지지 않도록 서버에서도 강제.
    if (expiresAt != null && expiresAt.isBefore(OffsetDateTime.now())) {
      throw new DriveInvalidTargetException("만료일은 현재 시각 이후여야 합니다.");
    }

    long id =
        links.insert(
            target.driveFileId(),
            target.driveFolderId(),
            spaceId,
            tokenHash,
            tokenCodec.encrypt(token),
            audience,
            pwHash,
            expiresAt,
            callerId);
    // 감사 로그 — 파일 FILE_SHARE(#81, 칸 불변)·폴더 FOLDER_SHARE(WP-1538), 같은 @Transactional 안에서 기록.
    auditLogService.log(
        callerId,
        usernameOf(callerId),
        target.auditAction(),
        "drive",
        String.valueOf(target.id()),
        target.auditSummary(),
        null,
        null,
        "SUCCESS",
        null,
        target.auditDetail(spaceId, audience));
    // 방금 넣은 행을 목록과 같은 조회로 읽는다 — 토큰은 이미 아는 평문을 그대로 싣는다(복호화할 까닭이 없다).
    DriveShareLinkRepository.ShareLinkRow created =
        links.findRow(id).orElseThrow(() -> new IllegalStateException("생성한 공유 링크를 찾지 못함 id=" + id));
    return toResponse(created, token);
  }

  /**
   * 링크 비밀번호를 해시로 바꾼다(WP-1385). 칸을 비운 경우(null·빈 문자열)만 비밀번호 없는 링크(null)다.
   *
   * <p>보이는 글자가 하나도 없는 값(공백·제로폭 문자·한글 채움 등 — 기준은 {@link PersonNames#hasVisibleChar}, 웹
   * lib/visibleText.ts 와 같다)은 예전엔 「비밀번호 없음」으로 조용히 바뀌어, 사용자는 비밀번호를 걸었다고 믿는데 누구나 여는 링크가 만들어졌다. 그래서
   * 400 으로 거절해 다시 입력하게 한다. 그 밖의 값은 입력한 그대로(다듬지 않고) 해시한다 — 바뀌지 않은 동작이다.
   */
  private String encodePasswordOrNull(String password) {
    if (password == null || password.isEmpty()) {
      return null;
    }
    if (!PersonNames.hasVisibleChar(password)) {
      throw new DriveInvalidTargetException("비밀번호에 공백만 넣을 수 없어요. 비밀번호를 입력하거나 칸을 비워 주세요.");
    }
    return passwordEncoder.encode(password);
  }

  /**
   * 파일의 링크 목록. EDITOR 검증(보관 공간도 허용 — 폐기할 링크를 찾아야 하므로). 살아 있는 링크만 토큰을 복호화해 돌려준다(WP-1528) — 폐기·만료된
   * 링크는 다시 쓸 수 없으니 풀지 않고 null 로 둔다(불필요한 평문 노출을 줄인다).
   */
  @Transactional(readOnly = true)
  public List<ShareLinkResponse> list(long callerId, long driveFileId) {
    return list(callerId, new Target.File(driveFileId));
  }

  /** 대상(파일·폴더)의 링크 목록(WP-1538). 폴더는 비멤버를 「폴더 없음」 404 로 숨기고 보관 공간도 허용한다. */
  @Transactional(readOnly = true)
  public List<ShareLinkResponse> list(long callerId, Target target) {
    List<DriveShareLinkRepository.ShareLinkRow> rows;
    switch (target) {
      case Target.File f -> {
        DriveFileRepository.DriveFileRow row =
            files.findRow(f.id()).orElseThrow(() -> new DriveFileNotFoundException(f.id()));
        perms.requireFileRoleEvenIfArchived(row.spaceId(), callerId, f.id(), "EDITOR");
        rows = links.listByFile(f.id());
      }
      case Target.Folder f -> {
        long spaceId =
            folders.findSpaceId(f.id()).orElseThrow(() -> new DriveFolderNotFoundException(f.id()));
        perms.hidingNonMember(
            () -> perms.requireRoleEvenIfArchived(spaceId, callerId, "EDITOR"),
            () -> new DriveFolderNotFoundException(f.id()));
        rows = links.listByFolder(f.id());
      }
    }
    return rows.stream().map(r -> toResponse(r, tokenFor(r))).toList();
  }

  /** 저장소 한 줄 → 응답 항목. 토큰은 호출부가 정한다(목록은 {@link #tokenFor}, 생성은 방금 만든 평문). */
  private static ShareLinkResponse toResponse(
      DriveShareLinkRepository.ShareLinkRow r, String token) {
    return new ShareLinkResponse(
        r.id(),
        r.audience(),
        r.hasPassword(),
        r.expiresAt(),
        r.revoked(),
        r.active(),
        r.createdAt(),
        r.createdBy(),
        r.createdByName(),
        token);
  }

  /**
   * 목록에 실을 토큰 — 살아 있지 않은(폐기·만료) 링크는 다시 쓸 수 없으니 풀지 않고 null. 살아 있으면 암호문을 평문으로 풀고, 그 행의 token_hash 와
   * 맞는지 확인한다. 암호문이 없거나(WP-1528 이전 링크) 풀리지 않거나(키 교체·손상) 해시가 다르면(다른 행 암호문이 옮겨진 경우 등 — 엉뚱한 URL 을 복사하게
   * 하지 않는다) null — 목록 전체가 실패하지 않게 한다. 로그에는 링크 id 만 남기고 토큰·암호문 값은 남기지 않는다.
   */
  private String tokenFor(DriveShareLinkRepository.ShareLinkRow r) {
    if (!r.active()) {
      return null;
    }
    return tokenCodec.restore(r.tokenEncrypted(), r.tokenHash(), r.id());
  }

  /** 링크 폐기. 링크의 공간 EDITOR 검증(보관 공간도 허용 — 공유 중단은 노출을 줄이는 작업). 미존재/이미폐기 → 404. */
  @Transactional
  public void revoke(long callerId, long linkId) {
    Long spaceId =
        links.findSpaceIdOfActive(linkId).orElseThrow(DriveShareLinkNotFoundException::new);
    // WP-1424: 비멤버는 살아 있는 링크도 없는 링크 id 와 같은 404 — 공간 없음 문구로 링크 존재가 새지 않게 한다.
    perms.hidingNonMember(
        () -> perms.requireRoleEvenIfArchived(spaceId, callerId, "EDITOR"),
        DriveShareLinkNotFoundException::new);
    links.revoke(linkId);
  }

  /**
   * 공개 다운로드용 resolve + 가드. 컨텍스트 설정은 호출부(컨트롤러)가 담당(2-트랜잭션).
   *
   * <p>비밀번호 검증에는 브루트포스 방어(#700)가 적용된다 — {@code login_attempts}(#144)와 동일 정책(5회 연속 실패 시 15분 잠금)을 공유
   * 토큰의 SHA-256 hex(token_hash) 기준으로 적용한다. 비교 전에 시도 한 칸을 원자적으로 잡아(WP-783) 동시 요청으로도 상한을 넘겨 추측하지 못하게
   * 하고, 잠긴 상태에서는 bcrypt 비교조차 수행하지 않는다(fail-closed, 연산 낭비 방지).
   *
   * <p>WP-1227: 열람 토큰도 받는다. 링크 가드는 그대로 거치고, 비밀번호 링크에서 열람 토큰이 유효하면(잠기지 않았을 때만) 비밀번호 검증을 건너뛴다. 토큰이
   * 없거나 무효면 기존과 같은 비밀번호 검증으로 넘어간다 — 다운로드 계약은 바뀌지 않는다.
   */
  public ResolvedTarget resolveForDownload(
      String token,
      String password,
      String viewToken,
      Long requesterTenantId,
      boolean authenticated) {
    // WP-1538: 폴더 링크는 파일 전용 경로에서 404 — 비밀번호 검증 <b>전</b>이라 시도 칸을 쓰지 않는다.
    GuardedLink g = guard(token, requesterTenantId, authenticated, DriveShareTarget.FILE);
    if (requiresPassword(g, viewToken)) {
      verifyPassword(g, password);
    }
    return g.target();
  }

  /**
   * 미리보기·원본(inline) 경로용 resolve(WP-1227). 링크 가드는 그대로이고, 비밀번호 링크는 유효한 열람 토큰만 받는다 — 비밀번호 자체는 받지 않아 이
   * 경로로는 시도 칸을 쓰지 않는다(비밀번호 추측은 /unlock 한 곳에서만, 속도 제한·잠금과 함께). 토큰이 없거나 무효면 401.
   */
  public ResolvedTarget resolveForView(
      String token, String viewToken, Long requesterTenantId, boolean authenticated) {
    // WP-1538: 폴더 링크는 파일 전용 경로에서 404(비밀번호 판정 전)
    GuardedLink g = guard(token, requesterTenantId, authenticated, DriveShareTarget.FILE);
    requireViewAccess(g, viewToken);
    return g.target();
  }

  /**
   * 폴더 링크의 하위 파일 경로(content·preview·download)용 resolve(WP-1538, spec §4.2). 순서: 링크 가드 → 파일 링크면 404
   * → 비밀번호 링크에 유효 열람 토큰이 없으면 401(비밀번호 헤더는 받지 않는다 — P7, 시도 칸도 쓰지 않는다) → 링크 워크스페이스·트랜잭션에서 파일 행
   * 조회(없음·휴지통 404) → 공간 루트 파일(폴더 없음)이면 404 → 파일의 폴더가 공유 폴더의 살아 있는 자손인지 검사(밖이면 404). 자손 검사가 잠금·로그인
   * 판정 <b>뒤</b>라 열지 못하는 사람은 파일 id 를 떠볼 수 없다. 매 요청 판정이라 밖으로 옮긴 폴더·휴지통의 파일은 곧바로 404.
   */
  public ResolvedTarget resolveFolderFile(
      String token,
      String viewToken,
      long driveFileId,
      Long requesterTenantId,
      boolean authenticated) {
    var link = guardFolderLink(token, viewToken, requesterTenantId, authenticated);
    TenantContext.callAs(
        link.tenantId(),
        () ->
            tx.execute(
                st -> {
                  var row =
                      files.findRow(driveFileId).orElseThrow(DriveShareLinkNotFoundException::new);
                  if (row.folderId() == null) {
                    throw new DriveShareLinkNotFoundException();
                  }
                  return requireDescendantFolder(link, row.folderId());
                }));
    return new ResolvedTarget(link.tenantId(), driveFileId);
  }

  /**
   * 폴더 링크 전용 경로(children·하위 파일)의 공통 가드(WP-1538) — 링크 가드(404 → 410 → 사내 401/403) → 파일 링크면 404 → 비밀번호
   * 링크에 유효 열람 토큰이 없으면 401. 자손 검사는 호출부가 이 뒤에 한다(열지 못하는 사람이 id 를 떠볼 수 없게).
   */
  private DriveShareLinkRepository.ResolvedLink guardFolderLink(
      String token, String viewToken, Long requesterTenantId, boolean authenticated) {
    GuardedLink g = guard(token, requesterTenantId, authenticated, DriveShareTarget.FOLDER);
    requireViewAccess(g, viewToken);
    return g.link();
  }

  /** 열람 토큰만 받는 경로의 비밀번호 판정 — 비밀번호 링크인데 유효한 열람 토큰이 없으면(잠금 포함) 401. 시도 칸을 쓰지 않는다. */
  private void requireViewAccess(GuardedLink g, String viewToken) {
    if (requiresPassword(g, viewToken)) {
      throw new com.workplace.drive.exception.DriveShareLinkUnauthorizedException(
          "비밀번호 확인이 필요하거나 열람 시간이 지났습니다");
    }
  }

  /**
   * 비밀번호를 확인하고 열람 토큰을 발급한다(POST /unlock, WP-1227). 시도 칸·잠금·감사는 다운로드와 같은 {@link #verifyPassword} 를
   * 쓴다 — 틀리면 401, 잠기면 429(기존 매핑). 비밀번호 없는 링크도 토큰을 돌려준다(클라이언트가 분기하지 않아도 되게, 확인할 것이 없으니 무해).
   */
  public ShareViewTokens.ViewToken unlock(
      String token, String password, Long requesterTenantId, boolean authenticated) {
    GuardedLink g = guard(token, requesterTenantId, authenticated);
    verifyPassword(g, password);
    return viewTokens.issue(g.tokenHash(), g.link().passwordHash());
  }

  /**
   * 공유 링크 정보(GET /share/{token}, WP-1227) — 받는 화면이 미리보기·잠금·로그인 안내 중 무엇을 보일지 정한다. 시도 칸을 쓰지 않는다(잠긴
   * 링크도 「비밀번호 필요」로만 답한다 — 정보 조회로 잠금 여부를 떠보거나 칸을 소모시키지 못하게).
   *
   * <p>순서는 다운로드와 같다: 404(없음·비활성 테넌트) → 410(만료·폐기) → 사내 링크(비로그인 200 loginRequired, 다른 워크스페이스 403) →
   * 비밀번호 링크 + 유효 토큰 없음 200 passwordRequired → 파일 정보. 휴지통·없는 파일은 다운로드와 같은 404 「공유 링크 없음」.
   *
   * <p>파일·만든 사람·공간 권한은 링크 워크스페이스로 컨텍스트를 세운 뒤 트랜잭션 안에서 읽는다 — FORCE RLS 라 트랜잭션 밖의 조회는 빈 결과가 된다. 끝나면
   * 요청자의 원래 컨텍스트로 되돌린다.
   *
   * <p>WP-1538: 폴더 링크는 같은 순서를 거친 뒤 {@link #folderInfo} 가 FolderFull 을 만든다. Gate 에는 대상 종류(target)만
   * 싣는다.
   *
   * @param requesterUserId 로그인 사용자 id(비로그인 null) — driveOpen 판정용
   */
  public ShareInfoResponse info(
      String token, String viewToken, Long requesterTenantId, Long requesterUserId) {
    boolean authenticated = requesterUserId != null;
    String tokenHash = CapabilityTokens.sha256Hex(token);
    var link = resolveActive(tokenHash);
    if ("INTERNAL".equals(link.audience()) && (!authenticated || requesterTenantId == null)) {
      return ShareInfoResponse.loginRequired(link.target());
    }
    GuardedLink g = new GuardedLink(tokenHash, link);
    checkAudience(link, requesterTenantId, authenticated);
    if (requiresPassword(g, viewToken)) {
      return ShareInfoResponse.passwordRequired(link.target());
    }
    boolean sameWorkspace =
        authenticated && requesterTenantId != null && requesterTenantId == link.tenantId();
    // 폴더 링크도 파일과 같은 규칙(visitTarget)으로 공유받은 항목(WP-1539·WP-1540)에 기록한다.
    InfoResult result =
        TenantContext.callAs(
            link.tenantId(),
            () ->
                tx.execute(
                    link.target() == DriveShareTarget.FOLDER
                        ? st -> folderInfo(link, tokenHash, sameWorkspace, requesterUserId)
                        : st ->
                            fileInfo(
                                link, tokenHash, sameWorkspace, authenticated, requesterUserId)));
    if (result.visitLinkId() != null) {
      recordVisit(link.tenantId(), requesterUserId, result.visitLinkId(), token);
    }
    return result.response();
  }

  /** 파일 링크 정보 — 링크 워크스페이스 컨텍스트·트랜잭션 안에서 부른다. 응답과 기록 대상 링크 id 를 함께 돌려준다. */
  private InfoResult fileInfo(
      DriveShareLinkRepository.ResolvedLink link,
      String tokenHash,
      boolean sameWorkspace,
      boolean authenticated,
      Long requesterUserId) {
    var f = loadFile(link);
    var row = f.row();
    var meta = f.meta();
    // 링크 id·만든 사람 — 「공유한 사람」과 공유받은 항목 기록 판정이 한 번의 조회를 함께 쓴다.
    var creator = links.findCreator(tokenHash).orElse(null);
    var access = requesterAccess(link, row.spaceId(), creator, sameWorkspace, requesterUserId);
    ShareInfoResponse.DriveOpen driveOpen =
        access.member()
            ? new ShareInfoResponse.DriveOpen(row.spaceId(), row.folderId(), row.id())
            : null;
    return new InfoResult(
        ShareInfoResponse.full(
            row.name(),
            meta.mimeType(),
            meta.sizeBytes(),
            creatorName(creator),
            !authenticated,
            driveOpen),
        access.visitLinkId());
  }

  /**
   * 요청자가 그 공간 구성원인지와 공유받은 항목 기록 대상 링크 id — 파일·폴더 링크 정보가 같은 판정을 쓴다.
   *
   * <p>「드라이브에서 열기」는 같은 워크스페이스에서 그 공간을 볼 수 있는(VIEWER 이상, 부서 역할 포함) 사람에게만 보인다 — 볼 수 없는 사람에게 공간·폴더 id
   * 를 알려 주지 않는다. 구성원이면 기록하지 않는다({@link #visitTarget}). 링크 워크스페이스 컨텍스트·트랜잭션 안에서 부른다.
   */
  private InfoAccess requesterAccess(
      DriveShareLinkRepository.ResolvedLink link,
      long spaceId,
      DriveShareLinkRepository.LinkCreator creator,
      boolean sameWorkspace,
      Long requesterUserId) {
    boolean member = sameWorkspace && spaceMembers.findRole(spaceId, requesterUserId).isPresent();
    return new InfoAccess(
        member, visitTarget(link, creator, sameWorkspace, member, requesterUserId));
  }

  /** {@link #requesterAccess} 결과 — 공간 구성원 여부와 기록할 링크 id(기록 대상이 아니면 null). */
  private record InfoAccess(boolean member, Long visitLinkId) {}

  /** 링크를 만든 사람 이름 — 찾을 수 없으면 null(「공유한 사람」 칸이 비어 보인다). */
  private static String creatorName(DriveShareLinkRepository.LinkCreator creator) {
    return creator == null ? null : creator.name();
  }

  /** info 트랜잭션 결과 — 응답과, 공유받은 항목에 기록할 링크 id(기록 대상이 아니면 null). */
  private record InfoResult(ShareInfoResponse response, Long visitLinkId) {}

  /**
   * 공유받은 항목 기록 대상인가(WP-1539) — 기록할 링크 id, 아니면 null. 이 판정까지 왔다면 링크가 살아 있고 비밀번호도 통과했다(비밀번호 링크는 잠금 해제
   * 뒤에만 여기 온다). 기록하는 경우는 로그인한 같은 워크스페이스 사람이 사내(INTERNAL) 링크를 열었고, 링크를 만든 본인이 아니고, 그 공간의 구성원이 아닐
   * 때뿐이다 — 구성원은 공간에서 바로 보이고, 외부 링크·내 링크는 「공유받은」 것이 아니다. 링크 워크스페이스 컨텍스트·트랜잭션 안에서 부른다.
   */
  private Long visitTarget(
      DriveShareLinkRepository.ResolvedLink link,
      DriveShareLinkRepository.LinkCreator creator,
      boolean sameWorkspace,
      boolean member,
      Long requesterUserId) {
    if (!"INTERNAL".equals(link.audience()) || !sameWorkspace || member || creator == null) {
      return null;
    }
    return creator.createdBy() == requesterUserId ? null : creator.id();
  }

  /**
   * 공유받은 항목 기록(WP-1539) — 정보 조회와 같은 요청 안에서, 별도 트랜잭션으로 남긴다. 같은 트랜잭션에서 실패하면 Postgres 가 트랜잭션을 통째로 중단시켜
   * 공유 화면까지 깨지므로 따로 두고, 실패해도 로그만 남기고 공유 화면은 그대로 보인다(기록은 편의 기능이라). 토큰은 AES-GCM 암호문으로만 둔다 — WP-1528
   * 이전 링크도 목록에서 다시 열고 복사할 수 있게. 로그에는 링크 id 만 남긴다.
   */
  private void recordVisit(long tenantId, long userId, long linkId, String token) {
    try {
      String tokenEncrypted = tokenCodec.encrypt(token);
      TenantContext.runAs(
          tenantId,
          () -> tx.executeWithoutResult(st -> visits.recordOpen(userId, linkId, tokenEncrypted)));
    } catch (RuntimeException e) {
      log.warn("공유받은 항목 기록 실패 linkId={}", linkId, e);
    }
  }

  /**
   * 폴더 링크 정보(WP-1538, 기록 WP-1540) — 링크 워크스페이스 컨텍스트·트랜잭션 안에서 부른다. 공유 폴더 자체를 자손 검사와 같은 사슬로 읽어
   * 휴지통·없음이면 404 (P1), 이름·바로 아래 수(P5)·공유한 사람을 싣는다. 「드라이브에서 열기」는 같은 워크스페이스 + 공간 실효 역할일 때만(공간·폴더 id 를
   * 비구성원에게 숨긴다). 만든 사람은 한 번만 읽어 「공유한 사람」과 기록 대상 판정({@link #visitTarget})에 함께 쓴다.
   */
  private InfoResult folderInfo(
      DriveShareLinkRepository.ResolvedLink link,
      String tokenHash,
      boolean sameWorkspace,
      Long requesterUserId) {
    var shared = requireSharedFolder(link);
    // 요약(수·만든 사람)은 앱 카드와 같은 읽기 — 만든 사람 한 번 조회를 「공유한 사람」과 기록 판정이 함께 쓴다.
    var summary = summarizeSharedFolder(shared, tokenHash);
    var access =
        requesterAccess(link, shared.spaceId(), summary.creator(), sameWorkspace, requesterUserId);
    ShareInfoResponse.FolderDriveOpen driveOpen =
        access.member()
            ? new ShareInfoResponse.FolderDriveOpen(shared.spaceId(), shared.id())
            : null;
    return new InfoResult(
        ShareInfoResponse.folderFull(
            shared.name(),
            summary.counts().folderCount(),
            summary.counts().fileCount(),
            summary.sharedBy(),
            requesterUserId == null,
            driveOpen),
        access.visitLinkId());
  }

  /**
   * 폴더 공유 링크의 하위 목록(GET /share/{token}/children, WP-1538). folderId 가 없으면 공유 폴더.
   *
   * <p>순서(spec §4.2): 링크 가드(404 → 410 → 사내 401/403) → 파일 링크면 404 → 비밀번호 링크에 유효 열람 토큰이 없으면 401 → 링크
   * 워크스페이스 RLS 아래에서 자손 검사(404) → 목록. 자손 검사가 잠금·로그인 판정 <b>뒤</b>라 열지 못하는 사람은 폴더 id 를 떠볼 수 없다. 시도 칸을
   * 쓰지 않는다(비밀번호는 /unlock 한 곳에서만).
   *
   * <p>목록은 폴더 먼저·이름순으로 최대 {@value #CHILDREN_LIMIT}개(P8) — 각 쿼리를 한 개 더 읽어 넘치면 truncated.
   */
  public ShareFolderListing children(
      String token,
      String viewToken,
      Long folderId,
      Long requesterTenantId,
      boolean authenticated) {
    var link = guardFolderLink(token, viewToken, requesterTenantId, authenticated);
    long target = folderId == null ? link.driveFolderId() : folderId;
    return TenantContext.callAs(
        link.tenantId(),
        () ->
            tx.execute(
                st -> {
                  var chain = descendantChain(link, target);
                  List<ShareFolderListing.PathItem> path =
                      chain.stream()
                          .map(r -> new ShareFolderListing.PathItem(r.id(), r.name()))
                          .toList();
                  var subFolders = sharedFolders.listChildFolders(target, CHILDREN_LIMIT + 1);
                  boolean truncated = subFolders.size() > CHILDREN_LIMIT;
                  List<ShareFolderListing.FileItem> subFiles = List.of();
                  if (truncated) {
                    subFolders = subFolders.subList(0, CHILDREN_LIMIT);
                  } else {
                    // 폴더를 먼저 채우고 남은 칸만큼 파일 — 남은 칸이 0 이어도 한 개를 읽어 파일이 넘쳤는지 안다.
                    int remaining = CHILDREN_LIMIT - subFolders.size();
                    subFiles = sharedFolders.listChildFiles(target, remaining + 1);
                    if (subFiles.size() > remaining) {
                      truncated = true;
                      subFiles = subFiles.subList(0, remaining);
                    }
                  }
                  return new ShareFolderListing(
                      target, path, List.copyOf(subFolders), List.copyOf(subFiles), truncated);
                }));
  }

  /**
   * 자손 검사(WP-1538, spec §5.1) — folderId 가 공유 폴더 자신이거나 살아 있는 자손이면 그 폴더 행을, 아니면 404. 링크 워크스페이스 컨텍스트와
   * 트랜잭션 안에서 불러야 한다(RLS — 다른 테넌트 id 는 보이지 않아 404).
   *
   * <p>통과 조건: 사슬 첫 행이 공유 폴더, 사슬의 모든 행이 휴지통 아님, 모든 행이 공유 폴더와 같은 공간. 휴지통은 서브트리 전체를 표시하지만 복원·이동 경합을
   * 막으려고 사슬 전체를 본다. 매 요청 판정이라 밖으로 옮긴 폴더는 곧바로 404.
   */
  private DriveSharedFolderRepository.ChainRow requireDescendantFolder(
      DriveShareLinkRepository.ResolvedLink link, long folderId) {
    var chain = descendantChain(link, folderId);
    return chain.get(chain.size() - 1);
  }

  /** 공유 폴더 자신의 행(WP-1538) — 자손 검사와 같은 사슬로 읽어 없거나 휴지통이면 404(P1). */
  private DriveSharedFolderRepository.ChainRow requireSharedFolder(
      DriveShareLinkRepository.ResolvedLink link) {
    return requireDescendantFolder(link, link.driveFolderId());
  }

  /**
   * 공유 폴더 요약(WP-1538) — 바로 아래 폴더·파일 수(P5)와 공유한 사람 이름. 정보 응답·앱 카드가 같은 읽기를 쓴다(봇 미리보기는 공유한 사람을 싣지 않아
   * 수만 읽는다).
   */
  private SharedFolderSummary summarizeSharedFolder(
      DriveSharedFolderRepository.ChainRow shared, String tokenHash) {
    return new SharedFolderSummary(
        sharedFolders.countChildren(shared.id()), links.findCreator(tokenHash).orElse(null));
  }

  /** 공유 폴더 요약 — 바로 아래 수와 링크를 만든 사람(찾을 수 없으면 null). 만든 사람 id 는 정보 응답의 공유받은 항목 기록 판정(WP-1540)이 쓴다. */
  private record SharedFolderSummary(
      DriveSharedFolderRepository.Counts counts, DriveShareLinkRepository.LinkCreator creator) {

    String sharedBy() {
      return creatorName(creator);
    }
  }

  /**
   * {@link #requireDescendantFolder} 의 판정 본체 — 통과한 사슬(공유 폴더 → 대상)을 돌려준다(경로로 그대로 쓴다). 폴더 링크에서만
   * 부른다(호출부가 종류 가드나 FOLDER 분기를 먼저 거친다).
   */
  private List<DriveSharedFolderRepository.ChainRow> descendantChain(
      DriveShareLinkRepository.ResolvedLink link, long folderId) {
    long root = link.driveFolderId();
    var chain = sharedFolders.chainToRoot(folderId, root);
    if (chain.isEmpty() || chain.get(0).id() != root) {
      throw new DriveShareLinkNotFoundException();
    }
    long spaceId = chain.get(0).spaceId();
    for (var row : chain) {
      if (row.trashed() || row.spaceId() != spaceId) {
        throw new DriveShareLinkNotFoundException();
      }
    }
    return chain;
  }

  /**
   * 메신저 봇 미리보기 카드 판정(WP-1473) — 열람 토큰·로그인을 보지 않는 익명 기준. 순서: 404(없음·비활성 테넌트) → 410(만료·폐기) → 사내 링크면
   * {@link DriveSharePreview.InternalOnly} → 비밀번호 링크면 {@link
   * DriveSharePreview.PasswordProtected}(열람 토큰이 없으니 잠긴 것으로 본다) → 파일 정보({@link
   * DriveSharePreview.Open}). 휴지통·없는 파일은 404. 잠긴 링크는 파일 정보를 읽지도 않아 이름·크기가 새지 않는다. 시도 칸을 쓰지 않는다.
   */
  public DriveSharePreview previewCard(String token) {
    var link = resolveActive(CapabilityTokens.sha256Hex(token));
    if ("INTERNAL".equals(link.audience())) {
      return new DriveSharePreview.InternalOnly(link.target());
    }
    if (link.passwordHash() != null) {
      return new DriveSharePreview.PasswordProtected(link.target());
    }
    // WP-1538: 폴더 링크 — 공유 폴더가 살아 있는지 확인(없음·휴지통이면 NotFound → 204)하고 항상 공유 폴더 기준으로 싣는다.
    if (link.target() == DriveShareTarget.FOLDER) {
      return TenantContext.callAs(
          link.tenantId(),
          () ->
              tx.execute(
                  st -> {
                    var shared = requireSharedFolder(link);
                    var counts = sharedFolders.countChildren(shared.id());
                    return new DriveSharePreview.FolderOpen(
                        shared.name(), counts.folderCount(), counts.fileCount(), link.expiresAt());
                  }));
    }
    // FORCE RLS 라 링크 워크스페이스 컨텍스트를 세워 트랜잭션 안에서 읽는다.
    return TenantContext.callAs(
        link.tenantId(),
        () ->
            tx.execute(
                st -> {
                  var f = loadFile(link);
                  return new DriveSharePreview.Open(
                      f.row().name(), f.meta().mimeType(), f.meta().sizeBytes(), link.expiresAt());
                }));
  }

  /**
   * 채팅 앱 카드 판정(WP-1474) — 로그인한 보는 사람 권한으로 그 순간 카드 칸을 정한다. 구성원이면 링크가 닫혔어도 카드를 보여야 해서 {@link
   * #resolveActive}(닫힌 링크를 곧장 410 으로 던진다)를 쓰지 않고 따로 본다.
   *
   * <p>순서: 없는 토큰·비활성 테넌트 → 410. 다른 워크스페이스(또는 테넌트 없음)면 파일을 읽기 전에 폐기·만료 → 410, 사내 링크 → 404(존재를 더 드러내지
   * 않는다). 그다음 링크 워크스페이스에서 {@link #judgeAppCard} 가 가른다. 410 은 공개 공유 경로와 같은 {@link
   * DriveShareLinkGoneException} 이라 본문에 파일 정보가 없다.
   *
   * <p>조회일 뿐이라 비밀번호 시도 칸을 쓰지 않고 감사도 남기지 않는다. 파일·공간은 링크 워크스페이스로 컨텍스트를 세워 트랜잭션 안에서 읽고(FORCE RLS),
   * {@link TenantContext#callAs} 가 끝나면 요청자 컨텍스트로 되돌린다.
   *
   * @param requesterTenantId 요청자 워크스페이스(없으면 null — 구성원 판정을 하지 않는다)
   * @throws DriveShareLinkGoneException 보는 사람이 열 수 없는 링크일 때(410)
   * @throws DriveShareLinkNotFoundException 다른 워크스페이스가 사내 링크를 볼 때(404)
   */
  public DriveShareAppCard appLinkCard(String token, Long requesterTenantId, long requesterUserId) {
    String tokenHash = CapabilityTokens.sha256Hex(token);
    var link =
        links
            .resolve(tokenHash)
            .filter(l -> tenantStatusChecker.isActive(l.tenantId()))
            .orElseThrow(DriveShareLinkGoneException::new);
    boolean sameWorkspace =
        requesterTenantId != null && requesterTenantId.longValue() == link.tenantId();
    // 다른 워크스페이스 요청자는 구성원일 수 없다 — 열 수 없는 링크면 링크 워크스페이스의 파일을 읽지 않고 끝낸다.
    if (!sameWorkspace) {
      if (isClosed(link)) throw new DriveShareLinkGoneException();
      if ("INTERNAL".equals(link.audience())) throw new DriveShareLinkNotFoundException();
    }
    return TenantContext.callAs(
        link.tenantId(),
        () -> tx.execute(st -> judgeAppCard(link, tokenHash, sameWorkspace, requesterUserId)));
  }

  /**
   * 앱 카드 판정의 파일 단계 — 링크 워크스페이스 컨텍스트와 트랜잭션 안에서 부른다. 파일 행과 메타를 먼저 한 번씩 읽고 거기서 가른다.
   *
   * <ul>
   *   <li>휴지통·없는 파일(메타 없음 포함) → 410(구성원에게도 드라이브에서 열 파일이 없고, 비밀번호 링크라도 열 수 없다 — 상태와 무관하게 같다)
   *   <li>같은 워크스페이스이고 공간 실효 역할이 있으면 → Member(만료·폐기·비밀번호·audience 와 무관). 판정은 {@code
   *       spaces.findForUser} — {@link #info} 의 「드라이브에서 열기」({@code spaceMembers.findRole})와 같은 실효
   *       역할 규칙(부서 역할 포함)이고 공간 이름도 함께 읽는다. 보관된 공간도 VIEWER 로 열람은 되므로(쓰기만 막힘, {@link
   *       DrivePermissions#requireRole}) Member 다.
   *   <li>폐기·만료 → 410. 비밀번호 링크 → PasswordProtected(이름·크기·종류를 싣지 않는다). 그 밖 → Open.
   * </ul>
   */
  private DriveShareAppCard judgeAppCard(
      DriveShareLinkRepository.ResolvedLink link,
      String tokenHash,
      boolean sameWorkspace,
      long requesterUserId) {
    // WP-1538: 폴더 링크는 별도 분기 — 판정 순서는 파일과 같다.
    if (link.target() == DriveShareTarget.FOLDER) {
      return judgeFolderAppCard(link, tokenHash, sameWorkspace, requesterUserId);
    }
    var row = files.findRow(link.driveFileId()).orElseThrow(DriveShareLinkGoneException::new);
    var meta = links.findFileMeta(row.fileId()).orElseThrow(DriveShareLinkGoneException::new);
    if (sameWorkspace) {
      var space = spaces.findForUser(row.spaceId(), requesterUserId);
      if (space.isPresent()) {
        return new DriveShareAppCard.Member(
            row.name(),
            meta.mimeType(),
            space.get().name(),
            row.spaceId(),
            row.folderId(),
            row.id());
      }
    }
    if (isClosed(link)) throw new DriveShareLinkGoneException();
    if (link.passwordHash() != null) {
      return new DriveShareAppCard.PasswordProtected(DriveShareTarget.FILE);
    }
    return new DriveShareAppCard.Open(
        row.name(), meta.mimeType(), meta.sizeBytes(), link.expiresAt());
  }

  /**
   * 앱 카드 판정의 폴더 단계(WP-1538) — 파일 단계({@link #judgeAppCard})와 같은 순서. 공유 폴더가 없거나 휴지통이면 410(P1,
   * 구성원·비밀번호와 무관). 같은 워크스페이스이고 공간 실효 역할이 있으면 FolderMember. 닫힘 410, 비밀번호 PasswordProtected(이름·수를 읽은
   * 값이라도 싣지 않는다), 그 밖 FolderOpen.
   */
  private DriveShareAppCard judgeFolderAppCard(
      DriveShareLinkRepository.ResolvedLink link,
      String tokenHash,
      boolean sameWorkspace,
      long requesterUserId) {
    DriveSharedFolderRepository.ChainRow shared;
    try {
      shared = requireSharedFolder(link);
    } catch (DriveShareLinkNotFoundException e) {
      // 카드에서는 열 수 없는 링크가 404 가 아니라 410 이다(파일 단계와 같은 규칙).
      throw new DriveShareLinkGoneException();
    }
    if (sameWorkspace) {
      var space = spaces.findForUser(shared.spaceId(), requesterUserId);
      if (space.isPresent()) {
        var summary = summarizeSharedFolder(shared, tokenHash);
        return new DriveShareAppCard.FolderMember(
            shared.name(),
            space.get().name(),
            shared.spaceId(),
            shared.id(),
            link.audience(),
            summary.counts().folderCount(),
            summary.counts().fileCount(),
            summary.sharedBy());
      }
    }
    if (isClosed(link)) throw new DriveShareLinkGoneException();
    if (link.passwordHash() != null) {
      return new DriveShareAppCard.PasswordProtected(DriveShareTarget.FOLDER);
    }
    // 410·비밀번호 분기는 이름·수가 필요 없어 그 뒤에서만 읽는다(잠긴 링크에 조회를 더하지 않는다).
    var summary = summarizeSharedFolder(shared, tokenHash);
    return new DriveShareAppCard.FolderOpen(
        shared.name(),
        link.audience(),
        summary.counts().folderCount(),
        summary.counts().fileCount(),
        summary.sharedBy(),
        link.expiresAt());
  }

  /** 링크가 닫혔는지 — 폐기됐거나 만료일이 지났다. 공개 경로 가드({@link #resolveActive})와 앱 카드 판정이 같은 기준을 쓴다. */
  private static boolean isClosed(DriveShareLinkRepository.ResolvedLink link) {
    return link.revokedAt() != null
        || (link.expiresAt() != null && link.expiresAt().isBefore(OffsetDateTime.now()));
  }

  /**
   * 링크 가드(시도 칸 없음) — 404(없음·비활성 테넌트) → 410(만료·폐기) → 사내 링크 로그인(401)·워크스페이스(403). 비밀번호는 보지 않는다(
   * {@link #verifyPassword} 또는 열람 토큰이 맡는다). 모든 공개 경로가 매 요청 이 가드를 거친다.
   */
  private GuardedLink guard(String token, Long requesterTenantId, boolean authenticated) {
    String tokenHash = CapabilityTokens.sha256Hex(token);
    var link = resolveActive(tokenHash);
    checkAudience(link, requesterTenantId, authenticated);
    return new GuardedLink(tokenHash, link);
  }

  /**
   * 종류가 정해진 경로의 링크 가드(WP-1538) — {@link #guard} 를 거친 뒤 링크 종류가 경로와 다르면 404(파일 경로의 폴더 링크, 폴더 경로의 파일
   * 링크). 파일·폴더 경로가 이 한 곳에서 종류를 가른다. 비밀번호 판정보다 <b>먼저</b> 불러야 한다 — 그래야 종류가 다른 링크로 시도 칸을 쓰지 않는다.
   */
  private GuardedLink guard(
      String token, Long requesterTenantId, boolean authenticated, DriveShareTarget expected) {
    GuardedLink g = guard(token, requesterTenantId, authenticated);
    if (g.link().target() != expected) {
      throw new DriveShareLinkNotFoundException();
    }
    return g;
  }

  /** 링크를 찾아 존재·테넌트 활성·만료·폐기를 본다(404 → 410). */
  private DriveShareLinkRepository.ResolvedLink resolveActive(String tokenHash) {
    var link =
        links
            .resolve(tokenHash)
            .orElseThrow(com.workplace.drive.exception.DriveShareLinkNotFoundException::new);
    // WP-341: 정지·삭제·영구 삭제 중인 테넌트의 링크는 "링크 없음"과 같은 404. 만료·비밀번호·잠금 가드보다 먼저 검사해야
    // 응답 코드(410/401/423)로 링크 존재가 드러나지 않고, 비활성 테넌트에 비밀번호 시도 카운터도 쌓이지 않는다.
    if (!tenantStatusChecker.isActive(link.tenantId())) {
      throw new com.workplace.drive.exception.DriveShareLinkNotFoundException();
    }

    if (isClosed(link)) {
      throw new DriveShareLinkGoneException();
    }
    return link;
  }

  /** 사내(INTERNAL) 링크 범위 — 비로그인 401, 다른 워크스페이스 403. 외부 링크는 통과. */
  private static void checkAudience(
      DriveShareLinkRepository.ResolvedLink link, Long requesterTenantId, boolean authenticated) {
    if ("INTERNAL".equals(link.audience())) {
      if (!authenticated || requesterTenantId == null) {
        throw new com.workplace.drive.exception.DriveShareLinkUnauthorizedException(
            "사내 공유 링크는 로그인이 필요합니다");
      }
      if (requesterTenantId.longValue() != link.tenantId()) {
        throw new com.workplace.drive.exception.DriveForbiddenException(0L, 0L);
      }
    }
  }

  /**
   * 이 요청이 아직 비밀번호 확인을 거쳐야 하는가 — 비밀번호 링크인데 쓸 수 있는 열람 토큰이 없을 때 true. 정보·미리보기·다운로드가 같은 판정을 쓴다.
   *
   * <p>열람 토큰은 이 링크·현재 비밀번호 해시로 발급돼 만료 전이어야 하고, 링크가 잠겨 있지 않아야 한다(WP-783 잠금이 걸리면 앞서 받은 토큰도 곧바로 막는다 —
   * 안 그러면 잠금 뒤에도 30분간 열린다). 잠금 확인은 시도 칸을 잡지 않는 읽기 전용이다. 서명이 맞는 토큰일 때만 DB 를 읽는다.
   */
  private boolean requiresPassword(GuardedLink g, String viewToken) {
    String passwordHash = g.link().passwordHash();
    if (passwordHash == null) return false;
    return !viewTokens.isValid(viewToken, g.tokenHash(), passwordHash)
        || attemptService.isBlocked(g.tokenHash());
  }

  /**
   * 비밀번호 검증(시도 칸 사용, WP-783). 비밀번호 없는 링크는 통과. 비교 전에 시도 한 칸을 잡고 — 잠겼으면(칸 없음) bcrypt 비교조차 하지 않고 429 —
   * 틀리면 401, 이번 실패로 잠금이 걸렸으면 링크 워크스페이스로 SHARE_LINK_LOCKED 감사를 남긴다.
   */
  private void verifyPassword(GuardedLink g, String password) {
    var link = g.link();
    String tokenHash = g.tokenHash();
    if (link.passwordHash() != null) {
      // 비교 전에 시도 한 칸을 잡는다(WP-783) — 잠겼으면(칸 없음) bcrypt 비교조차 하지 않는다.
      int attempt = attemptService.tryReserve(tokenHash);
      if (attempt == 0) {
        throw new com.workplace.drive.exception.DriveShareLinkLockedException(
            "비밀번호 시도 횟수를 초과했습니다. 잠시 후 다시 시도해 주세요");
      }
      if (password == null || !passwordEncoder.matches(password, link.passwordHash())) {
        // 잡은 칸이 곧 실패 기록이다.
        if (attemptService.reachedLimit(attempt)) {
          // 잠금이 이번 실패로 발동됨 — 이상 시도 추적을 위해 감사 로그 기록(#700). 익명 공개 경로라 워크스페이스 컨텍스트가 없어 그대로
          // 남기면 tenant_id 가 비어 링크 주인 워크스페이스 관리자에게 보이지 않았다 — 링크의 워크스페이스로 남긴다(WP-789).
          tx.executeWithoutResult(
              st ->
                  auditLogService.logInTenant(
                      link.tenantId(),
                      null,
                      "anonymous",
                      "SHARE_LINK_LOCKED",
                      "drive",
                      String.valueOf(
                          link.driveFileId() != null ? link.driveFileId() : link.driveFolderId()),
                      "공유 링크 비밀번호 잠금(브루트포스 방어)",
                      null,
                      null,
                      "BLOCKED",
                      null,
                      Map.of("tenantId", link.tenantId(), "target", link.target().name())));
        }
        throw new com.workplace.drive.exception.DriveShareLinkUnauthorizedException(
            "비밀번호가 필요하거나 올바르지 않습니다");
      }
      attemptService.attemptSucceeded(tokenHash);
    }
  }

  /**
   * 링크의 파일 행·형식/크기를 읽는다(휴지통·없는 파일은 404). 호출부가 링크 워크스페이스 컨텍스트와 트랜잭션 안에서 불러야 한다(FORCE RLS) — info 와
   * previewCard 가 같은 읽기를 공유한다. 파일 링크에서만 부른다(두 호출부가 폴더 링크를 먼저 갈라 보낸다).
   */
  private LoadedFile loadFile(DriveShareLinkRepository.ResolvedLink link) {
    DriveFileRepository.DriveFileRow row =
        files.findRow(link.driveFileId()).orElseThrow(DriveShareLinkNotFoundException::new);
    var meta = links.findFileMeta(row.fileId()).orElseThrow(DriveShareLinkNotFoundException::new);
    return new LoadedFile(row, meta);
  }

  private record LoadedFile(
      DriveFileRepository.DriveFileRow row, DriveShareLinkRepository.FileMeta meta) {}

  /** 가드를 통과한 링크(토큰 해시 + resolve 결과). */
  private record GuardedLink(String tokenHash, DriveShareLinkRepository.ResolvedLink link) {
    /** 파일 경로의 다운로드 대상 — 종류 가드(FILE)를 거친 링크에서만 부른다(파일 링크는 driveFileId 가 늘 있다). */
    ResolvedTarget target() {
      return new ResolvedTarget(link.tenantId(), link.driveFileId());
    }
  }

  /** resolve 결과(다운로드 대상). */
  public record ResolvedTarget(long tenantId, long driveFileId) {}

  /**
   * 감사 로그용 사용자명 조회. 없으면 userId 문자열로 대체(#81).
   *
   * <p>AuthService 와 동일하게 UserRepository.findById 를 통해 username 을 얻는다.
   */
  private String usernameOf(long userId) {
    return userRepository
        .findById(userId)
        .map(com.workplace.user.dto.UserResponse::username)
        .orElse(String.valueOf(userId));
  }
}
