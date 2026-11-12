package com.workplace.home.controller;

import com.workplace.calendar.service.CalendarEventService;
import com.workplace.drive.exception.DriveShareLinkNotFoundException;
import com.workplace.drive.service.DriveFileService;
import com.workplace.drive.service.DriveFolderService;
import com.workplace.drive.service.DriveShareAppCard;
import com.workplace.drive.service.DriveShareLinkService;
import com.workplace.drive.service.DriveSharePreviewMeta;
import com.workplace.drive.service.DriveSpaceService;
import com.workplace.global.security.RequirePermission;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.util.CapabilityTokens;
import com.workplace.global.util.PublicAppHost;
import com.workplace.home.dto.AppLinkCard;
import com.workplace.home.dto.AppLinkConfig;
import com.workplace.issue.service.IssueService;
import com.workplace.mail.service.MailMessageService;
import com.workplace.messaging.service.MessageService;
import com.workplace.wiki.service.WikiPageService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 채팅 본문의 우리 앱 링크 카드(WP-896). 웹이 링크 경로에서 종류·id 를 읽어 부르고, 서버는 그 화면을 열 때와 같은 서비스(같은 권한 판정)로 카드 칸만 골라
 * 돌려준다. 볼 수 없거나 없는 대상은 그 서비스의 오류(404·403)가 그대로 나가고 웹은 카드를 그리지 않는다 — 제목 등 정보는 새지 않는다.
 *
 * <p>여러 도메인을 모아 읽는 화면 집계라 home 모듈에 둔다(홈 대시보드와 같은 자리). 컨트롤러에서 서비스를 각각 부른다 — 각 서비스의 읽기 트랜잭션이 테넌트 GUC
 * 를 따로 세운다(self-invocation 금지 규칙).
 */
@RestController
@RequestMapping("/api/v1/app-links")
public class AppLinkController {
  private final IssueService issueService;
  private final WikiPageService pageService;
  private final DriveFileService driveFileService;
  private final DriveFolderService driveFolderService;
  private final DriveSpaceService driveSpaceService;
  private final MessageService messageService;
  private final CalendarEventService calendarEventService;
  private final MailMessageService mailMessageService;
  private final DriveShareLinkService driveShareLinkService;
  // 공개 웹 주소의 호스트 — 서버 OG 제외와 같은 값(PublicAppHost). 설정이 비었거나 잘못됐으면 null.
  private final String appHost;

  public AppLinkController(
      IssueService issueService,
      WikiPageService pageService,
      DriveFileService driveFileService,
      DriveFolderService driveFolderService,
      DriveSpaceService driveSpaceService,
      MessageService messageService,
      CalendarEventService calendarEventService,
      MailMessageService mailMessageService,
      DriveShareLinkService driveShareLinkService,
      @Value("${workplace.public-base-url:}") String publicBaseUrl) {
    this.issueService = issueService;
    this.pageService = pageService;
    this.driveFileService = driveFileService;
    this.driveFolderService = driveFolderService;
    this.driveSpaceService = driveSpaceService;
    this.messageService = messageService;
    this.calendarEventService = calendarEventService;
    this.mailMessageService = mailMessageService;
    this.driveShareLinkService = driveShareLinkService;
    this.appHost = PublicAppHost.of(publicBaseUrl);
  }

  /**
   * 앱 링크 판정 설정(WP-1165) — 웹은 지금 접속한 호스트와 이 공개 호스트를 모두 우리 앱 주소로 본다. 내부 주소로 접속해도 공개 주소 링크가 카드로
   * 나오게(서버는 그 링크의 OG 미리보기를 빼므로, 웹이 모르면 아무것도 나오지 않는다). 로그인한 사용자만 읽는다(공개 엔드포인트 아님).
   */
  @GetMapping("/config")
  public AppLinkConfig config() {
    return new AppLinkConfig(appHost);
  }

  /** 이슈 링크(/projects/{key}/issues/{number}) — 이슈 상세와 같은 읽기 권한(전역 권한 project:read + 프로젝트 읽기 가드). */
  @GetMapping("/issues/{key}/{number}")
  @RequirePermission("project:read")
  public AppLinkCard issue(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("key") String key,
      @PathVariable("number") int number) {
    var c = issueService.card(callerId, key, number);
    return AppLinkCard.issue(
        c.projectKey() + "-" + c.number(),
        c.title(),
        c.statusName(),
        c.status(),
        c.assignees(),
        c.priority());
  }

  /** 노트 링크(/wiki/spaces/{spaceId}/pages/{id}·/wiki/open/{id}) — 노트를 열 때와 같은 VIEWER 판정. */
  @GetMapping("/pages/{id}")
  public AppLinkCard page(@AuthenticationPrincipal Long callerId, @PathVariable("id") long pageId) {
    var page = pageService.linkCard(callerId, pageId);
    return AppLinkCard.page(page.title(), page.spaceName());
  }

  /** 드라이브 파일 링크(/drive/spaces/{spaceId}?file={id}) — 파일 보기와 같은 VIEWER 판정. */
  @GetMapping("/files/{id}")
  public AppLinkCard file(@AuthenticationPrincipal Long callerId, @PathVariable("id") long fileId) {
    return AppLinkCard.file(driveFileService.viewableFileName(callerId, fileId));
  }

