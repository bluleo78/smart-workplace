package com.workplace.mail.util;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** WP-149 새로 쓴 부분 추출 — 한/영 Outlook·Gmail 인용, 서명, HTML 인용 블록, 앞+뒤 절단. */
class NewContentExtractorTest {

  private static String text(String body) {
    return NewContentExtractor.extract(body, null, null);
  }

  private static String html(String body) {
    return NewContentExtractor.extract(null, body, null);
  }

  @Test
  void outlookOriginalMessage_cut() {
    assertThat(text("확인 부탁드립니다.\n\n-----Original Message-----\nFrom: a@b.com\n이전 본문"))
        .isEqualTo("확인 부탁드립니다.");
  }

  @Test
  void outlookKoreanOriginalMessage_cut() {
    assertThat(text("네.\n----- 원본 메시지 -----\n이전")).isEqualTo("네.");
  }

  @Test
  void outlookKoreanHeaderBlock_cut() {
    String body =
        "네 확인했습니다.\n\n보낸 사람: 김민수 <minsu@acme.com>\n보낸 날짜: 2026년 9월 30일 화요일 오전 9:00\n"
            + "받는 사람: 홍길동 <gd@acme.com>\n제목: 배포 일정\n\n이전 본문";
    assertThat(text(body)).isEqualTo("네 확인했습니다.");
  }

  @Test
  void englishHeaderBlock_cut() {
    String body =
        "Thanks\n\nFrom: Kim <k@a.com>\nSent: Monday, September 30, 2026\nTo: Hong\nSubject: Deploy\n\nold";
    assertThat(text(body)).isEqualTo("Thanks");
  }

  @Test
  void singleFromLine_isNotAHeaderBlock() {
    String body = "From: our team, welcome aboard!\n좋은 하루 되세요";
    assertThat(text(body)).isEqualTo(body);
  }

  @Test
  void gmailOnWrote_singleLine_cut() {
    assertThat(text("Sounds good.\n\nOn Mon, Sep 30, 2026 at 9:00 AM Kim <k@a.com> wrote:\n> old"))
        .isEqualTo("Sounds good.");
  }

  @Test
  void gmailOnWrote_wrappedLine_cut() {
    assertThat(text("OK\n\nOn Mon, Sep 30, 2026 at 9:00 AM Kim <k@a.com>\nwrote:\n\nold"))
        .isEqualTo("OK");
  }

  @Test
  void gmailKoreanWrote_cut() {
    assertThat(text("좋습니다.\n\n2026년 9월 30일 (화) 오전 9:00, 김민수 <minsu@acme.com>님이 작성:\n> 이전"))
        .isEqualTo("좋습니다.");
  }

  @Test
  void greaterThanQuote_cut() {
    assertThat(text("좋아요\n> 원문 1\n> 원문 2")).isEqualTo("좋아요");
  }

  @Test
  void signatureDelimiter_cut() {
    assertThat(text("본문입니다\n-- \n홍길동 팀장\n010-0000-0000")).isEqualTo("본문입니다");
  }

  @Test
  void crlf_isNormalized() {
    assertThat(text("본문\r\n> 인용")).isEqualTo("본문");
  }

  @Test
  void html_gmailQuote_cut_andLineBreaksKept() {
    String body =
        "<div dir=\"ltr\">답장 본문<br>둘째 줄</div><div class=\"gmail_quote\"><div>On Mon wrote:</div>"
            + "<blockquote>old</blockquote></div>";
    assertThat(html(body)).isEqualTo("답장 본문\n둘째 줄");
  }

  @Test
  void html_divRplyFwdMsg_cut() {
    String body =
        "<p>확인했습니다</p><hr style=\"display:inline-block\"><div id=\"divRplyFwdMsg\" dir=\"ltr\">"
            + "<b>From:</b> Kim<br><b>Sent:</b> Monday</div><div>old</div>";
    assertThat(html(body)).isEqualTo("확인했습니다");
  }

  @Test
  void html_outlookHeaderBlock_cut() {
    String body =
        "<p>네</p><p><b>From:</b> Kim<br><b>Sent:</b> Monday<br><b>To:</b> Hong</p><p>old</p>";
    assertThat(html(body)).isEqualTo("네");
  }

  @Test
  void html_entitiesAndStyle_cleaned() {
    String body = "<style>p{color:red}</style><p>회의&nbsp;일정 &amp; 장소</p>";
    assertThat(html(body)).isEqualTo("회의 일정 & 장소");
  }

  @Test
  void everythingQuoted_fallsBackToOriginal() {
    assertThat(text("> 전부 인용\n> 둘째")).isEqualTo("> 전부 인용\n> 둘째");
  }

  @Test
  void emptyBody_fallsBackToSnippet() {
    assertThat(NewContentExtractor.extract(null, null, " 미리보기 ")).isEqualTo("미리보기");
    assertThat(NewContentExtractor.extract("  ", "", null)).isEmpty();
  }

  @Test
  void longBody_keepsHeadAndTail() {
    String body = "A".repeat(1500) + "B".repeat(2000) + "C".repeat(1000);
    String out = text(body);
    assertThat(out).hasSize(1500 + 1 + 1000);
    assertThat(out).startsWith("A".repeat(1500) + "…");
    assertThat(out).endsWith("C".repeat(1000));
  }

  @Test
  void bodyAtLimit_isUntouched() {
    String body = "가".repeat(NewContentExtractor.MAX_CHARS);
    assertThat(text(body)).isEqualTo(body);
  }
}
