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

  /** 미리보기 가림(workplace.push.preview=false) — 이동 정보는 유지하고 표시 내용만 고정 문구로. */
  public PushMessage redacted() {
    return switch (category) {
      // 메일(WP-1739): 본문만 「새 메일」 로 고정 — 제목(보낸 사람)·url·tag·urgency·ttl 은 유지.
      case MAIL ->
          new PushMessage(tenantId, category, title, "새 메일", url, tag, urgency, ttlSeconds);
      case DM, MENTION ->
          new PushMessage(
              tenantId, category, "새 메시지", "새 메시지가 있습니다", url, tag, urgency, ttlSeconds);
      case ISSUE, CALENDAR ->
          new PushMessage(tenantId, category, "새 알림", "새 알림이 있습니다", url, tag, urgency, ttlSeconds);
    };
  }
}
