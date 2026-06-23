package com.workplace.mail.util;

/**
 * 메일 본문을 LLM 입력용 평문으로 정규화하는 공용 유틸.
 *
 * <p>요약·답장 초안 모두 이 헬퍼를 거쳐 본문을 추출한다 — 과거 요약 경로에만 HTML 폴백이 있고 답장 초안 스레드 조회는 BODY_TEXT 만 읽어, HTML 전용
 * 메일(예: 발신전용 알림)에서 본문이 비어 AI 가 "본문이 없다"며 답장을 거부하던 비대칭을 일원화하기 위함이다.
 */
public final class MailBodyText {

  private MailBodyText() {}

  /**
   * 평문 본문 우선, 없으면(null 또는 공백) HTML 을 평문으로 변환해 반환. 둘 다 없으면 빈 문자열.
   *
   * @param text BODY_TEXT (없을 수 있음)
   * @param html BODY_HTML (없을 수 있음)
   */
  public static String effectiveBody(String text, String html) {
    if (text != null && !text.isBlank()) {
      return text;
    }
    return stripHtml(html);
  }

  /**
   * 아주 단순한 HTML→평문 변환. {@code <style>}·{@code <script>} 블록은 내용까지 제거(CSS/JS 잡음이 본문으로 새지 않게) 후 나머지
   * 태그를 제거하고 공백을 정규화한다.
   */
  public static String stripHtml(String html) {
    if (html == null) {
      return "";
    }
    return html.replaceAll("(?is)<style[^>]*>.*?</style>", " ")
        .replaceAll("(?is)<script[^>]*>.*?</script>", " ")
        .replaceAll("<[^>]+>", " ")
        .replaceAll("\\s+", " ")
        .trim();
  }
}
