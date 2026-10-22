package com.workplace.fileai.service;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.FILE_EXTRACTION;

import com.workplace.file.service.FileUploadService;
import com.workplace.file.service.MimeNormalizer;
import com.workplace.file.storage.FileStore;
import com.workplace.fileai.dto.ViewImage;
import com.workplace.fileai.exception.AttachmentViewException;
import com.workplace.fileai.outbound.WorkerProperties;
import com.workplace.fileai.outbound.WorkerRenderClient;
import com.workplace.fileai.repository.WorkerJobRepository;
import java.io.UncheckedIOException;
import java.nio.file.NoSuchFileException;
import lombok.extern.slf4j.Slf4j;
import org.jooq.DSLContext;
import org.jooq.Record4;
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
 * <p><b>응답</b>: 도메인 컨트롤러 7곳(이슈·챗·노트·메시지·드라이브·홈·메일)의 {@code GET .../view} 가 {@code
 * ViewImageResponses.of(...)} 로 같은 응답을 낸다. 코어 file 행이 있는 6곳(이슈·챗·노트·메시지·드라이브·홈)은 {@code return
 * ViewImageResponses.of(attachmentView.view(service.resolveViewFileId(...), page));} 한 줄이다 — PDF 는
 * {@code ?page=N}(1부터), 이미지 파일은 page 없이 부르고, 권한은 그 도메인의 {@code /text} 와 같다. 도메인 가드({@code
 * resolveViewFileId}, 읽기 전용 트랜잭션)가 끝난 뒤 이 서비스를 부르므로 컨트롤러는 트랜잭션을 걸지 않는다(R5). file 행이 없는 메일 첨부
 * (WP-388)는 MailAttachmentViewService 가 원본을 받아 {@link #viewTransient} 로 저장 없이 그린다(캐시·page_count 보충
 * 없음).
 *
 * <p><b>캐시 실패</b>: 캐시는 성능용일 뿐이라 읽기·쓰기 실패(디스크 오류·권한 등)로 요청을 실패시키지 않는다 — 읽기 실패는 캐시 없음으로 보고 워커를 부르고,
 * 쓰기 실패는 경고만 남기고 워커가 준 바이트를 그대로 돌려준다.
 */
@Slf4j
@Service
public class AttachmentViewService {

  /** PDF 원본 상한 — PDF 업로드 상한과 같다(워커 config.DOC_MAX_BYTES 와도 맞춘다, WP-803). 넘으면 워커까지 가지 않고 413. */
  static final long PDF_MAX_SOURCE_BYTES = FileUploadService.sizeLimitOf("PDF");

  /** 이미지 원본 상한 — 워커 일반 상한(config.MAX_BYTES)과 같은 25MB. 넘으면 워커까지 가지 않고 413. */
  static final long IMAGE_MAX_SOURCE_BYTES = 25L * 1024 * 1024;

  private final DSLContext dsl;
  private final FileStore fileStore;
  private final WorkerRenderClient worker;
  private final WorkerProperties props;
  private final WorkerJobRepository jobs;
  private final TransactionTemplate readOnlyTx;
  private final TransactionTemplate writeTx;

