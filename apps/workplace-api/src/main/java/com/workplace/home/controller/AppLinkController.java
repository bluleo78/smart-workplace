package com.workplace.home.controller;

import com.workplace.drive.service.DriveFileService;
import com.workplace.home.dto.AppLinkCard;
import com.workplace.issue.service.IssueService;
import com.workplace.wiki.service.WikiPageService;
import lombok.RequiredArgsConstructor;
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
@RequiredArgsConstructor
public class AppLinkController {
  private final IssueService issueService;
  private final WikiPageService pageService;
  private final DriveFileService driveFileService;

  /** 이슈 링크(/projects/{key}/issues/{number}) — 이슈 상세와 같은 읽기 권한. */
  @GetMapping("/issues/{key}/{number}")
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
}
