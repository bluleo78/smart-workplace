package com.workplace.wiki.dto;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * 외부(비로그인) 공유 보기 응답(WP-579) — 웹 {@code WikiPublicShare} 와 같은 모양. 사람(작성자·수정자·공유한 사람)·스페이스·사용자 id 는
 * 싣지 않는다.
 *
 * @param workspaceName 링크가 속한 워크스페이스 표시 이름
 * @param rootPageId 공유한 페이지
 * @param pages 링크로 볼 수 있는 페이지(하위 포함이면 지금 서브트리, 아니면 루트 하나). 루트의 parentId 는 범위 밖이라 null
 * @param page 지금 보는 페이지 — 본문은 서버가 가린 마크다운
 */
public record WikiPublicShareResponse(
    String workspaceName, long rootPageId, List<PublicPage> pages, PublicPageBody page) {

  /** 트리 한 줄 — 범위 안 페이지만. */
  public record PublicPage(long id, Long parentId, String title, int position) {}

  /** 보는 페이지 — markdown 은 멘션·내부 링크를 가리고 이미지를 공개 첨부 주소로 바꾼 본문. */
  public record PublicPageBody(long id, String title, String markdown, OffsetDateTime updatedAt) {}
}
