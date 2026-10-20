package com.workplace.mail.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.mail.dto.OutgoingMail;
import com.workplace.mail.dto.OutgoingMail.AttachmentPart;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Graph 경로 분기(WP-574) — 전체 MIME 을 직렬화하기 전에 크기 추정만으로 초안 경로를 고르는지. 큰 첨부 메일을 sendMail 용으로 base64 두 번
 * 감싸 메모리에 올리지 않게 하는 판정이다.
 */
class GraphDraftPathDecisionTest {

  private static OutgoingMail mail(String body, List<AttachmentPart> attachments) {
    return new OutgoingMail(
        "m@x",
        "t@x",
        "me@x.com",
        "나",
        List.of("a@x.com"),
        List.of(),
        List.of(),
        "s",
        body,
        "<p>" + body + "</p>",
        null,
        null,
        null,
        Instant.now(),
        List.of(),
        attachments);
  }

  private static AttachmentPart file(int size) {
    return new AttachmentPart("f.bin", "application/octet-stream", new byte[size]);
  }

  @Test
  void smallAttachment_staysOnSendMail() {
    assertThat(needsDraftPath(mail("본문", List.of(file(500 * 1024))))).isFalse();
  }

  /** 원본 2MB 도 두 번 base64 로 약 3.7MB — 여유를 둔 상한(3.5M)을 넘어 초안 경로. */
  @Test
  void twoMegabyteAttachment_goesToDraftPath() {
    assertThat(needsDraftPath(mail("본문", List.of(file(2 * 1024 * 1024))))).isTrue();
  }

  @Test
  void twentyFiveMegabytes_goesToDraftPath() {
    assertThat(needsDraftPath(mail("본문", List.of(file(20 * 1024 * 1024), file(5 * 1024 * 1024)))))
        .isTrue();
  }

  /** 첨부 없이 본문만 큰 메일은 나눌 것이 없어 sendMail 그대로. */
  @Test
  void noAttachments_neverDraftPath() {
    assertThat(needsDraftPath(mail("가".repeat(2_000_000), List.of()))).isFalse();
  }

  /** 추정은 실제 직렬화 길이보다 작지 않아야 한다(작게 추정하면 큰 메일을 통째로 직렬화한다). */
  @Test
  void estimate_isNotBelowActualSerializedLength() throws Exception {
    OutgoingMail m = mail("한글 본문 ".repeat(1000), List.of(file(300_000), file(123_457)));
    var account =
        new com.workplace.mail.dto.EmailAccountResponse(
            1L,
            "me@x.com",
            "나",
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            false,
            null,
            com.workplace.mail.dto.MailProvider.M365_GRAPH);
    var out = new java.io.ByteArrayOutputStream();
    new MailMimeBuilder().build(account, m).writeTo(out);
    long actualBase64 = (out.size() + 2L) / 3 * 4;
    assertThat(GraphMailTransport.estimateBase64Length(m)).isGreaterThanOrEqualTo(actualBase64);
  }

  /** 판정은 transmit 이 한 번 계산한 추정값을 받는다 — 테스트도 같은 추정으로 부른다. */
  private static boolean needsDraftPath(OutgoingMail m) {
    return GraphMailTransport.needsDraftPath(m, GraphMailTransport.estimateBase64Length(m));
  }

  /** UTF-8 길이를 할당 없이 센다 — 한글(3)·ASCII(1)·서로게이트 쌍 이모지(4)가 getBytes 와 같아야 한다. */
  @Test
  void utf8Length_matchesGetBytes() {
    String s = "aé한😀z";
    assertThat(GraphMailTransport.utf8Length(s))
        .isEqualTo(s.getBytes(java.nio.charset.StandardCharsets.UTF_8).length);
  }
}