  public AttachmentViewService(
      DSLContext dsl,
      FileStore fileStore,
      WorkerRenderClient worker,
      WorkerProperties props,
      WorkerJobRepository jobs,
      PlatformTransactionManager txManager) {
    this.dsl = dsl;
    this.fileStore = fileStore;
    this.worker = worker;
    this.props = props;
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
    // ① 파일 행 + 추출 행의 쪽수 — 한 번의 LEFT JOIN 을 짧은 읽기 전용 트랜잭션 하나로(RLS GUC 적용). 추출 행이 없으면 쪽수는 null.
    Record4<String, String, Long, Integer> f =
        readOnlyTx.execute(
            st ->
                dsl.select(
                        FILE.STORAGE_PATH,
                        FILE.MIME_TYPE,
                        FILE.SIZE_BYTES,
                        FILE_EXTRACTION.PAGE_COUNT)
                    .from(FILE)
                    .leftJoin(FILE_EXTRACTION)
                    .on(FILE_EXTRACTION.FILE_ID.eq(FILE.ID))
                    .where(FILE.ID.eq(fileId))
                    .fetchOne());
    if (f == null) throw new AttachmentViewException("NOT_FOUND");
    String storagePath = f.value1();
    // 저장된 mime 만 본다 — 옛 octet-stream HEIC·TIFF·BMP 는 V174 가 데이터에서 이미지 mime 으로 바로잡았다.
    String mime = MimeNormalizer.baseMime(f.value2());

    // ② 워커에 가기 전에 거를 수 있는 것은 모두 거른다(validate 참조). 쪽수는 PDF 일 때만 쓴다.
    boolean pdf = validate(mime, page, f.value3(), f.value4());
    Integer known = pdf ? f.value4() : null;

    // ③ 캐시 — 워커가 PNG 를 1MB 넘으면 JPEG 로 바꿔 주므로 확장자를 미리 모른다. 있는 쪽을 읽는다.
    int maxEdge = props.render().maxEdge();
    String stem =
        FileStore.viewCacheDir(storagePath) + "/" + (pdf ? "p" + page : "img") + "-" + maxEdge;
    for (ViewImage.Format format : ViewImage.Format.values()) {
      String path = stem + "." + format.extension();
      if (!fileStore.exists(path)) continue;
      byte[] cached = readCache(path);
      if (cached != null) return new ViewImage(cached, format.contentType(), known);
    }

    // ④ 워커 호출 — 어떤 트랜잭션 밖에서도(DB 연결을 잡지 않는다)
    ViewImage r;
    try {
      r = worker.render(storagePath, mime, page, maxEdge);
    } catch (AttachmentViewException e) {
      // 쪽수를 몰라 워커까지 갔다가 범위 밖으로 거절됐으면, 워커가 알려 준 쪽수를 채워 다음 요청은 워커 없이 거르게 한다.
      if (pdf && "PAGE_OUT_OF_RANGE".equals(e.code())) learnPageCount(fileId, known, e.pageCount());
      throw e;
    }
    // 클라이언트가 형식을 image/png · image/jpeg 둘 중 하나로 맞춰 주므로 캐시 적중 때와 같은 값이 나간다(PNG 가 아니면 jpg).
    ViewImage.Format format =
        ViewImage.Format.ofMime(r.contentType()) == ViewImage.Format.PNG
            ? ViewImage.Format.PNG
            : ViewImage.Format.JPEG;
    writeCache(stem + "." + format.extension(), r.data());

    // ⑤ 추출이 아직 쪽수를 못 채웠으면(배포 전 추출·스캔 PDF) 워커가 알려 준 값으로 보충한다.
    Integer pageCount = pdf ? learnPageCount(fileId, known, r.pageCount()) : null;
    return new ViewImage(r.data(), r.contentType(), pageCount);
  }

