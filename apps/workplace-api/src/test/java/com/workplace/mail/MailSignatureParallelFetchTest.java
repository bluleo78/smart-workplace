package com.workplace.mail;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.workplace.file.service.StagedUploadService;
import com.workplace.mail.dto.MailSignatureResponse;
import com.workplace.mail.dto.MailSignatureUpdateRequest;
import com.workplace.mail.repository.MailSignatureRepository;
import com.workplace.mail.repository.MailSignatureRepository.SignatureRow;
import com.workplace.mail.service.MailSignatureHtmlSanitizer;
import com.workplace.mail.service.MailSignatureImageStore;
import com.workplace.mail.service.MailSignatureImageStore.ImageBytes;
import com.workplace.mail.service.MailSignatureService;
import java.time.OffsetDateTime;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.PlatformTransactionManager;

/**
 * 메일 서명 저장(WP-1517)의 이미지 받기가 나란히 도는지 — 외부 이미지를 순서대로 받으면 저장이 장수만큼 길어진다.
 *
 * <p>가짜 받기는 「다른 받기 하나가 동시에 시작될 때까지」 기다린다. 순서대로 받으면 첫 받기가 기다리다 시간이 다 돼 실패(빈 값)하므로, 두 장 모두 남는 것이 곧
 * 나란히 받았다는 뜻이다. 결과가 후보 순서대로 경로가 되는지도 본다.
 */
class MailSignatureParallelFetchTest {

  private final ExecutorService executor = Executors.newFixedThreadPool(4);

  @AfterEach
  void shutdown() {
    executor.shutdownNow();
  }

  @Test
  void 외부_이미지는_나란히_받고_순서는_지킨다() {
    MailSignatureRepository repository = mock(MailSignatureRepository.class);
    MailSignatureImageStore imageStore = mock(MailSignatureImageStore.class);
    when(repository.findImagesById(anyLong(), anyCollection())).thenReturn(Map.of());
    when(repository.upsert(anyLong(), anyString(), anyBoolean(), anyBoolean()))
        .thenAnswer(inv -> new SignatureRow(inv.getArgument(1), true, false, OffsetDateTime.now()));
    CountDownLatch bothStarted = new CountDownLatch(2);
    when(imageStore.load(anyString()))
        .thenAnswer(
            inv -> {
              bothStarted.countDown();
              // 다른 받기가 동시에 시작돼야 풀린다 — 순서대로면 2초 뒤 실패(빈 값).
              if (!bothStarted.await(2, TimeUnit.SECONDS)) return Optional.empty();
              String src = inv.getArgument(0);
              return Optional.of(new ImageBytes("image/png", src.getBytes()));
            });
    // 저장 id 는 저장 호출 순서 — 받은 바이트(= src) 로 어느 이미지인지 남겨 순서를 확인한다.
    AtomicLong nextId = new AtomicLong(100);
    when(imageStore.save(anyLong(), any()))
        .thenAnswer(
            inv -> {
              ImageBytes b = inv.getArgument(1);
              long base = new String(b.bytes()).endsWith("a.png") ? 0 : 1;
              nextId.incrementAndGet();
              return 100 + base;
            });
    MailSignatureService service =
        new MailSignatureService(
            repository,
            new MailSignatureHtmlSanitizer(),
            imageStore,
            mock(StagedUploadService.class),
            mock(PlatformTransactionManager.class),
            executor);

    MailSignatureResponse res =
        service.update(
            1L,
            new MailSignatureUpdateRequest(
                "<p><img src=\"https://x.test/a.png\"><img src=\"https://x.test/b.png\"></p>",
                true,
                false));

    assertThat(res.droppedImageCount()).isZero();
    assertThat(res.html())
        .isEqualTo(
            "<p><img src=\"/api/v1/mail/signature/images/100\">"
                + "<img src=\"/api/v1/mail/signature/images/101\"></p>");
    assertThat(nextId.get()).isEqualTo(102);
  }
}
