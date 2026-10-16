package com.workplace.filepreview.service;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.FILE_PREVIEW;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.file.storage.FileStore;
import com.workplace.filepreview.PreviewTypes;
import com.workplace.filepreview.outbound.ConvertOutcome;
import com.workplace.filepreview.outbound.ConverterClient;
import com.workplace.filepreview.outbound.ConverterProperties;
import com.workplace.filepreview.repository.FilePreviewRepository;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.PreviewAwait;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Supplier;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 문서 미리보기 서비스(WP-431) 통합 테스트 — 형식 판정·선점·대화형/백그라운드 실행기·결과 기록·재시도 규칙.
 *
 * <p>변환은 실행기 스레드에서 돌므로 클래스 레벨 {@code @Transactional} 없이 기본 테넌트(1)가 아닌 fixture 테넌트에 커밋한다 — 테스트 DB 세션
 * 기본 GUC=1 이 비동기 경로의 테넌트 GUC 누락을 가리지 않게(WP-417). 정리는 {@code @AfterEach} 에서 자기 id 만.
 */
@TestPropertySource(properties = "workplace.converter.enabled=true")
class FilePreviewServiceTest extends IntegrationTestBase {

  private static final String FIXTURE_TENANT_SLUG = "file-preview-svc-fixture-tenant";
  private static final byte[] PDF = "%PDF-1.7 fake".getBytes(StandardCharsets.UTF_8);
  private static final String HWP = "application/x-hwp";

  @Autowired DSLContext dsl;
  @Autowired FilePreviewService service;
  @Autowired FilePreviewRepository repo;
  // 스파이 — 쓰기와 완료 기록 사이의 파일 삭제를 재현하는 테스트용(그 밖엔 실제 동작 그대로).
  @MockitoSpyBean FileStore fileStore;
  @Autowired ConverterProperties props;

  @Autowired
  @Qualifier("filePreviewInteractiveExecutor")
  ThreadPoolTaskExecutor interactiveExecutor;

  @Autowired
  @Qualifier("filePreviewBackgroundExecutor")
  ThreadPoolTaskExecutor backgroundExecutor;

  @MockitoBean ConverterClient converter;

  private Long tid2;
  private Long userId;
  private final List<Long> fileIds = new ArrayList<>();
  private final List<String> storagePaths = new ArrayList<>();

  @BeforeEach
  void seed() {
    String suffix = suffix();
    userId =
        inTenantTx(
            () ->
                dsl.insertInto(USER)
                    .set(USER.USERNAME, "pvs_" + suffix)
                    .set(USER.PASSWORD, "pw")
                    .set(USER.NAME, "pvs_" + suffix)
                    .set(USER.EMAIL, "pvs_" + suffix + "@example.com")
                    .returning(USER.ID)
                    .fetchOne()
                    .getId());
  }

  @AfterEach
  void cleanup() {
    TenantContext.clear();
    inTenantTx(
        () -> {
          // FK 순서: FILE_PREVIEW(CASCADE 이지만 명시) → FILE → USER
          for (Long id : fileIds) {
            dsl.deleteFrom(FILE_PREVIEW).where(FILE_PREVIEW.FILE_ID.eq(id)).execute();
            dsl.deleteFrom(FILE).where(FILE.ID.eq(id)).execute();
          }
          dsl.deleteFrom(USER).where(USER.ID.eq(userId)).execute();
          return null;
        });
    for (String path : storagePaths) {
      fileStore.deleteWithDerived(path, null);
    }
    fileIds.clear();
    storagePaths.clear();
  }

  @Test
  void 처음_열면_변환_중이고_완료되면_PDF_를_준다() throws Exception {
    // pageCount 가 없는(null) 성공 응답도 READY 로 기록돼야 한다.
    when(converter.convertPdf(any(), anyString()))
        .thenReturn(new ConvertOutcome.Success(PDF, null));
    long id = createFile("보고서.hwp", HWP, 100L);

    assertThat(open(id, true)).isInstanceOf(PreviewOutcome.Converting.class);
    awaitStatus(id, "READY");

    PreviewOutcome second = open(id, false);
    assertThat(second).isInstanceOf(PreviewOutcome.Ready.class);
    PreviewOutcome.Ready ready = (PreviewOutcome.Ready) second;
    assertThat(ready.body().getContentAsByteArray()).isEqualTo(PDF);
    assertThat(ready.sizeBytes()).isEqualTo(PDF.length);
    verify(converter, times(1)).convertPdf(any(), anyString());
  }

