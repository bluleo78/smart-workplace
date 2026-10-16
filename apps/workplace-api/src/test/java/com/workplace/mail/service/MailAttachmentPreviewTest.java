package com.workplace.mail.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.not;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.filepreview.outbound.ConvertOutcome;
import com.workplace.filepreview.repository.PreviewStateStore.Row;
import com.workplace.mail.repository.MailPreviewKey;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.test.web.servlet.MvcResult;

/**
 * 메일 첨부 문서 미리보기 엔드포인트(WP-432) 통합 테스트 — {@code GET /mail/attachments/{id}/preview} 가 드라이브와 같은
 * 200/202/422/404 계약으로, 첫 열람에만 변환하고 폴링은 provider 에 닿지 않는지 종단으로 본다.
 *
 * <p>첨부 캐시 상한은 기본(25MB) — 해시를 채운 뒤 변환 작업은 캐시에서 복호화해 원본을 받는다. 상한을 넘는 첨부는 {@link
 * MailAttachmentPreviewLargeTest}.
 */
class MailAttachmentPreviewTest extends MailAttachmentPreviewTestSupport {

  private static final String PDF_MIME = "application/pdf";

  /** 변환 목을 막아 두는 래치 — 막힌 작업이 다음 테스트의 대화형 실행기를 잡지 않게 정리에서 푼다. */
  private final CountDownLatch release = new CountDownLatch(1);

  @AfterEach
  void releaseBlockedConversions() {
    release.countDown();
  }

  @Test
  void 처음_열면_202_이고_변환되면_PDF_200() throws Exception {
    byte[] payload = uniquePayload("보고서");
    long att = attachmentOfA("보고서.hwp", HWP, 100L, payload);
    String hash = MailAttachmentService.sha256Hex(payload);

    preview(att, true, userA)
        .andExpect(status().isAccepted())
        .andExpect(jsonPath("$.status").value("CONVERTING"));
    awaitStatus(hash, "READY");

    byte[] expected = pdfBytes(payload);
    preview(att, null, userA)
        .andExpect(status().isOk())
        .andExpect(header().string("Content-Type", PDF_MIME))
        .andExpect(header().longValue("Content-Length", expected.length))
        .andExpect(header().string("Cache-Control", "private, no-cache"))
        .andExpect(content().bytes(expected));
  }

  @Test
  void PDF_200_은_ETag_와_Last_Modified_를_달고_같은_ETag_면_304() throws Exception {
    byte[] payload = uniquePayload("etag");
    long att = attachmentOfA("발표.pptx", pptx(), 100L, payload);
    String hash = MailAttachmentService.sha256Hex(payload);
    preview(att, true, userA).andExpect(status().isAccepted());
    awaitStatus(hash, "READY");

    MvcResult first =
        preview(att, null, userA)
            .andExpect(status().isOk())
            .andExpect(header().exists(HttpHeaders.ETAG))
            .andExpect(header().exists(HttpHeaders.LAST_MODIFIED))
            .andReturn();
    String etag = first.getResponse().getHeader(HttpHeaders.ETAG);
    assertThat(etag).startsWith("\"" + hash + "-");

    // 304 는 복호화하지 않는다 — 판정은 파일 속성(크기·수정 시각)만 보고, 본문은 읽을 때에야 복호화한다.
    clearInvocations(blobStore);
    mvc.perform(
            get("/api/v1/mail/attachments/" + att + "/preview")
                .header("Authorization", bearer(userA))
                .header(HttpHeaders.IF_NONE_MATCH, etag))
        .andExpect(status().isNotModified());
    verify(blobStore, never()).loadPreview(any());
    // 같은 결과면 ETag 가 그대로다(복호화 없이 만든 값).
    preview(att, null, userA).andExpect(header().string(HttpHeaders.ETAG, etag));
  }

  @Test
  void 저장된_변환본은_암호화돼_있다() throws Exception {
    byte[] payload = uniquePayload("암호화");
    long att = attachmentOfA("a.hwp", HWP, 100L, payload);
    String hash = MailAttachmentService.sha256Hex(payload);
    preview(att, true, userA).andExpect(status().isAccepted());
    awaitStatus(hash, "READY");

    byte[] raw = Files.readAllBytes(previewFile(hash));
    assertThat(new String(raw, 0, 4)).isNotEqualTo("%PDF");
    // 평문 PDF 조각(원본 내용)도 들어 있지 않다.
    assertThat(indexOf(raw, payload)).isEqualTo(-1);
    assertThat(blobStore.loadPreview(new MailPreviewKey(tid, hash))).hasValue(pdfBytes(payload));
  }

