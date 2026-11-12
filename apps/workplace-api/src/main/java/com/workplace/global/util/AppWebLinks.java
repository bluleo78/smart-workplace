package com.workplace.global.util;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * 웹 화면 주소(WP-1523) — 이슈·노트·드라이브 파일·일정 화면의 경로 모양을 서버의 한 곳에 둔다.
 *
 * <p>정적 메서드는 상대 경로(알림 이동·우선순위 항목·첨부 출처 딥링크·채팅 결과 링크가 쓴다)를, 인스턴스 메서드는 공개 웹 주소를 앞에 붙인 절대 주소(도구 응답의
 * {@code url})를 만든다. 경로 모양은 웹 {@code appUrl.ts}(issuePath·wikiSpacePagePath·calendarEventPath)와
 * {@code driveOpen.ts}(driveFilePath)와 같아야 하고 웹 {@code appLinks.ts} 가 앱 링크로 읽는다 — 웹 라우트를 바꾸면 여기만 함께
 * 바꾼다. 기준 주소는 {@code workplace.public-base-url}(운영 WEB_BASE_URL, 공유·전송 링크와 같은 값)이고, 비어 있으면 절대 주소
 * 메서드는 null 을 돌려준다 — 상대 경로를 내보내면 AI 가 호스트를 지어 붙인다.
 */
@Component
public class AppWebLinks {

  /** 끝 슬래시를 지운 공개 웹 주소. 비었으면 빈 문자열. */
  private final String base;

  public AppWebLinks(@Value("${workplace.public-base-url:}") String publicBaseUrl) {
    this.base = CapabilityTokens.normalizeBaseUrl(publicBaseUrl);
  }

  /**
   * 이슈 상세 경로 — /projects/{KEY}/issues/{n}. 프로젝트 키는 [A-Z][A-Z0-9]* 로 검증된 값이라 인코딩하지 않는다 — 이 메서드로 옮긴
   * 기존 딥링크(알림· 우선순위·첨부 출처)와 글자가 같아야 한다(원본 이슈가 지워진 알림의 null 도 예전처럼 그대로 이어 붙는다).
   */
  public static String issuePath(String projectKey, Integer number) {
    return "/projects/" + projectKey + "/issues/" + number;
  }

  /** 노트 페이지 경로 — /wiki/spaces/{spaceId}/pages/{pageId}. */
  public static String wikiPagePath(long spaceId, long pageId) {
    return "/wiki/spaces/" + spaceId + "/pages/" + pageId;
  }

  /**
   * 드라이브 파일 경로 — 웹 driveFilePath 와 같다: /drive/spaces/{spaceId}?folderId={folderId}&preview={id}(최상위
   * 파일은 folderId 없이). 드라이브 화면은 미리볼 파일을 「지금 폴더」 목록에서만 찾으므로 하위 폴더 파일은 폴더가 있어야 열린다.
   */
  public static String driveFilePath(long spaceId, Long folderId, long driveFileId) {
    String folder = folderId == null ? "" : "folderId=" + folderId + "&";
    return "/drive/spaces/" + spaceId + "?" + folder + "preview=" + driveFileId;
  }

  /** 일정 경로 — /calendar?eventId={id}(캘린더가 일정 대화상자를 연다). */
  public static String calendarEventPath(long eventId) {
    return "/calendar?eventId=" + eventId;
  }

  /** 이슈 상세 절대 주소. 키가 없거나 기준 주소가 비면 null. */
  public String issue(String projectKey, int number) {
    if (projectKey == null || projectKey.isBlank()) return null;
    return absolute(issuePath(projectKey, number));
  }

  /** 노트 페이지 절대 주소. */
  public String wikiPage(long spaceId, long pageId) {
    return absolute(wikiPagePath(spaceId, pageId));
  }

  /** 드라이브 파일 절대 주소(folderId 는 최상위면 null). */
  public String driveFile(long spaceId, Long folderId, long driveFileId) {
    return absolute(driveFilePath(spaceId, folderId, driveFileId));
  }

  /** 일정 절대 주소. */
  public String calendarEvent(long eventId) {
    return absolute(calendarEventPath(eventId));
  }

  // 기준 주소가 없으면 null — JSON 에서 빠져(@JsonInclude NON_NULL) AI 가 상대 경로를 받지 않는다.
  private String absolute(String path) {
    return base.isEmpty() ? null : base + path;
  }
}
