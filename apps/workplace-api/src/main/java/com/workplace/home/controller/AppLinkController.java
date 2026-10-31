package com.workplace.home.controller;

import com.workplace.calendar.service.CalendarEventService;
import com.workplace.drive.service.DriveFileService;
import com.workplace.global.security.RequirePermission;
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
  private final MessageService messageService;
  private final CalendarEventService calendarEventService;
  private final MailMessageService mailMessageService;
  // 공개 웹 주소의 호스트 — 서버 OG 제외와 같은 값(PublicAppHost). 설정이 비었거나 잘못됐으면 null.
  private final String appHost;

  public AppLinkController(
      IssueService issueService,
      WikiPageService pageService,
      DriveFileService driveFileService,
      MessageService messageService,
      CalendarEventService calendarEventService,
      MailMessageService mailMessageService,
      @Value("${workplace.public-base-url:}") String publicBaseUrl) {
    this.issueService = issueService;
    this.pageService = pageService;
    this.driveFileService = driveFileService;
    this.messageService = messageService;
    this.calendarEventService = calendarEventService;
    this.mailMessageService = mailMessageService;
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
}