  @Test
  void content_hash_가_없으면_첫_열람에서_채운다() throws Exception {
    byte[] payload = uniquePayload("해시");
    long att = attachmentOfA("a.hwp", HWP, 100L, payload);
    assertThat(contentHashOf(att)).isNull();

    preview(att, true, userA).andExpect(status().isAccepted());

    String hash = MailAttachmentService.sha256Hex(payload);
    assertThat(contentHashOf(att)).isEqualTo(hash);
    awaitStatus(hash, "READY");
  }

  @Test
  void 폴링은_원본을_받지_않는다() throws Exception {
    CountDownLatch entered = new CountDownLatch(1);
    onConvert(
        inv -> {
          Path src = recordSource(inv.getArgument(0));
          entered.countDown();
          release.await(10, TimeUnit.SECONDS);
          return new ConvertOutcome.Success(pdfOf(src), 1);
        });
    byte[] payload = uniquePayload("폴링");
    long att = attachmentOfA("a.hwp", HWP, 100L, payload);
    String hash = MailAttachmentService.sha256Hex(payload);

    preview(att, true, userA).andExpect(status().isAccepted());
    // 변환 작업이 원본을 받고 변환 호출에 들어갈 때까지 기다린 뒤 센다 — 작업의 받기가 폴링 집계에 섞이지 않게.
    assertThat(entered.await(5, TimeUnit.SECONDS)).isTrue();
    long fetches = providerFetches();
    long downloads = downloadCalls();
    // 해시 채우기에서 IMAP 1회(캐시 저장) — 변환 작업은 캐시에서 받는다.
    assertThat(fetches).isEqualTo(1);

    for (int i = 0; i < 3; i++) {
      preview(att, null, userA)
          .andExpect(status().isAccepted())
          .andExpect(jsonPath("$.status").value("CONVERTING"));
    }
    assertThat(providerFetches()).isEqualTo(fetches);
    assertThat(downloadCalls()).isEqualTo(downloads);

    release.countDown();
    awaitStatus(hash, "READY");
    preview(att, null, userA).andExpect(status().isOk());
    assertThat(providerFetches()).isEqualTo(fetches);
    assertThat(downloadCalls()).isEqualTo(downloads);
  }

  @Test
  void 같은_첨부는_메일이_달라도_한_번만_변환한다() throws Exception {
    byte[] payload = uniquePayload("공유");
    long attA = attachmentOfA("공유.hwp", HWP, 100L, payload);
    long attB = attachmentOfB("공유.hwp", HWP, 100L, payload);
    String hash = MailAttachmentService.sha256Hex(payload);

    preview(attA, true, userA).andExpect(status().isAccepted());
    int statusB = preview(attB, true, userB).andReturn().getResponse().getStatus();
    assertThat(statusB).isIn(200, 202);
    awaitStatus(hash, "READY");

    byte[] expected = pdfBytes(payload);
    preview(attA, null, userA).andExpect(status().isOk()).andExpect(content().bytes(expected));
    preview(attB, null, userB).andExpect(status().isOk()).andExpect(content().bytes(expected));
    verify(converter, times(1)).convertPdf(any(), anyString());
    assertThat(previewRowCount(hash)).isEqualTo(1);
  }

  @Test
  void 남의_첨부는_404_이고_변환하지_않는다() throws Exception {
    long att = attachmentOfA("a.hwp", HWP, 100L, uniquePayload("남의것"));

    preview(att, true, userB)
        .andExpect(status().isNotFound())
        // NOT_APPLICABLE 404 와 구분된다 — 존재 은닉 404 는 예외 봉투다.
        .andExpect(jsonPath("$.status").value(not("NOT_APPLICABLE")));

    verify(converter, never()).convertPdf(any(), anyString());
    assertThat(downloadCalls()).isZero();
    assertThat(providerFetches()).isZero();
  }

