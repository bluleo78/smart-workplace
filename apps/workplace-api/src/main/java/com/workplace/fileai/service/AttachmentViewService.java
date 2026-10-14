package com.workplace.fileai.service;

import static com.workplace.jooq.Tables.FILE;

import com.workplace.file.storage.FileStore;
import com.workplace.fileai.dto.ViewImage;
import com.workplace.fileai.exception.AttachmentViewException;
import com.workplace.fileai.outbound.WorkerProperties;
import com.workplace.fileai.outbound.WorkerRenderClient;
import com.workplace.fileai.outbound.WorkerRenderClient.RenderResult;
import com.workplace.fileai.repository.WorkerJobRepository;
import java.io.UncheckedIOException;
import java.nio.file.NoSuchFileException;
import java.util.List;
import java.util.Locale;
import lombok.extern.slf4j.Slf4j;
import org.jooq.DSLContext;
import org.jooq.Record3;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 첨부·파일을 모델 입력용 이미지로 보여 준다(WP-250). 권한은 호출하는 도메인 서비스가 먼저 확인한다(ExtractedTextService 와 같은 계약).
 *
 * <p>결과는 원본 옆 "{storage_path}.view/" 에 캐시한다 — 워커 저장소는 읽기 전용이라 API 가 쓴다. 파일 이름에 maxEdge 를 넣어 설정을 바꾸면
 * 새로 만든다. 같은 페이지를 동시에 처음 요청하면 워커를 두 번 부를 수 있지만, 캐시는 원자적 이름 바꾸기로 쓰므로 언제나 온전하다(드문 중복 렌더를 잠금 비용과 맞바꾼
 * 선택).
 *
 * <p><b>트랜잭션(R5)</b>: 클래스·메서드에 {@code @Transactional} 을 두지 않는다 — 워커 호출(최대 timeoutSeconds) 동안 DB 연결을
 * 잡지 않기 위해서다. RLS 테넌트 GUC 는 트랜잭션이 시작될 때만 걸리므로 파일 행 읽기는 {@link #readOnlyTx}, page_count 채우기는 {@link
 * #writeTx} 로 각각 짧게 감싼다. 호출자도 트랜잭션 밖에서 불러야 이 의도가 지켜진다.
 *
 * <p><b>캐시 실패</b>: 캐시는 성능용일 뿐이라 읽기·쓰기 실패(디스크 오류·권한 등)로 요청을 실패시키지 않는다 — 읽기 실패는 캐시 없음으로 보고 워커를 부르고,
 * 쓰기 실패는 경고만 남기고 워커가 준 바이트를 그대로 돌려준다.
 */
@Slf4j
@Service
public class AttachmentViewService {

  /** 워커 원본 상한(config.MAX_BYTES)과 같은 25MB — 넘으면 워커까지 가지 않고 413. */
  static final long MAX_SOURCE_BYTES = 25L * 1024 * 1024;

  private final DSLContext dsl;
  private final FileStore fileStore;
  private final WorkerRenderClient worker;
  private final WorkerProperties props;
  private final ExtractedTextService extractedText;
  private final WorkerJobRepository jobs;
  private final TransactionTemplate readOnlyTx;
  private final TransactionTemplate writeTx;

  public AttachmentViewService(
      DSLContext dsl,
      FileStore fileStore,
      WorkerRenderClient worker,
      WorkerProperties props,
      ExtractedTextService extractedText,
      WorkerJobRepository jobs,
      PlatformTransactionManager txManager) {
    this.dsl = dsl;
    this.fileStore = fileStore;
    this.worker = worker;
    this.props = props;
    this.extractedText = extractedText;
    this.jobs = jobs;
    this.readOnlyTx = new TransactionTemplate(txManager);
    this.readOnlyTx.setReadOnly(true);
    this.writeTx = new TransactionTemplate(txManager);
  }

  /**
   * 파일 하나를 이미지로 보여 준다.
   *
   * @param fileId 코어 file.id — 호출자가 권한·소속을 확인한 값
   * @param page PDF 면 1부터 센 쪽 번호(필수), 이미지면 null(필수)
   * @throws AttachmentViewException 입력이 맞지 않거나 워커가 그리지 못했을 때(상태·코드·한국어 안내 포함)
   */
  public ViewImage view(long fileId, Integer page) {
    // ① 파일 행 — 짧은 읽기 전용 트랜잭션(RLS GUC 적용)
    Record3<String, String, Long> f =
        readOnlyTx.execute(
            st ->
                dsl.select(FILE.STORAGE_PATH, FILE.MIME_TYPE, FILE.SIZE_BYTES)
                    .from(FILE)
                    .where(FILE.ID.eq(fileId))
                    .fetchOne());
    if (f == null) throw new AttachmentViewException("NOT_FOUND");
    String storagePath = f.value1();
    String mime = baseMime(f.value2());
    boolean pdf = "application/pdf".equals(mime);

    // ② 워커에 가기 전에 거를 수 있는 것은 모두 거른다 — 워커 왕복·FastAPI 검증 실패(엉뚱한 안내)를 피한다.
    // SVG 는 image/* 지만 벡터 문서라 워커(Pillow)가 열지 못해 "손상·암호" 안내로 돌아오므로 여기서 형식 미지원으로 막는다.
    if (!pdf && (!mime.startsWith("image/") || "image/svg+xml".equals(mime))) {
      throw new AttachmentViewException("UNSUPPORTED");
    }
    if (pdf && page == null) throw new AttachmentViewException("PAGE_REQUIRED");
    if (!pdf && page != null) throw new AttachmentViewException("PAGE_NOT_ALLOWED");
    if (f.value3() > MAX_SOURCE_BYTES) throw new AttachmentViewException("TOO_LARGE");
    Integer known = pdf ? extractedText.pageCount(fileId) : null; // 자체 readOnly 트랜잭션
    if (pdf && (page < 1 || (known != null && page > known))) {
      throw new AttachmentViewException("PAGE_OUT_OF_RANGE", known);
    }

    // ③ 캐시 — 워커가 PNG 를 1MB 넘으면 JPEG 로 바꿔 주므로 확장자를 미리 모른다. 둘 다 본다.
    int maxEdge = props.render().maxEdge();
    String dir = storagePath + ".view/";
    String stem = pdf ? "p" + page + "-" + maxEdge : "img-" + maxEdge;
    for (String ext : List.of("png", "jpg")) {
      byte[] cached = readCache(dir + stem + "." + ext);
      if (cached != null) {
        return new ViewImage(cached, ext.equals("png") ? "image/png" : "image/jpeg", known);
      }
    }

    // ④ 워커 호출 — 어떤 트랜잭션 밖에서도(DB 연결을 잡지 않는다)
    RenderResult r;
    try {
      r = worker.render(storagePath, mime, page, maxEdge);
    } catch (AttachmentViewException e) {
      // 쪽수를 몰라 워커까지 갔다가 범위 밖으로 거절됐으면, 워커가 알려 준 쪽수를 채워 다음 요청은 워커 없이 거르게 한다.
      if (pdf && known == null && "PAGE_OUT_OF_RANGE".equals(e.code()) && e.pageCount() != null) {
        fillPageCount(fileId, e.pageCount());
      }
      throw e;
    }
    // 클라이언트가 형식을 image/png · image/jpeg 둘 중 하나로 맞춰 주므로 캐시 적중 때와 같은 값이 나간다.
    String ext = "image/png".equals(r.contentType()) ? ".png" : ".jpg";
    writeCache(dir + stem + ext, r.data());

    // ⑤ 추출이 아직 쪽수를 못 채웠으면(배포 전 추출·스캔 PDF) 워커가 알려 준 값으로 보충 — 짧은 쓰기 트랜잭션
    Integer pageCount = pdf ? (known != null ? known : r.pageCount()) : null;
    if (pdf && known == null && r.pageCount() != null) {
      fillPageCount(fileId, r.pageCount());
    }
    return new ViewImage(r.data(), r.contentType(), pageCount);
  }

  /** 비어 있는 page_count 만 채운다 — 짧은 쓰기 트랜잭션(RLS GUC 가 걸리게, 읽기 전용 안이 아니게). */
  private void fillPageCount(long fileId, int pageCount) {
    writeTx.executeWithoutResult(st -> jobs.fillPageCountIfMissing(fileId, pageCount));
  }

  /**
   * 캐시 파일을 읽는다. 없으면 null — 다시 그린다(exists 후 읽기 사이에 지워지는 경합도 같은 길로). 다른 읽기 실패도 캐시 없음으로 보고 경고만 남긴다 —
   * 캐시 디스크 문제로 보기 요청 전체가 500 이 되지 않게 한다.
   */
  private byte[] readCache(String rel) {
    try {
      return fileStore.readAllBytes(rel);
    } catch (UncheckedIOException e) {
      if (!(e.getCause() instanceof NoSuchFileException)) {
        log.warn("보기 캐시 읽기 실패 — 워커로 다시 그린다: path={}", rel, e);
      }
      return null;
    }
  }

  /** 캐시에 쓴다. 실패하면 경고만 남긴다 — 워커가 준 바이트는 이미 있으니 그대로 돌려준다(다음 요청이 다시 그릴 뿐). */
  private void writeCache(String rel, byte[] data) {
    try {
      fileStore.writeAtomically(rel, data);
    } catch (UncheckedIOException e) {
      log.warn("보기 캐시 쓰기 실패 — 캐시 없이 응답한다: path={}", rel, e);
    }
  }

  /** "application/pdf; charset=binary" → "application/pdf". null 이면 빈 문자열(→ 415). */
  private static String baseMime(String mime) {
    if (mime == null) return "";
    int semi = mime.indexOf(';');
    return (semi >= 0 ? mime.substring(0, semi) : mime).trim().toLowerCase(Locale.ROOT);
  }
}
