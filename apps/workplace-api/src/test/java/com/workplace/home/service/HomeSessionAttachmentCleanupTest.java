package com.workplace.home.service;

import static com.workplace.jooq.Tables.FILE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.home.HomeAttachmentTestSupport;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** WP-234: 세션 삭제 → 그 세션 첨부만 만료 처리(FileCleanupService 가 치울 대상), 연결 행 CASCADE, 남의 세션 404. */
class HomeSessionAttachmentCleanupTest extends HomeAttachmentTestSupport {

  @Test
  void 세션을_지우면_그_세션_첨부만_정리_대상이_된다() throws Exception {
    long uid = user();
    UUID s1 = sessionService.create(uid).id();
    UUID s2 = sessionService.create(uid).id();
    long a = upload(uid, "a.pdf", "application/pdf", "%PDF".getBytes());
    long b = upload(uid, "b.pdf", "application/pdf", "%PDF".getBytes());
    attachmentService.appendUserMessage(uid, s1, "하나", List.of(a));
    attachmentService.appendUserMessage(uid, s2, "둘", List.of(b));

    http(delete("/api/v1/home/sessions/{id}", s1).header("Authorization", bearer(uid)))
        .andExpect(status().isNoContent());

    assertThat(messageIdOf(a)).isNull();
    assertThat(expiresAtOf(a)).isNotNull().isBeforeOrEqualTo(OffsetDateTime.now());
    // FileCleanupService 와 같은 기준(EXPIRES_AT < now UTC)으로 정리 대상에 든다.
    assertThat(
            inTx(
                () ->
                    dsl.fetchExists(
                        FILE,
                        FILE.ID.eq(a).and(FILE.EXPIRES_AT.lt(OffsetDateTime.now(ZoneOffset.UTC))))))
        .isTrue();
    assertThat(messageIdOf(b)).isNotNull();
    assertThat(expiresAtOf(b)).isNull();
  }

  @Test
  void 남의_세션_삭제는_404_이고_파일은_그대로다() throws Exception {
    long owner = user();
    long stranger = user();
    UUID sid = sessionService.create(owner).id();
    long a = upload(owner, "a.pdf", "application/pdf", "%PDF".getBytes());
    attachmentService.appendUserMessage(owner, sid, "하나", List.of(a));

    http(delete("/api/v1/home/sessions/{id}", sid).header("Authorization", bearer(stranger)))
        .andExpect(status().isNotFound());

    assertThat(messageIdOf(a)).isNotNull();
    assertThat(expiresAtOf(a)).isNull();
  }
}