  @Test
  void 영구_실패면_422_transient_false() throws Exception {
    onConvert(
        inv -> {
          recordSource(inv.getArgument(0));
          return new ConvertOutcome.Failure("CONVERT_FAILED", false);
        });
    byte[] payload = uniquePayload("영구");
    long att = attachmentOfA("a.doc", "application/msword", 100L, payload);
    String hash = MailAttachmentService.sha256Hex(payload);

    preview(att, true, userA).andExpect(status().isAccepted());
    awaitStatus(hash, "FAILED");

    preview(att, null, userA)
        .andExpect(status().isUnprocessableEntity())
        .andExpect(jsonPath("$.status").value("FAILED"))
        .andExpect(jsonPath("$.code").value("CONVERT_FAILED"))
        .andExpect(jsonPath("$.transient").value(false));
  }

  @Test
  void 일시_실패면_폴링은_422_transient_true_이고_start_면_다시_선점() throws Exception {
    onConvert(
        inv -> {
          recordSource(inv.getArgument(0));
          return new ConvertOutcome.Failure("BUSY", true);
        });
    byte[] payload = uniquePayload("일시");
    long att = attachmentOfA("a.hwp", HWP, 100L, payload);
    String hash = MailAttachmentService.sha256Hex(payload);
    preview(att, true, userA).andExpect(status().isAccepted());
    awaitStatus(hash, "FAILED");

    preview(att, null, userA)
        .andExpect(status().isUnprocessableEntity())
        .andExpect(jsonPath("$.code").value("BUSY"))
        .andExpect(jsonPath("$.transient").value(true));

    onConvert(inv -> new ConvertOutcome.Success(pdfOf(recordSource(inv.getArgument(0))), 1));
    preview(att, true, userA).andExpect(status().isAccepted());
    // 다시 선점한 작업이 끝난 뒤 정리한다(작업이 정리 뒤에 행·파일을 다시 만들지 않게).
    awaitStatus(hash, "READY");
  }

  @Test
  void 원본을_받지_못하면_일시_실패로_기록된다() throws Exception {
    // 해시는 이전 다운로드가 채웠지만 캐시 blob 은 없다 — 변환 작업이 provider 에서 받다가 실패한다.
    long att = attachmentOfA("a.hwp", HWP, 100L, null);
    String hash = MailAttachmentService.sha256Hex(uniquePayload("유실"));
    presetContentHash(att, hash);

    preview(att, true, userA).andExpect(status().isAccepted());
    awaitStatus(hash, "FAILED");

    Row r = row(hash);
    assertThat(r.failureCode()).isEqualTo("UNAVAILABLE");
    assertThat(r.failureTransient()).isTrue();
    verify(converter, never()).convertPdf(any(), anyString());
  }

  @Test
  void 내_메일이_provider_에서_사라지면_나만_영구_실패이고_같은_바이트의_다른_메일은_변환된다() throws Exception {
    // 해시는 이전 다운로드가 채웠지만 캐시 blob 은 없다 — 변환 작업이 provider 에서 받는다. A 의 메일만 provider 에서 지워졌다.
    byte[] payload = uniquePayload("사라짐");
    long attA = attachmentOfA("a.hwp", HWP, 100L, payload);
    long attB = attachmentOfB("a.hwp", HWP, 100L, payload);
    String hash = MailAttachmentService.sha256Hex(payload);
    presetContentHash(attA, hash);
    presetContentHash(attB, hash);
    dropFromProvider(attA);

    preview(attA, true, userA).andExpect(status().isAccepted());
    awaitStatusCode(attA, userA, 422);
    preview(attA, null, userA)
        .andExpect(jsonPath("$.code").value("SOURCE_MISSING"))
        .andExpect(jsonPath("$.transient").value(false));
    // 공유 (tenant, hash) 행에는 실패를 쓰지 않는다 — 선점만 반납(PENDING, 시도 횟수 미소모).
    Row r = row(hash);
    assertThat(r.status()).isEqualTo("PENDING");
    assertThat(r.attempts()).isZero();
    verify(converter, never()).convertPdf(any(), anyString());

    // 같은 바이트의 B 메일은 남아 있어 정상 변환·표시된다.
    preview(attB, true, userB).andExpect(status().isAccepted());
    awaitStatus(hash, "READY");
    preview(attB, null, userB)
        .andExpect(status().isOk())
        .andExpect(content().bytes(pdfBytes(payload)));
    // A 에게는 [다시 시도]여도 요청자 한정 영구 실패가 이어진다.
    preview(attA, true, userA)
        .andExpect(status().isUnprocessableEntity())
        .andExpect(jsonPath("$.code").value("SOURCE_MISSING"));
  }