  @Test
  void 비동기_변환은_픽스처_테넌트_GUC_로_기록된다() {
    when(converter.convertPdf(any(), anyString())).thenReturn(new ConvertOutcome.Success(PDF, 3));
    long id = createFile("보고서.hwp", HWP, 100L);
    assertThat(tid2).isNotEqualTo(1L);

    assertThat(open(id, true)).isInstanceOf(PreviewOutcome.Converting.class);

    // GUC 가 빠지면 세션 기본 GUC=1 로 기록돼 RLS 에 막혀 CONVERTING 에 머문다.
    awaitStatus(id, "READY");
    assertThat(row(id).pageCount()).isEqualTo(3);
  }

  @Test
  void 변환_실패는_영구_FAILED_로_고정되고_다시_부르지_않는다() {
    when(converter.convertPdf(any(), anyString()))
        .thenReturn(new ConvertOutcome.Failure("CONVERT_FAILED", false));
    long id = createFile("보고서.hwp", HWP, 100L);

    open(id, true);
    awaitStatus(id, "FAILED");

    assertThat(open(id, true)).isEqualTo(new PreviewOutcome.Failed("CONVERT_FAILED", false));
    assertThat(open(id, true)).isEqualTo(new PreviewOutcome.Failed("CONVERT_FAILED", false));
    verify(converter, times(1)).convertPdf(any(), anyString());
  }

  @Test
  void 일시_실패는_3회까지_바로_다시_시도하고_그_뒤엔_쿨다운이_지나야_다시_시도한다() {
    when(converter.convertPdf(any(), anyString()))
        .thenReturn(new ConvertOutcome.Failure("TIMEOUT", true));
    long id = createFile("보고서.hwp", HWP, 100L);

    List<PreviewOutcome> polled = new ArrayList<>();
    for (int i = 0; i < 3; i++) {
      assertThat(open(id, true)).isInstanceOf(PreviewOutcome.Converting.class);
      awaitStatus(id, "FAILED");
      polled.add(open(id, false));
    }

    // 일시 실패는 상한에 닿아도 transient 그대로 — 웹이 [다시 시도]를 계속 보인다.
    assertThat(polled).containsOnly(new PreviewOutcome.Failed("TIMEOUT", true));
    // 상한 — 쿨다운 전에는 [다시 시도](start=true)도 변환하지 않는다.
    assertThat(open(id, true)).isEqualTo(new PreviewOutcome.Failed("TIMEOUT", true));
    verify(converter, times(3)).convertPdf(any(), anyString());

    // 마지막 실패가 쿨다운(10분)보다 오래되면 다시 시도하고 attempts 를 1 부터 센다.
    ageUpdatedAt(id, props.preview().transientCooldown().plusMinutes(1));
    assertThat(open(id, false)).isEqualTo(new PreviewOutcome.Failed("TIMEOUT", true));
    assertThat(open(id, true)).isInstanceOf(PreviewOutcome.Converting.class);
    awaitStatus(id, "FAILED");
    assertThat(row(id).attempts()).isEqualTo(1);
    verify(converter, times(4)).convertPdf(any(), anyString());
  }

  @Test
  void 폴링은_일시_실패를_다시_선점하지_않는다() {
    when(converter.convertPdf(any(), anyString()))
        .thenReturn(new ConvertOutcome.Failure("BUSY", true));
    long id = createFile("보고서.hwp", HWP, 100L);

    open(id, true);
    awaitStatus(id, "FAILED");

    for (int i = 0; i < 3; i++) {
      assertThat(open(id, false)).isEqualTo(new PreviewOutcome.Failed("BUSY", true));
    }
    verify(converter, times(1)).convertPdf(any(), anyString());
    assertThat(row(id).attempts()).isEqualTo(1);
  }

  @Test
  void 엔진_버전이_바뀌면_영구_실패도_다시_변환한다() {
    when(converter.convertPdf(any(), anyString()))
        .thenReturn(new ConvertOutcome.Failure("CONVERT_FAILED", false));
    long id = createFile("보고서.hwp", HWP, 100L);
    open(id, true);
    awaitStatus(id, "FAILED");
    inTenantTx(
        () ->
            dsl.update(FILE_PREVIEW)
                .set(FILE_PREVIEW.ENGINE_VERSION, "old")
                .where(FILE_PREVIEW.FILE_ID.eq(id))
                .execute());

    assertThat(open(id, true)).isInstanceOf(PreviewOutcome.Converting.class);
    awaitStatus(id, "FAILED");
    verify(converter, times(2)).convertPdf(any(), anyString());
  }