  /**
   * 워커에 가기 전에 거를 수 있는 입력을 모두 거른다 — 워커 왕복·FastAPI 검증 실패(엉뚱한 안내)를 피한다. {@link #view} 와 저장하지 않는 보기
   * ({@link #viewTransient}, 메일 첨부)가 같은 규칙·오류 코드를 쓰게 한 곳에 둔다. 메일은 원본을 provider 에서 가져오기 전에도 부른다(크기 0
   * 으로 형식·page 만 먼저 확인 — 고칠 수 없는 요청이 IMAP/Graph 왕복을 일으키지 않게).
   *
   * <p>SVG 는 image/* 지만 벡터 문서라 워커(Pillow)가 열지 못해 "손상·암호" 안내로 돌아오므로 여기서 형식 미지원으로 막는다.
   *
   * @param mime 파라미터를 뗀 소문자 mime
   * @param page PDF 면 1부터 센 쪽 번호(필수), 이미지면 null(필수)
   * @param sizeBytes 원본 바이트 수 — PDF 는 PDF_MAX_SOURCE_BYTES, 이미지는 IMAGE_MAX_SOURCE_BYTES 를 넘으면
   *     TOO_LARGE
   * @param knownPageCount 이미 아는 PDF 쪽수(모르면 null — 그때 상한 검사는 워커가 한다). PDF 가 아니면 무시한다
   * @return PDF 인지(아니면 이미지) — 호출자가 mime 을 다시 판정하지 않게
   * @throws AttachmentViewException 형식·page·크기가 맞지 않을 때
   */
  public static boolean validate(
      String mime, Integer page, long sizeBytes, Integer knownPageCount) {
    boolean pdf = "application/pdf".equals(mime);
    if (!pdf && (!mime.startsWith("image/") || "image/svg+xml".equals(mime))) {
      throw new AttachmentViewException("UNSUPPORTED");
    }
    if (pdf && page == null) throw new AttachmentViewException("PAGE_REQUIRED");
    if (!pdf && page != null) throw new AttachmentViewException("PAGE_NOT_ALLOWED");
    if (sizeBytes > (pdf ? PDF_MAX_SOURCE_BYTES : IMAGE_MAX_SOURCE_BYTES))
      throw new AttachmentViewException("TOO_LARGE");
    if (pdf && (page < 1 || (knownPageCount != null && page > knownPageCount))) {
      throw new AttachmentViewException("PAGE_OUT_OF_RANGE", knownPageCount);
    }
    return pdf;
  }

  /**
   * 코어 file 행이 없는 원본 바이트(메일 첨부, WP-388)를 이미지로 그린다 — 아무것도 남기지 않는다. 바이트를 워커 {@code /render/bytes}
   * 본문으로 보내 그리게 한다: 메일 원본은 복호화한 평문이라 공유 저장소에 임시 파일로도 쓰지 않는다(렌더 중 프로세스가 죽으면 평문 사본이 남는다).
   *
   * <p>{@link #view} 와 달리 ".view" 렌더 캐시를 쓰지 않고 page_count 도 채우지 않는다(채울 file 행이 없다). 쪽수 상한은 워커가 거절하며
   * 알려 준다(PAGE_OUT_OF_RANGE + pageCount — 다른 source 의 첫 요청과 같은 응답).
   *
   * <p>트랜잭션 밖에서 불러야 한다(R5 — 워커 호출 동안 DB 연결을 잡지 않게). DB·디스크를 읽지도 쓰지도 않는다.
   *
   * @param data 원본 바이트 — 호출자가 권한을 확인하고 가져온 값
   * @param mime 파라미터를 뗀 소문자 mime(호출자가 파일명 보정까지 마친 값)
   * @param page PDF 면 1부터 센 쪽 번호(필수), 이미지면 null(필수)
   * @throws AttachmentViewException 입력이 맞지 않거나 워커가 그리지 못했을 때
   */
  public ViewImage viewTransient(byte[] data, String mime, Integer page) {
    validate(mime, page, data.length, null);
    return worker.renderBytes(data, mime, page, props.render().maxEdge());
  }

  /**
   * PDF 쪽수 — 이미 알면 그 값, 모르면 워커가 알려 준 값(reported, 없으면 null)을 비어 있는 page_count 에 채우고 돌려준다. 채우기는 짧은 쓰기
   * 트랜잭션이다(RLS GUC 가 걸리게, 읽기 전용 안이 아니게).
   */
  private Integer learnPageCount(long fileId, Integer known, Integer reported) {
    if (known != null) return known;
    if (reported != null) {
      writeTx.executeWithoutResult(st -> jobs.fillPageCountIfMissing(fileId, reported));
    }
    return reported;
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
}
