package com.workplace.fileai.service;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.FILE_EXTRACTION;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.workplace.file.storage.FileStore;
import com.workplace.fileai.dto.ViewImage;
import com.workplace.fileai.exception.AttachmentViewException;
import com.workplace.fileai.outbound.WorkerRenderClient;
import com.workplace.fileai.outbound.WorkerRenderClient.RenderResult;
import com.workplace.global.tenant.TenantContext;
import com.workplace.jooq.tables.Tenant;
import com.workplace.support.IntegrationTestBase;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * WP-250: 첨부를 모델 입력용 이미지로 보여 주는 공통 서비스 — 입력 검사·캐시·page_count 보충·동시 요청을 검증한다.
 *
 * <p>서비스는 트랜잭션을 두지 않고 짧은 TransactionTemplate 으로만 DB 를 읽고 쓴다(R5). 그래서 테스트도 트랜잭션 없이 커밋된 시드를 쓰고, 요청
 * 스레드처럼 TenantContext 만 세팅한다. FileStore 는 실제 빈(테스트 프로필의 build/test-storage 루트)이고 워커만 목이다.
 */
class AttachmentViewServiceTest extends IntegrationTestBase {

  private static final long TENANT = 1L;
  private static final byte[] PNG = {(byte) 0x89, 'P', 'N', 'G', 7, 7, 7, 7};

  @Autowired DSLContext dsl;
  @Autowired AttachmentViewService service;
  @Autowired FileStore fileStore;
  @MockitoBean WorkerRenderClient worker;

  private final List<Long> fileIds = new ArrayList<>();

  /** 테스트마다 고유한 저장 디렉터리 — 이전 실행이 남긴 캐시가 "워커 1회 호출" 단언을 흔들지 않게 한다. */
  private String dir;

  private Long userId;

  /** 테넌트 #2 회귀 검사용 — 세션 기본 GUC(1)와 다른 고정 슬러그 테넌트(NonTransactionalRlsReadGuardTest 와 같은 fixture). */
  private static final String FIXTURE_TENANT_SLUG = "rls-guard-fixture-tenant";

  private Long tid2;
  private final List<Long> tenant2FileIds = new ArrayList<>();

  @BeforeEach
  void setUp() {
    TenantContext.set(TENANT);
    String suffix = String.valueOf(System.nanoTime());
    dir = "wp250-view-test/" + suffix;
    userId =
        new TransactionTemplate(txManager)
            .execute(
                s ->
                    dsl.insertInto(USER)
                        .set(USER.USERNAME, "avs-" + suffix)
                        .set(USER.NAME, "AVS")
                        .set(USER.EMAIL, "avs-" + suffix + "@example.com")
                        .set(USER.KIND, "HUMAN")
                        .returning(USER.ID)
                        .fetchOne()
                        .getId());
  }