  /**
   * 드라이브 폴더 링크(/drive/spaces/{spaceId}?folderId={id}, WP-1536) — 폴더 목록을 열 때와 같은 VIEWER 판정. 링크의
   * 공간(spaceId)을 함께 받아, 없거나 휴지통에 있거나 볼 수 없거나 그 공간에 없는(링크를 눌러도 열리지 않는) 폴더는 모두 같은 404(폴더·공간 이름이 새지
   * 않는다).
   */
  @GetMapping("/folders/{id}")
  public AppLinkCard folder(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long folderId,
      @RequestParam("spaceId") long spaceId) {
    var f = driveFolderService.linkCard(callerId, spaceId, folderId);
    return AppLinkCard.folder(f.name(), f.spaceName());
  }

  /**
   * 드라이브 공간 링크(/drive/spaces/{id} — 파일·미리보기·폴더 쿼리가 없는 공간 첫 화면, WP-1536) — 공간을 열 때와 같은 VIEWER 판정. 없는
   * 공간과 볼 수 없는 공간은 같은 404.
   */
  @GetMapping("/drive-spaces/{id}")
  public AppLinkCard driveSpace(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long spaceId) {
    return AppLinkCard.driveSpace(driveSpaceService.getSpace(callerId, spaceId).name());
  }

  /**
   * 채널·DM 메시지 링크(/chat/channels/{c}?message={id}·/chat/dms/{c}?message={id}, WP-1236) — 스레드 조회와 같은
   * 읽기 판정(멤버·보관된 공개 채널). 없거나 읽을 수 없거나 삭제된 메시지는 같은 404.
   */
  @GetMapping("/messages/{id}")
  public AppLinkCard message(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long messageId) {
    var c = messageService.linkCard(callerId, messageId);
    return AppLinkCard.message(
        c.preview(), c.channelName(), c.channelKind(), c.authorName(), c.sentAt());
  }

  /**
   * 일정 링크(/calendar?eventId={id}, WP-1236) — 일정 상세와 같은 판정: 전역 권한 calendar:read(일정 API 와 같다 — 카드로
   * 우회하지 못하게) + 주최자이거나 참석자. 그 밖에는 없는 일정과 같은 404.
   */
  @GetMapping("/events/{id}")
  @RequirePermission("calendar:read")
  public AppLinkCard event(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long eventId) {
    var e = calendarEventService.getHeader(callerId, eventId);
    return AppLinkCard.event(
        e.title(), e.startsAt().toInstant(), e.endsAt().toInstant(), e.allDay());
  }

  /**
   * 메일 링크(/mail/{accountId}?messageId={id}, WP-1236) — 메일 상세와 같은 판정(그 메일 계정의 주인만). 본문을 IMAP 에서 가져오지
   * 않고 저장된 머리(제목·보낸 사람·날짜)만 읽는다.
   */
  @GetMapping("/mails/{id}")
  public AppLinkCard mail(@AuthenticationPrincipal Long callerId, @PathVariable("id") long mailId) {
    var m = mailMessageService.linkCard(callerId, mailId);
    // 제목 없는 메일은 다른 화면(우선순위 알림 등)과 같은 「(제목 없음)」, 표시 이름이 없으면 주소로 보낸 사람을 보인다.
    String subject = m.subject() == null || m.subject().isBlank() ? "(제목 없음)" : m.subject();
    String from = m.fromName() == null || m.fromName().isBlank() ? m.fromAddress() : m.fromName();
    return AppLinkCard.mail(subject, from, m.sentAt());
  }

  /**
   * 드라이브 공유 링크(/s/{token}, WP-1474) — 보는 사람 권한으로 고른 카드. 파일 공간 구성원이면 링크 상태와 무관하게 드라이브의 파일(MEMBER),
   * 아니면 링크로 열 수 있는지에 따라 OPEN·PASSWORD. PASSWORD 는 파일 정보 없이 고정 제목만 싣는다. 열 수 없는 링크(없는 토큰·비활성
   * 워크스페이스·폐기·만료·휴지통/없는 파일)는 410(본문에 파일 정보 없음), 다른 워크스페이스의 사내 링크와 토큰 문법 밖의 값은 404(문법은 서비스를 부르기 전에
   * 거른다). 조회일 뿐이라 비밀번호 시도 칸을 쓰지 않는다.
   */
  @GetMapping("/shares/{token}")
  public AppLinkCard share(
      @AuthenticationPrincipal Long callerId, @PathVariable("token") String token) {
    if (!CapabilityTokens.SHARE_LINK_TOKEN.matcher(token).matches()) {
      throw new DriveShareLinkNotFoundException();
    }
    return switch (driveShareLinkService.appLinkCard(token, TenantContext.get(), callerId)) {
      case DriveShareAppCard.Member m ->
          AppLinkCard.shareMember(
              m.name(), m.mimeType(), m.spaceName(), m.spaceId(), m.folderId(), m.fileId());
      case DriveShareAppCard.Open o ->
          AppLinkCard.shareOpen(
              o.name(),
              o.mimeType(),
              // 메신저 미리보기 카드와 같은 종류 이름(WP-1473)
              DriveSharePreviewMeta.typeLabel(o.name(), o.mimeType()),
              o.sizeBytes(),
              o.expiresAt() == null ? null : o.expiresAt().toInstant());
      case DriveShareAppCard.PasswordProtected p -> AppLinkCard.sharePassword();
    };
  }
}