  @Test
  void 엔진_버전이_다른_READY_는_폴링으로_열어도_다시_변환한다() {
    when(converter.convertPdf(any(), anyString())).thenReturn(new ConvertOutcome.Success(PDF, 1));
    long id = createFile("보고서.hwp", HWP, 100L);
    open(id, true);
    awaitStatus(id, "READY");
    inTenantTx(
        () ->
            dsl.update(FILE_PREVIEW)
                .set(FILE_PREVIEW.ENGINE_VERSION, "old")
                .where(FILE_PREVIEW.FILE_ID.eq(id))
                .execute());

    // start 와 무관하게 옛 엔진 결과 대신 변환 중으로 답하고 새 엔진으로 다시 변환한다.
    assertThat(open(id, false)).isInstanceOf(PreviewOutcome.Converting.class);
    awaitStatus(id, "READY");
    assertThat(row(id).engineVersion()).isEqualTo(props.preview().engineVersion());
    assertThat(open(id, false)).isInstanceOf(PreviewOutcome.Ready.class);
    verify(converter, times(2)).convertPdf(any(), anyString());
  }

  @Test
  void 큐에서_기다리는_사이_리스가_만료돼_다른_쪽이_선점했으면_변환하지_않는다() {
    long id = createFile("보고서.hwp", HWP, 100L);
    OffsetDateTime tokenA = claim(id);
    expireLease(id);
    OffsetDateTime tokenB = claim(id);

    // 늦게 시작한 A — 리스 갱신 CAS 가 실패해 건너뛴다.
    service.convertClaimed(tid2, id, tokenA, null);

    verify(converter, never()).convertPdf(any(), anyString());
    assertThat(row(id).status()).isEqualTo("CONVERTING");
    assertThat(row(id).leasedUntil()).isEqualTo(tokenB);
  }

  @Test
  void 늦게_시작해도_행을_쥐고_있으면_리스를_갱신하고_변환한다() {
    when(converter.convertPdf(any(), anyString())).thenReturn(new ConvertOutcome.Success(PDF, 2));
    long id = createFile("보고서.hwp", HWP, 100L);
    claim(id);
    // 큐 대기로 리스가 만료됐지만 아무도 다시 선점하지 않음 — 행의 토큰은 만료된 그 값이다.
    expireLease(id);
    OffsetDateTime expired = row(id).leasedUntil();
    assertThat(expired).isBefore(OffsetDateTime.now());

    service.convertClaimed(tid2, id, expired, null);

    assertThat(row(id).status()).isEqualTo("READY");
    assertThat(row(id).pageCount()).isEqualTo(2);
    assertThat(fileStore.exists(PreviewTypes.previewPath(storagePathOf(id)))).isTrue();
  }

  @Test
  void 변환_중_파일이_지워지면_preview_pdf_를_남기지_않는다() {
    long id = createFile("보고서.hwp", HWP, 100L);
    String previewPath = PreviewTypes.previewPath(storagePathOf(id));
    when(converter.convertPdf(any(), anyString()))
        .thenAnswer(
            inv -> {
              deleteFileRow(id); // file_preview 행도 CASCADE 로 사라진다.
              return new ConvertOutcome.Success(PDF, 1);
            });
    OffsetDateTime token = claim(id);

    service.convertClaimed(tid2, id, token, null);

    verify(converter, times(1)).convertPdf(any(), anyString());
    assertThat(row(id)).isNull();
    assertThat(fileStore.exists(previewPath)).isFalse();
  }

  @Test
  void PDF_를_쓴_뒤_완료_기록이_실패하면_쓴_PDF_를_지운다() {
    when(converter.convertPdf(any(), anyString())).thenReturn(new ConvertOutcome.Success(PDF, 1));
    long id = createFile("보고서.hwp", HWP, 100L);
    String previewPath = PreviewTypes.previewPath(storagePathOf(id));
    // 쓰기 직전 확인은 통과한 뒤, 쓰기와 READY 기록 사이에 파일이 지워지는 경우.
    doAnswer(
            inv -> {
              inv.callRealMethod();
              deleteFileRow(id);
              return null;
            })
        .when(fileStore)
        .writeAtomically(eq(previewPath), any());
    OffsetDateTime token = claim(id);

    service.convertClaimed(tid2, id, token, null);

    verify(fileStore).writeAtomically(eq(previewPath), any());
    assertThat(row(id)).isNull();
    assertThat(fileStore.exists(previewPath)).isFalse();
  }

