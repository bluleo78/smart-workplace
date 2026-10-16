package com.workplace.mail.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.filepreview.repository.PreviewStateStore.Row;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import org.junit.jupiter.api.Test;
import org.springframework.test.context.TestPropertySource;

/**
 * 첨부 캐시 상한을 넘는 메일 첨부의 미리보기(WP-432) — 캐시하지 않는 첨부는 {@code download} 가 해시를 채우지 않으므로, 미리보기가 첫 열람에서 채워야
 * 이후 폴링이 원본을 다시 받지 않는다.
 *
 * <p>상한을 1KB 로 낮춘 별도 컨텍스트 — 나머지 테스트({@link MailAttachmentPreviewTest})는 기본 25MB 로 캐시 복호화 경로를 탄다.
 */
@TestPropertySource(
    properties = {
      "workplace.storage.mail.max-cache-bytes=1024",
      // 원본 크기 상한도 낮춘다 — 받은 실제 바이트가 넘는 경우(작업이 TOO_LARGE 로 기록)를 재현한다.
      "workplace.converter.max-bytes=4096"
    })
class MailAttachmentPreviewLargeTest extends MailAttachmentPreviewTestSupport {

  @Test
  void 캐시_상한을_넘는_첨부도_해시를_채우고_한_번만_변환한다() throws Exception {
    byte[] payload = largePayload();
    long att = attachmentOfA("큰문서.hwp", HWP, payload.length, payload);
    String hash = MailAttachmentService.sha256Hex(payload);
    assertThat(contentHashOf(att)).isNull();

    preview(att, true, userA).andExpect(status().isAccepted());

    assertThat(contentHashOf(att)).isEqualTo(hash);
    assertThat(blobRowCount(hash)).isZero();
    awaitStatus(hash, "READY");
    // 해시 채우기 1회 + 선점한 변환 작업 1회 — 캐시가 없으니 둘 다 provider 에서 받는다.
    long fetches = providerFetches();
    assertThat(fetches).isEqualTo(2);

    for (int i = 0; i < 3; i++) {
      preview(att, null, userA)
          .andExpect(status().isOk())
          .andExpect(content().bytes(pdfBytes(payload)));
    }
    verify(converter, times(1)).convertPdf(any(), anyString());
    assertThat(providerFetches()).isEqualTo(fetches);
    assertThat(blobRowCount(hash)).isZero();
    // 해시 채우기(요청 스레드)·변환 작업(실행기) 모두 provider 를 부르는 동안 트랜잭션(DB 연결)을 잡지 않았다.
    assertThat(txActiveDuringFetch).hasSize(2).containsOnly(false);
  }

  @Test
  void 받은_원본이_상한을_넘으면_작업이_TOO_LARGE_영구_실패로_기록한다() throws Exception {
    // manifest 크기(100)는 상한 안이라 받기 전 판정을 통과하지만, 실제 바이트(5000)가 상한(4096)을 넘는다.
    byte[] payload = Arrays.copyOf(uniquePayload("actual-large"), 5000);
    long att = attachmentOfA("큰문서.hwp", HWP, 100L, payload);
    String hash = MailAttachmentService.sha256Hex(payload);

    preview(att, true, userA).andExpect(status().isAccepted());
    awaitStatus(hash, "FAILED");

    Row r = row(hash);
    assertThat(r.failureCode()).isEqualTo("TOO_LARGE");
    assertThat(r.failureTransient()).isFalse();
    preview(att, null, userA)
        .andExpect(status().isUnprocessableEntity())
        .andExpect(jsonPath("$.code").value("TOO_LARGE"))
        .andExpect(jsonPath("$.transient").value(false));
    verify(converter, never()).convertPdf(any(), anyString());
  }

  /** 캐시 상한(1KB)을 넘는 고유 바이트. */
  private static byte[] largePayload() {
    byte[] head = uniquePayload("large");
    byte[] out = Arrays.copyOf(head, 2048);
    Arrays.fill(out, head.length, out.length, "B".getBytes(StandardCharsets.UTF_8)[0]);
    return out;
  }
}