  @AfterEach
  void tearDown() {
    // 테넌트 #2 행은 GUC=2 에서만 보이므로 따로 지운다(사용자 FK 때문에 사용자 삭제보다 먼저).
    if (tid2 != null && !tenant2FileIds.isEmpty()) {
      new TransactionTemplate(txManager)
          .executeWithoutResult(
              s -> {
                setGuc(tid2);
                dsl.deleteFrom(FILE_EXTRACTION)
                    .where(FILE_EXTRACTION.FILE_ID.in(tenant2FileIds))
                    .execute();
                dsl.deleteFrom(FILE).where(FILE.ID.in(tenant2FileIds)).execute();
              });
    }
    tenant2FileIds.clear();
    tid2 = null;
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            s -> {
              dsl.deleteFrom(FILE_EXTRACTION).where(FILE_EXTRACTION.FILE_ID.in(fileIds)).execute();
              dsl.deleteFrom(FILE).where(FILE.ID.in(fileIds)).execute();
              dsl.deleteFrom(USER).where(USER.ID.eq(userId)).execute();
            });
    fileIds.clear();
    fileStore.deleteTreeIfExists(dir);
    TenantContext.clear();
  }

  @Test
  void PDF_페이지를_그려_캐시하고_두번째는_워커를_부르지_않는다() {
    long id = seedPdf(3);
    when(worker.render(anyString(), anyString(), any(), anyInt()))
        .thenReturn(new RenderResult(PNG, "image/png", 3));

    ViewImage first = service.view(id, 2);

    assertThat(first.data()).isEqualTo(PNG);
    assertThat(first.contentType()).isEqualTo("image/png");
    assertThat(first.pageCount()).isEqualTo(3);
    verify(worker).render(dir + "/a.pdf", "application/pdf", 2, 1568);
    assertThat(fileStore.exists(dir + "/a.pdf.view/p2-1568.png")).isTrue();

    ViewImage second = service.view(id, 2);

    assertThat(second.data()).isEqualTo(PNG);
    assertThat(second.contentType()).isEqualTo("image/png");
    verify(worker, times(1)).render(anyString(), anyString(), any(), anyInt());
  }

  @Test
  void 알려진_페이지수를_넘거나_1보다_작으면_워커_없이_PAGE_OUT_OF_RANGE() {
    long id = seedPdf(3);

    assertThatThrownBy(() -> service.view(id, 5))
        .isInstanceOfSatisfying(
            AttachmentViewException.class,
            e -> {
              assertThat(e.status()).isEqualTo(400);
              assertThat(e.code()).isEqualTo("PAGE_OUT_OF_RANGE");
              assertThat(e.pageCount()).isEqualTo(3);
              assertThat(e.getMessage()).isEqualTo("이 PDF 는 3쪽입니다. 1~3 사이 페이지를 지정하세요.");
            });
    assertThatThrownBy(() -> service.view(id, 0))
        .isInstanceOfSatisfying(
            AttachmentViewException.class,
            e -> assertThat(e.code()).isEqualTo("PAGE_OUT_OF_RANGE"));
    verifyNoInteractions(worker);
  }

  @Test
  void 페이지수를_모르면_1보다_작은_페이지도_워커_없이_거절한다() {
    // 워커까지 가면 FastAPI 검증 실패(422 목록)로 돌아와 엉뚱한 안내가 된다.
    long id = seedPdf(null);
    assertThatThrownBy(() -> service.view(id, 0))
        .isInstanceOfSatisfying(
            AttachmentViewException.class,
            e -> {
              assertThat(e.status()).isEqualTo(400);
              assertThat(e.code()).isEqualTo("PAGE_OUT_OF_RANGE");
              assertThat(e.getMessage()).doesNotContain("null");
            });
    verifyNoInteractions(worker);
  }

  @Test
  void 페이지수가_비어_있으면_워커가_알려_준_값으로_채운다() {
    long id = seedPdf(null);
    when(worker.render(anyString(), anyString(), any(), anyInt()))
        .thenReturn(new RenderResult(PNG, "image/png", 4));

    ViewImage v = service.view(id, 1);

    assertThat(v.pageCount()).isEqualTo(4);
    Integer stored =
        new TransactionTemplate(txManager)
            .execute(
                s ->
                    dsl.select(FILE_EXTRACTION.PAGE_COUNT)
                        .from(FILE_EXTRACTION)
                        .where(FILE_EXTRACTION.FILE_ID.eq(id))
                        .fetchOne(FILE_EXTRACTION.PAGE_COUNT));
    assertThat(stored).isEqualTo(4);
  }

  @Test
  void 이미지는_page_없이_그리고_jpg_로_캐시한다() {
    long id = seedFile("image/png", "b.png", 1000L);
    byte[] jpg = {(byte) 0xFF, (byte) 0xD8, 1, 2, 3};
    when(worker.render(anyString(), anyString(), isNull(), anyInt()))
        .thenReturn(new RenderResult(jpg, "image/jpeg", null));

    ViewImage v = service.view(id, null);

    assertThat(v.data()).isEqualTo(jpg);
    assertThat(v.contentType()).isEqualTo("image/jpeg");
    assertThat(v.pageCount()).isNull();
    verify(worker).render(eq(dir + "/b.png"), eq("image/png"), isNull(), eq(1568));
    assertThat(fileStore.exists(dir + "/b.png.view/img-1568.jpg")).isTrue();

    assertThat(service.view(id, null).data()).isEqualTo(jpg);
    verify(worker, times(1)).render(anyString(), anyString(), any(), anyInt());
  }

  @Test
  void 이미지에_page_를_주거나_PDF_에_page_를_빼면_400() {
    long img = seedFile("image/png", "b.png", 1000L);
    long pdf = seedPdf(3);

    assertThatThrownBy(() -> service.view(img, 1))
        .isInstanceOfSatisfying(
            AttachmentViewException.class,
            e -> {
              assertThat(e.status()).isEqualTo(400);
              assertThat(e.code()).isEqualTo("PAGE_NOT_ALLOWED");
            });
    assertThatThrownBy(() -> service.view(pdf, null))
        .isInstanceOfSatisfying(
            AttachmentViewException.class,
            e -> {
              assertThat(e.status()).isEqualTo(400);
              assertThat(e.code()).isEqualTo("PAGE_REQUIRED");
            });
    verifyNoInteractions(worker);
  }

  @Test
  void PDF_이미지가_아니면_415_25MB_를_넘으면_413() {
    long txt = seedFile("text/plain", "c.txt", 10L);
    long big = seedFile("application/pdf", "big.pdf", 26L * 1024 * 1024);

    assertThatThrownBy(() -> service.view(txt, null))
        .isInstanceOfSatisfying(
            AttachmentViewException.class,
            e -> {
              assertThat(e.status()).isEqualTo(415);
              assertThat(e.code()).isEqualTo("UNSUPPORTED");
            });
    assertThatThrownBy(() -> service.view(big, 1))
        .isInstanceOfSatisfying(
            AttachmentViewException.class,
            e -> {
              assertThat(e.status()).isEqualTo(413);
              assertThat(e.code()).isEqualTo("TOO_LARGE");
            });
    verifyNoInteractions(worker);
  }

  @Test
  void 없는_파일이면_404() {
    assertThatThrownBy(() -> service.view(Long.MAX_VALUE, 1))
        .isInstanceOfSatisfying(
            AttachmentViewException.class,
            e -> {
              assertThat(e.status()).isEqualTo(404);
              assertThat(e.code()).isEqualTo("NOT_FOUND");
            });
    verifyNoInteractions(worker);
  }

  /**
   * Review Focus 3: 같은 페이지를 동시에 처음 요청해도 둘 다 온전한 바이트를 받고 캐시 파일이 깨지지 않는다.
   *
   * <p>목 응답 안의 배리어로 두 스레드가 모두 캐시를 놓친 뒤에야 쓰게 만들어, 같은 경로에 두 번 쓰는 경합을 확실히 재현한다.
   */
  @Test
  void 같은_페이지를_동시에_요청해도_둘_다_온전하고_캐시도_온전하다() throws Exception {
    long id = seedPdf(3);
    byte[] big = new byte[256 * 1024];
    for (int i = 0; i < big.length; i++) big[i] = (byte) i;
    CyclicBarrier bothMissed = new CyclicBarrier(2);
    when(worker.render(anyString(), anyString(), any(), anyInt()))
        .thenAnswer(
            inv -> {
              bothMissed.await(10, TimeUnit.SECONDS);
              return new RenderResult(big, "image/png", 3);
            });

    ExecutorService pool = Executors.newFixedThreadPool(2);
    try {
      List<Future<ViewImage>> results = new ArrayList<>();
      for (int i = 0; i < 2; i++) {
        results.add(
            pool.submit(
                () -> {
                  // 요청 스레드처럼 테넌트를 세팅해야 RLS 가 파일 행을 보여 준다.
                  TenantContext.set(TENANT);
                  try {
                    return service.view(id, 1);
                  } finally {
                    TenantContext.clear();
                  }
                }));
      }
      for (Future<ViewImage> f : results) {
        assertThat(f.get(30, TimeUnit.SECONDS).data()).isEqualTo(big);
      }
    } finally {
      pool.shutdownNow();
    }

    verify(worker, times(2)).render(anyString(), anyString(), any(), anyInt());
    String cache = dir + "/a.pdf.view/p1-1568.png";
    assertThat(fileStore.size(cache)).isEqualTo(big.length);
    assertThat(fileStore.readAllBytes(cache)).isEqualTo(big);
  }

  /**
   * R5 회귀 검사 — 테넌트 #2 에 커밋한 PDF 를 트랜잭션 밖에서 보고, 비어 있던 page_count 가 채워져야 한다.
   *
   * <p>테스트 프로필은 풀 커넥션마다 세션 GUC 를 테넌트 1 로 박아 두므로(application-test.yml connection-init-sql) 테넌트 1
   * 시드로는 파일 행 읽기·page_count 쓰기가 트랜잭션 밖으로 새도 드러나지 않는다. 트랜잭션-로컬 GUC 만 세션 값을 덮으므로, 테넌트 #2 에서는
   * readOnlyTx 가 빠지면 파일 행이 안 보여 404, writeTx 가 빠지면 0행 갱신으로 page_count 가 null 로 남는다.
   */
  @Test
  void 테넌트2_에서도_파일을_읽고_page_count_를_채운다() {
    tid2 = ensureFixtureTenant();
    long id = seedTenant2Pdf();
    when(worker.render(anyString(), anyString(), any(), anyInt()))
        .thenReturn(new RenderResult(PNG, "image/png", 4));

    TenantContext.set(tid2);
    ViewImage v = service.view(id, 1);

    assertThat(v.data()).isEqualTo(PNG);
    assertThat(v.pageCount()).isEqualTo(4);
    assertThat(tenant2PageCount(id)).isEqualTo(4);
  }

  @Test
  void 쪽수를_몰라_워커가_범위_밖으로_거절하면_쪽수를_채우고_다음엔_워커_없이_거른다() {
    long id = seedPdf(null);
    when(worker.render(anyString(), anyString(), any(), anyInt()))
        .thenThrow(new AttachmentViewException("PAGE_OUT_OF_RANGE", 3));

    assertThatThrownBy(() -> service.view(id, 9))
        .isInstanceOfSatisfying(
            AttachmentViewException.class,
            e -> {
              assertThat(e.status()).isEqualTo(400);
              assertThat(e.pageCount()).isEqualTo(3);
            });
    Integer stored =
        new TransactionTemplate(txManager)
            .execute(
                s ->
                    dsl.select(FILE_EXTRACTION.PAGE_COUNT)
                        .from(FILE_EXTRACTION)
                        .where(FILE_EXTRACTION.FILE_ID.eq(id))
                        .fetchOne(FILE_EXTRACTION.PAGE_COUNT));
    assertThat(stored).isEqualTo(3);

    assertThatThrownBy(() -> service.view(id, 9)).isInstanceOf(AttachmentViewException.class);
    verify(worker, times(1)).render(anyString(), anyString(), any(), anyInt());
  }

  /** 고정 슬러그 fixture 테넌트 find-or-create(커밋). app_tenant 는 tenant DELETE 불가(V46)라 1행을 재사용한다. */
  private long ensureFixtureTenant() {
    // 클래스 상수 TENANT(=1L)와 이름이 겹쳐 jOOQ 테이블은 별칭 변수로 쓴다.
    Tenant tenantTable = Tenant.TENANT;
    return new TransactionTemplate(txManager)
        .execute(
            s -> {
              Long existing =
                  dsl.select(tenantTable.ID)
                      .from(tenantTable)
                      .where(tenantTable.SLUG.eq(FIXTURE_TENANT_SLUG))
                      .fetchOne(tenantTable.ID);
              if (existing != null) return existing;
              return dsl.insertInto(tenantTable)
                  .set(tenantTable.SLUG, FIXTURE_TENANT_SLUG)
                  .set(tenantTable.NAME, "RLS Guard Fixture Tenant")
                  .set(tenantTable.STATUS, "ACTIVE")
                  .returning(tenantTable.ID)
                  .fetchOne()
                  .getId();
            });
  }

  /**
   * 테넌트 #2 에 PDF 파일 행 + page_count 가 빈 추출 행을 커밋한다(GUC=2 트랜잭션 — file.tenant_id 는 DEFAULT 가 GUC 로
   * 채움).
   */
  private long seedTenant2Pdf() {
    long id =
        new TransactionTemplate(txManager)
            .execute(
                s -> {
                  setGuc(tid2);
                  long fid =
                      dsl.insertInto(FILE)
                          .set(FILE.ORIGINAL_NAME, "t2.pdf")
                          .set(FILE.STORED_NAME, "t2.pdf")
                          .set(FILE.MIME_TYPE, "application/pdf")
                          .set(FILE.SIZE_BYTES, 1000L)
                          .set(FILE.STORAGE_PATH, dir + "/t2.pdf")
                          .set(FILE.UPLOADED_BY, userId)
                          .returning(FILE.ID)
                          .fetchOne()
                          .getId();
                  dsl.insertInto(FILE_EXTRACTION)
                      .set(FILE_EXTRACTION.FILE_ID, fid)
                      .set(FILE_EXTRACTION.STATUS, "DONE")
                      .set(FILE_EXTRACTION.PROFILE, "TEXT_ONLY")
                      .set(FILE_EXTRACTION.TENANT_ID, tid2)
                      .execute();
                  return fid;
                });
    tenant2FileIds.add(id);
    return id;
  }

  /** 테넌트 #2 의 page_count 를 GUC=2 트랜잭션으로 읽는다. */
  private Integer tenant2PageCount(long fileId) {
    return new TransactionTemplate(txManager)
        .execute(
            s -> {
              setGuc(tid2);
              return dsl.select(FILE_EXTRACTION.PAGE_COUNT)
                  .from(FILE_EXTRACTION)
                  .where(FILE_EXTRACTION.FILE_ID.eq(fileId))
                  .fetchOne(FILE_EXTRACTION.PAGE_COUNT);
            });
  }

  /** 트랜잭션-로컬 GUC 설정. */
  private void setGuc(long tenantId) {
    dsl.execute("SELECT set_config('app.tenant_id', '" + tenantId + "', true)");
  }

  /** PDF 파일 행 + 추출 행. pageCount 가 null 이면 page_count 가 빈 추출 행을 둔다(채우기 검증용). */
  private long seedPdf(Integer pageCount) {
    long id = seedFile("application/pdf", "a.pdf", 1000L);
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            s ->
                dsl.insertInto(FILE_EXTRACTION)
                    .set(FILE_EXTRACTION.FILE_ID, id)
                    .set(FILE_EXTRACTION.STATUS, "DONE")
                    .set(FILE_EXTRACTION.PAGE_COUNT, pageCount)
                    .set(FILE_EXTRACTION.PROFILE, "TEXT_ONLY")
                    .set(FILE_EXTRACTION.TENANT_ID, TENANT)
                    .execute());
    return id;
  }

  private long seedFile(String mime, String name, long size) {
    long id =
        new TransactionTemplate(txManager)
            .execute(
                s ->
                    dsl.insertInto(FILE)
                        .set(FILE.ORIGINAL_NAME, name)
                        .set(FILE.STORED_NAME, name)
                        .set(FILE.MIME_TYPE, mime)
                        .set(FILE.SIZE_BYTES, size)
                        .set(FILE.STORAGE_PATH, dir + "/" + name)
                        .set(FILE.UPLOADED_BY, userId)
                        .returning(FILE.ID)
                        .fetchOne()
                        .getId());
    fileIds.add(id);
    return id;
  }
}