  @Test
  void 쓴_뒤_다른_작업이_다시_선점했으면_리스를_잃어도_그_결과_파일은_지우지_않는다() {
    when(converter.convertPdf(any(), anyString())).thenReturn(new ConvertOutcome.Success(PDF, 1));
    long id = createFile("보고서.hwp", HWP, 100L);
    String previewPath = PreviewTypes.previewPath(storagePathOf(id));
    // 쓰기와 READY 기록 사이에 리스가 만료돼 다른 작업이 다시 선점(살아 있는 리스로 CONVERTING) — 같은 위치에 그 작업이 결과를 쓴다.
    AtomicReference<OffsetDateTime> otherToken = new AtomicReference<>();
    doAnswer(
            inv -> {
              inv.callRealMethod();
              expireLease(id);
              otherToken.set(claim(id));
              return null;
            })
        .when(fileStore)
        .writeAtomically(eq(previewPath), any());
    OffsetDateTime token = claim(id);

    service.convertClaimed(tid2, id, token, null);

    // 완료 기록 CAS 는 실패했지만, 행은 다른 작업의 살아 있는 리스라 결과 파일을 남긴다.
    assertThat(row(id).status()).isEqualTo("CONVERTING");
    assertThat(row(id).leasedUntil()).isEqualTo(otherToken.get());
    assertThat(fileStore.exists(previewPath)).isTrue();
  }

  @Test
  void READY_인데_PDF_가_없으면_다시_변환한다() {
    when(converter.convertPdf(any(), anyString())).thenReturn(new ConvertOutcome.Success(PDF, 1));
    long id = createFile("보고서.hwp", HWP, 100L);
    open(id, true);
    awaitStatus(id, "READY");
    fileStore.deleteIfExists(PreviewTypes.previewPath(storagePathOf(id)));

    assertThat(open(id, false)).isInstanceOf(PreviewOutcome.Converting.class);
    awaitStatus(id, "READY");
    assertThat(open(id, false)).isInstanceOf(PreviewOutcome.Ready.class);
    verify(converter, times(2)).convertPdf(any(), anyString());
  }

  @Test
  void _100MB_를_넘으면_부르지_않고_TOO_LARGE() {
    long id = createFile("보고서.hwp", HWP, 104_857_601L);

    assertThat(open(id, true)).isEqualTo(new PreviewOutcome.Failed("TOO_LARGE", false));
    assertThat(open(id, true)).isEqualTo(new PreviewOutcome.Failed("TOO_LARGE", false));
    verify(converter, never()).convertPdf(any(), anyString());
  }

  @Test
  void 대상_형식이_아니면_NotApplicable() {
    long id =
        createFile(
            "a.docx",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            100L);

    assertThat(open(id, true)).isInstanceOf(PreviewOutcome.NotApplicable.class);
    assertThat(row(id)).isNull();
  }

  @Test
  void 꺼져_있으면_NotApplicable() {
    ConverterProperties off =
        new ConverterProperties(
            props.baseUrl(),
            props.internalToken(),
            false,
            props.timeoutSeconds(),
            props.maxBytes(),
            props.busyRetries(),
            props.busyBackoffMs(),
            props.preview());
    FilePreviewService disabled =
        new FilePreviewService(
            repo,
            off,
            fileStore,
            txManager,
            new PreviewEngine(converter, off, txManager, interactiveExecutor),
            backgroundExecutor);
    long id = createFile("보고서.hwp", HWP, 100L);

    PreviewOutcome outcome = TenantContext.callAs(tid2, () -> disabled.open(id, true));

    assertThat(outcome).isInstanceOf(PreviewOutcome.NotApplicable.class);
    disabled.requestBackground(tid2, id, HWP, "보고서.hwp");
    verify(converter, never()).convertPdf(any(), anyString());
    assertThat(row(id)).isNull();
  }