  @Test
  void 변환본이_손상되면_그_응답은_실패하고_다음_열람이_다시_변환한다() throws Exception {
    byte[] payload = uniquePayload("손상");
    long att = attachmentOfA("a.hwp", HWP, 100L, payload);
    String hash = MailAttachmentService.sha256Hex(payload);
    preview(att, true, userA).andExpect(status().isAccepted());
    awaitStatus(hash, "READY");

    // 암호화 파일이 손상됐다(GCM 태그 불일치) — 판정은 복호화하지 않아 READY 로 보고, 본문을 쓸 때 실패한다.
    Files.write(previewFile(hash), new byte[64]);
    int failedStatus;
    try {
      failedStatus = preview(att, null, userA).andReturn().getResponse().getStatus();
    } catch (Exception e) {
      failedStatus = 500; // 응답 쓰기 중 IOException 이 그대로 올라온 경우
    }
    assertThat(failedStatus).isGreaterThanOrEqualTo(500);
    // 실패한 응답이 행을 되돌렸다 — 다음 열람은 다시 변환한다.
    assertThat(row(hash).status()).isEqualTo("PENDING");

    preview(att, null, userA).andExpect(status().isAccepted());
    awaitStatus(hash, "READY");
    preview(att, null, userA)
        .andExpect(status().isOk())
        .andExpect(content().bytes(pdfBytes(payload)));
    verify(converter, times(2)).convertPdf(any(), anyString());
  }

  /** 비동기 작업 뒤 폴링 응답 코드가 목표에 이를 때까지 기다린다(상한 5초·50ms 간격). */
  private void awaitStatusCode(long att, long asUser, int expected) throws Exception {
    long deadline = System.currentTimeMillis() + 5_000;
    int last = -1;
    while (System.currentTimeMillis() < deadline) {
      last = preview(att, null, asUser).andReturn().getResponse().getStatus();
      if (last == expected) {
        return;
      }
      sleep(50);
    }
    throw new AssertionError("응답 " + expected + " 를 기다리다 시간 초과 — 마지막: " + last);
  }

  @Test
  void 같은_해시가_READY_면_추정_크기가_넘어도_200() throws Exception {
    // B 의 사본(manifest 크기 정상)이 먼저 변환됐다.
    byte[] payload = uniquePayload("추정-READY");
    long attB = attachmentOfB("공유.hwp", HWP, 100L, payload);
    String hash = MailAttachmentService.sha256Hex(payload);
    preview(attB, true, userB).andExpect(status().isAccepted());
    awaitStatus(hash, "READY");

    // A 의 사본은 같은 바이트지만 manifest 크기(base64 추정)가 상한을 넘는다 — 행 상태가 먼저라 READY 를 그대로 준다.
    long attA = attachmentOfA("공유.hwp", HWP, 200L * 1024 * 1024, payload);
    presetContentHash(attA, hash);
    preview(attA, true, userA)
        .andExpect(status().isOk())
        .andExpect(content().bytes(pdfBytes(payload)));
    assertThat(row(hash).status()).isEqualTo("READY");
    verify(converter, times(1)).convertPdf(any(), anyString());
  }

  @Test
  void 추정_크기_초과는_422_이고_행을_쓰지_않는다() throws Exception {
    byte[] payload = uniquePayload("추정-초과");
    long att = attachmentOfA("huge.hwp", HWP, 200L * 1024 * 1024, payload);
    String hash = MailAttachmentService.sha256Hex(payload);
    presetContentHash(att, hash);

    preview(att, true, userA)
        .andExpect(status().isUnprocessableEntity())
        .andExpect(jsonPath("$.code").value("TOO_LARGE"))
        .andExpect(jsonPath("$.transient").value(false));
    // 추정만으로는 공유 (tenant, hash) 행을 굳히지 않는다 — 같은 바이트의 다른 사본이 정상 변환될 수 있게.
    assertThat(previewRowCount(hash)).isZero();
    assertThat(downloadCalls()).isZero();
  }

