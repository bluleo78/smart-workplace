package com.workplace.notify.push;

/**
 * 발송 단위(수신자 무관 공통 내용). JSON 으로 직렬화되어 암호화된다 — 프론트 서비스워커가 이 필드로 알림을 표시하고 url 로 이동한다.
 *
 * @param urgency Web Push Urgency 헤더(high|normal)
 * @param tag 같은 tag 알림은 교체(채널·이슈·일정 단위로 한 줄 유지)
 */
public record PushMessage(
    long tenantId,
    PushCategory category,
    String title,
    String body,
    String url,
    String tag,
    String urgency,
    int ttlSeconds) {

  /** 미리보기 가림(workplace.push.preview=false) — 이동 정보는 유지하고 제목·본문만 고정 문구로. */
  public PushMessage redacted() {
    boolean message = category == PushCategory.DM || category == PushCategory.MENTION;
    return new PushMessage(
        tenantId,
        category,
        message ? "새 메시지" : "새 알림",
        message ? "새 메시지가 있습니다" : "새 알림이 있습니다",
        url,
        tag,
        urgency,
        ttlSeconds);
  }

  /** 코드포인트 기준 max 자로 자르고 말줄임표. null 은 빈 문자열. */
  public static String truncate(String s, int max) {
    if (s == null) return "";
    if (s.codePointCount(0, s.length()) <= max) return s;
    return s.substring(0, s.offsetByCodePoints(0, max)) + "…";
  }
}