  @Test
  void 백그라운드_큐가_차_있어도_첫_열람은_대화형_실행기로_간다() throws Exception {
    long a = createFile("a.hwp", HWP, 100L);
    long b = createFile("b.hwp", HWP, 100L);
    Path sourceA = fileStore.resolve(storagePathOf(a));
    CountDownLatch releaseA = new CountDownLatch(1);
    CountDownLatch aStarted = new CountDownLatch(1);
    CountDownLatch bCalled = new CountDownLatch(1);
    when(converter.convertPdf(any(), anyString()))
        .thenAnswer(
            inv -> {
              if (sourceA.equals(inv.getArgument(0))) {
                aStarted.countDown();
                releaseA.await(10, TimeUnit.SECONDS);
              } else {
                bCalled.countDown();
              }
              return new ConvertOutcome.Success(PDF, 1);
            });
    try {
      // 테넌트 컨텍스트 없이 제출 — 작업이 넘겨받은 tenantId 로 스스로 GUC 를 세우는지까지 본다.
      service.requestBackground(tid2, a, HWP, "보고서.hwp");
      assertThat(aStarted.await(5, TimeUnit.SECONDS)).isTrue();

      assertThat(open(b, true)).isInstanceOf(PreviewOutcome.Converting.class);

      assertThat(bCalled.await(5, TimeUnit.SECONDS)).isTrue();
      assertThat(releaseA.getCount()).isEqualTo(1);
    } finally {
      releaseA.countDown();
    }
    awaitStatus(a, "READY");
    awaitStatus(b, "READY");
  }

  @Test
  void 백그라운드_작업은_시작할_때_선점하고_이미_READY_면_건너뛴다() {
    when(converter.convertPdf(any(), anyString())).thenReturn(new ConvertOutcome.Success(PDF, 1));
    long id = createFile("보고서.hwp", HWP, 100L);
    open(id, true);
    awaitStatus(id, "READY");

    long completedBefore = backgroundExecutor.getThreadPoolExecutor().getCompletedTaskCount();
    service.requestBackground(tid2, id, HWP, "보고서.hwp");
    awaitBackgroundCompleted(completedBefore);

    verify(converter, times(1)).convertPdf(any(), anyString());
    assertThat(row(id).status()).isEqualTo("READY");
  }

  @Test
  void 백그라운드_작업은_새_파일을_변환한다() {
    when(converter.convertPdf(any(), anyString())).thenReturn(new ConvertOutcome.Success(PDF, 2));
    long id = createFile("보고서.hwp", HWP, 100L);

    service.requestBackground(tid2, id, HWP, "보고서.hwp");

    awaitStatus(id, "READY");
    verify(converter, times(1)).convertPdf(any(), anyString());
  }

  // ───────────── 헬퍼 ─────────────

  /** 서비스 설정으로 직접 선점해 리스 토큰을 받는다(실행기 없이 convertClaimed 를 부르는 테스트용). */
  private OffsetDateTime claim(long fileId) {
    return inTenantTx(
            () ->
                repo.claim(
                    fileId,
                    tid2,
                    props.preview().engineVersion(),
                    props.preview().lease(),
                    props.preview().maxAttempts(),
                    props.preview().transientCooldown(),
                    true))
        .orElseThrow();
  }

  /** 리스를 1초 전으로 당겨 "큐에서 기다리다 리스가 만료된" CONVERTING 을 만든다. */
  private void expireLease(long fileId) {
    inTenantTx(
        () ->
            dsl.update(FILE_PREVIEW)
                .set(
                    FILE_PREVIEW.LEASED_UNTIL,
                    DSL.field("now() - interval '1 second'", OffsetDateTime.class))
                .where(FILE_PREVIEW.FILE_ID.eq(fileId))
                .execute());
  }

  /** 마지막 상태 변경 시각을 과거로 당긴다(일시 실패 쿨다운 경과 재현). */
  private void ageUpdatedAt(long fileId, Duration age) {
    inTenantTx(
        () ->
            dsl.update(FILE_PREVIEW)
                .set(
                    FILE_PREVIEW.UPDATED_AT,
                    DSL.field(
                        "now() - ({0} * interval '1 second')",
                        OffsetDateTime.class, DSL.val(age.toSeconds())))
                .where(FILE_PREVIEW.FILE_ID.eq(fileId))
                .execute());
  }

  /** file 행을 지운다(변환 중 영구 삭제 재현) — file_preview 행은 CASCADE 로 함께 사라진다. */
  private void deleteFileRow(long fileId) {
    inTenantTx(() -> dsl.deleteFrom(FILE).where(FILE.ID.eq(fileId)).execute());
  }

