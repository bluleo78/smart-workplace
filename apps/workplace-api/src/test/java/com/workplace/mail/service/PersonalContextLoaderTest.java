package com.workplace.mail.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.mail.outbound.MailAiMessages.PriorMail;
import com.workplace.mail.repository.PersonalContextRepository.AttachmentRow;
import com.workplace.mail.repository.PersonalContextRepository.PriorMailRow;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** WP-150 보강 입력 가공 — 이전 메일 500자 발췌·보낸 사람 표기, 첨부 이름(인라인 이미지 제외·상한). */
class PersonalContextLoaderTest {

  @Test
  void excerpt_cutsAt500WithEllipsis() {
    String body = "가".repeat(600);

    String out = PersonalContextLoader.excerpt(body);

    assertThat(out).hasSize(501).endsWith("…").startsWith("가".repeat(500));
    assertThat(PersonalContextLoader.excerpt("  짧음 \n")).isEqualTo("짧음");
    assertThat(PersonalContextLoader.excerpt(null)).isEmpty();
  }

  @Test
  void priorMails_marksFromMe_usesNewPart_andSkipsEmpty() {
    OffsetDateTime t = OffsetDateTime.parse("2026-09-30T02:00:00Z");
    List<PriorMailRow> rows =
        List.of(
            new PriorMailRow(
                "Minsu@Acme.com",
                "김민수",
                t,
                "운영 날짜는요?\n\n-----Original Message-----\n이전 내용",
                null,
                null),
            new PriorMailRow("GD@acme.com", null, null, "확인했습니다", null, null),
            new PriorMailRow("x@y.com", null, t, null, null, null));

    List<PriorMail> out = PersonalContextLoader.priorMails(rows, Set.of("gd@acme.com"));

    assertThat(out)
        .containsExactly(
            new PriorMail(false, "김민수 <Minsu@Acme.com>", t.toString(), "운영 날짜는요?"),
            new PriorMail(true, "GD@acme.com", "", "확인했습니다"));
  }

  @Test
  void attachmentNames_skipsInlineImages_capsCountAndLength() {
    List<AttachmentRow> rows = new ArrayList<>();
    rows.add(new AttachmentRow("image001.png", "image/png", "img001@x")); // 인라인 — 제외
    rows.add(new AttachmentRow("사진.jpg", "image/jpeg", null)); // Content-ID 없는 이미지는 첨부
    rows.add(new AttachmentRow(" ", "application/pdf", null)); // 이름 없음 — 제외
    rows.add(new AttachmentRow("가".repeat(150) + ".pdf", "application/pdf", null));
    for (int i = 0; i < 20; i++) {
      rows.add(new AttachmentRow("f" + i + ".txt", "text/plain", null));
    }

    List<String> names = PersonalContextLoader.attachmentNames(rows);

    assertThat(names).hasSize(PersonalContextLoader.ATTACHMENT_LIMIT);
    assertThat(names.get(0)).isEqualTo("사진.jpg");
    assertThat(names.get(1)).hasSize(PersonalContextLoader.ATTACHMENT_NAME_MAX + 1).endsWith("…");
    assertThat(names).doesNotContain("image001.png");
  }

  @Test
  void cuts_doNotSplitSurrogatePair() {
    // 코드 포인트 기준으로 센다 — 500번째 자리의 이모지(서로게이트 쌍)가 반쪽으로 잘리지 않고 통째로 남는다
    String body = "가".repeat(499) + "😀" + "나".repeat(10);
    assertThat(PersonalContextLoader.excerpt(body)).isEqualTo("가".repeat(499) + "😀…");

    String name = "a".repeat(99) + "😀.pdf";
    List<String> names =
        PersonalContextLoader.attachmentNames(
            List.of(new AttachmentRow(name, "application/pdf", null)));
    assertThat(names).containsExactly("a".repeat(99) + "😀…");
  }
}
