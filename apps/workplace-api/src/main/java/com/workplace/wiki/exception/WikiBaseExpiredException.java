package com.workplace.wiki.exception;

/**
 * 본문 저장의 기준본(읽은 판)을 쓸 수 없음 — 409(WP-289, 스펙 §5.1-1). 기준 없이 병합하면 무엇을 바꿨는지 몰라 실시간 문서를 통째로 덮게 되므로
 * 거절하고, 호출자(MCP·채팅 비서)가 다시 읽고 재시도하도록 안내한다. 사유별 문구는 정적 생성자가 정한다(현재보다 새 판·기록 없음·만료).
 */
public class WikiBaseExpiredException extends WikiConflictException {
  private static final String RE_READ =
      " get_wiki_page 로 페이지를 다시 읽고 최신 본문에 수정을 반영해 다시 저장하세요: page=";

  private WikiBaseExpiredException(String message) {
    super(message);
  }

  /** 요청 version 이 현재 판보다 새롭다 — 존재하지 않는 판(잘못 적은 version). */
  public static WikiBaseExpiredException newerThanCurrent(long pageId, int version, int current) {
    return new WikiBaseExpiredException(
        "version "
            + version
            + " 은 현재 판(version "
            + current
            + ")보다 새로운, 없는 판입니다."
            + RE_READ
            + pageId);
  }

  /** 요청 version 의 기준본 기록이 없다 — 이 API 로 읽은 적이 없거나 보관 기간이 지나 정리됐다. */
  public static WikiBaseExpiredException notFound(long pageId, int version) {
    return new WikiBaseExpiredException(
        "읽은 판(version " + version + ")의 기준본을 찾을 수 없습니다." + RE_READ + pageId);
  }

  /** 기준본 기록은 있지만 읽은 지 1시간이 지나 만료됐다. */
  public static WikiBaseExpiredException expired(long pageId, int version) {
    return new WikiBaseExpiredException(
        "읽은 판(version " + version + ")의 기준본이 만료됐습니다(읽은 지 1시간 초과)." + RE_READ + pageId);
  }
}