  /** 요청 스레드처럼 fixture 테넌트 컨텍스트로 open 을 부른다(끝나면 컨텍스트를 되돌린다). */
  private PreviewOutcome open(long fileId, boolean start) {
    return TenantContext.callAs(tid2, () -> service.open(fileId, start));
  }

  /** 원본 blob 을 디스크에 쓰고 file 행을 fixture 테넌트에 커밋한다. */
  private long createFile(String name, String mime, long sizeBytes) {
    String suffix = suffix();
    String storagePath = "wp431-preview-svc/" + suffix + "/" + suffix + ".bin";
    fileStore.storeBytes(storagePath, ("원본 " + name).getBytes(StandardCharsets.UTF_8));
    storagePaths.add(storagePath);
    long id =
        inTenantTx(
            () ->
                dsl.insertInto(FILE)
                    .set(FILE.ORIGINAL_NAME, name)
                    .set(FILE.STORED_NAME, "stored_" + suffix)
                    .set(FILE.MIME_TYPE, mime)
                    .set(FILE.SIZE_BYTES, sizeBytes)
                    .set(FILE.STORAGE_PATH, storagePath)
                    .set(FILE.UPLOADED_BY, userId)
                    .returning(FILE.ID)
                    .fetchOne()
                    .getId());
    fileIds.add(id);
    return id;
  }

  private String storagePathOf(long fileId) {
    return inTenantTx(
        () ->
            dsl.select(FILE.STORAGE_PATH).from(FILE).where(FILE.ID.eq(fileId)).fetchOne().value1());
  }

  private FilePreviewRepository.Row row(long fileId) {
    return inTenantTx(() -> repo.find(fileId).orElse(null));
  }

  /** 비동기 변환이 목표 상태에 이를 때까지 기다린다. */
  private void awaitStatus(long fileId, String status) {
    PreviewAwait.awaitStatus(
        () -> {
          FilePreviewRepository.Row r = row(fileId);
          return r == null ? null : r.status();
        },
        status);
  }

  /**
   * 백그라운드 작업이 실제로 끝날 때까지 기다린다(상한 5초) — 완료 수가 제출 전 값보다 커질 때까지. 활성 수·큐 비어 있음으로 보면 작업이 워커에 넘어가는 순간에도
   * 참이라 작업이 돌기 전에 통과할 수 있다.
   */
  private void awaitBackgroundCompleted(long completedBefore) {
    long deadline = System.currentTimeMillis() + 5_000;
    var pool = backgroundExecutor.getThreadPoolExecutor();
    while (System.currentTimeMillis() < deadline) {
      if (pool.getCompletedTaskCount() > completedBefore) {
        return;
      }
      sleep(50);
    }
    throw new AssertionError("백그라운드 작업이 끝나지 않았다");
  }

  private static void sleep(long ms) {
    try {
      Thread.sleep(ms);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException(e);
    }
  }

  private static String suffix() {
    return UUID.randomUUID().toString().replace("-", "").substring(0, 8);
  }

  /** fixture 테넌트 GUC 를 심은 트랜잭션에서 실행하고 커밋한다. */
  private <T> T inTenantTx(Supplier<T> body) {
    return new TransactionTemplate(txManager)
        .execute(
            status -> {
              if (tid2 == null) {
                tid2 = ensureFixtureTenant();
              }
              dsl.execute("SELECT set_config('app.tenant_id', '" + tid2 + "', true)");
              return body.get();
            });
  }

  /** 고정 슬러그로 fixture 테넌트를 find-or-create(커밋) — tenant 행은 삭제 불가라 누적을 막는다. */
  private long ensureFixtureTenant() {
    Long existing =
        dsl.select(TENANT.ID)
            .from(TENANT)
            .where(TENANT.SLUG.eq(FIXTURE_TENANT_SLUG))
            .fetchOne(TENANT.ID);
    if (existing != null) {
      return existing;
    }
    return dsl.insertInto(TENANT)
        .set(TENANT.SLUG, FIXTURE_TENANT_SLUG)
        .set(TENANT.NAME, "File Preview Service Fixture Tenant")
        .set(TENANT.STATUS, "ACTIVE")
        .returning(TENANT.ID)
        .fetchOne()
        .getId();
  }
}