  @Test
  void 임시_원본_파일을_남기지_않는다() throws Exception {
    // 성공 1건
    byte[] okPayload = uniquePayload("임시-성공");
    long ok = attachmentOfA("a.hwp", HWP, 100L, okPayload);
    String okHash = MailAttachmentService.sha256Hex(okPayload);
    preview(ok, true, userA).andExpect(status().isAccepted());
    awaitStatus(okHash, "READY");
    assertThat(convertedSources).hasSize(1);
    Path okSource = convertedSources.get(0);
    assertThat(okSource.getFileName().toString()).startsWith("mail-preview-src-");
    assertThat(sourceContents.get(okSource)).isEqualTo(okPayload);
    if (sourcePermissions.containsKey(okSource)) {
      assertThat(sourcePermissions.get(okSource)).isEqualTo("rw-------");
    }
    // 엔진이 상태를 기록하기 전에 원본을 정리하므로 상태 대기만으로 충분하다.
    assertThat(Files.exists(okSource)).isFalse();

    // 실패 1건
    onConvert(
        inv -> {
          recordSource(inv.getArgument(0));
          return new ConvertOutcome.Failure("CONVERT_FAILED", false);
        });
    byte[] failPayload = uniquePayload("임시-실패");
    long fail = attachmentOfA("b.hwp", HWP, 100L, failPayload);
    String failHash = MailAttachmentService.sha256Hex(failPayload);
    preview(fail, true, userA).andExpect(status().isAccepted());
    awaitStatus(failHash, "FAILED");
    assertThat(convertedSources).hasSize(2);
    assertThat(Files.exists(convertedSources.get(1))).isFalse();
  }

  @Test
  void 변환본이_사라지면_다시_변환한다() throws Exception {
    byte[] payload = uniquePayload("유실-재변환");
    long att = attachmentOfA("a.hwp", HWP, 100L, payload);
    String hash = MailAttachmentService.sha256Hex(payload);
    preview(att, true, userA).andExpect(status().isAccepted());
    awaitStatus(hash, "READY");
    long fetches = providerFetches();

    // READY 인데 결과 파일이 없다(볼륨 이전·수동 정리) — 500 이 아니라 다시 변환한다.
    Files.delete(previewFile(hash));
    preview(att, null, userA).andExpect(status().isAccepted());
    awaitStatus(hash, "READY");

    preview(att, null, userA)
        .andExpect(status().isOk())
        .andExpect(content().bytes(pdfBytes(payload)));
    verify(converter, times(2)).convertPdf(any(), anyString());
    // 재변환도 캐시에서 받는다 — provider 는 다시 부르지 않는다.
    assertThat(providerFetches()).isEqualTo(fetches);
  }

  @Test
  void 대상_형식이_아니면_404() throws Exception {
    long att = attachmentOfA("spec.pdf", PDF_MIME, 100L, uniquePayload("pdf"));

    preview(att, true, userA)
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.status").value("NOT_APPLICABLE"));
    assertThat(downloadCalls()).isZero();
  }

  @Test
  void 레거시_첨부는_404() throws Exception {
    long att = legacyAttachmentOfA(uniquePayload("legacy"));

    preview(att, true, userA)
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.status").value("NOT_APPLICABLE"));
    assertThat(downloadCalls()).isZero();
  }

  @Test
  void 과대_첨부는_받지_않고_TOO_LARGE() throws Exception {
    // IMAP manifest 크기(base64 기준) — 상한 100MB 의 4/3 여유를 넘는다.
    long att = attachmentOfA("huge.hwp", HWP, 200L * 1024 * 1024, uniquePayload("huge"));

    preview(att, true, userA)
        .andExpect(status().isUnprocessableEntity())
        .andExpect(jsonPath("$.code").value("TOO_LARGE"))
        .andExpect(jsonPath("$.transient").value(false));
    assertThat(downloadCalls()).isZero();
    assertThat(providerFetches()).isZero();
    verify(converter, never()).convertPdf(any(), anyString());
  }

  private static String pptx() {
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  }

  /** haystack 안 needle 의 위치(없으면 -1). */
  private static int indexOf(byte[] haystack, byte[] needle) {
    outer:
    for (int i = 0; i + needle.length <= haystack.length; i++) {
      for (int j = 0; j < needle.length; j++) {
        if (haystack[i + j] != needle[j]) {
          continue outer;
        }
      }
      return i;
    }
    return -1;
  }
}
