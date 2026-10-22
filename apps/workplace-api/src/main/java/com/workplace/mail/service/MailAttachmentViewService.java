package com.workplace.mail.service;

import com.workplace.fileai.dto.ExtractionInfo;
import com.workplace.fileai.dto.ViewImage;
import com.workplace.fileai.exception.AttachmentViewException;
import com.workplace.fileai.service.AttachmentViewService;
import com.workplace.fileai.service.ExtractedTextService;
import com.workplace.mail.exception.EmailAttachmentNotFoundException;
import com.workplace.mail.service.MailAttachmentResolver.Resolved;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 메일 첨부를 모델 입력용 이미지로 보여 준다(WP-388) — PDF 한 쪽 또는 이미지 변환본(HEIC·큰 이미지 축소). 다른 source 의 {@code
 * /view}(WP-250) 와 같은 응답·오류 코드다.
 *
 * <p>메일 첨부는 코어 file 행이 없고 원본이 메일 서버에 있다(디스크의 추출용 평문 사본은 추출 직후 지워진다). 그래서 요청마다 {@code /content} 와 같은
 * 길({@link MailAttachmentService#download} — 첨부 캐시 hit 이면 blob 복호화, miss 면 IMAP/Graph)로 바이트를 받아
 * {@link AttachmentViewService#viewTransient} 로 그린다. 바이트는 워커에 본문으로 보내고 디스크에는 아무것도 쓰지 않는다(렌더 캐시·file
 * 행·임시 파일 없음).
 *
 * <p><b>트랜잭션(R5)</b>: 클래스·메서드에 {@code @Transactional} 을 두지 않는다 — 워커 호출 동안 DB 연결을 잡지 않기 위해서다. 소유
 * 확인·메타 조회는 짧은 읽기 전용 {@link TransactionTemplate}(RLS GUC 적용), 바이트 확보는 {@code download} 자신의 트랜잭션,
 * 렌더는 트랜잭션 밖이다.
 */
@Service
public class MailAttachmentViewService {

  private final MailAttachmentResolver resolver;
  private final MailAttachmentService attachmentService;
  private final AttachmentViewService attachmentView;
  private final ExtractedTextService extractedText;
  private final TransactionTemplate readOnlyTx;

  /**
   * 메일 첨부 크기 상한 — 메일 첨부 추출(/text)과 같은 첨부 상한(기본 25MiB). 받기 전(목록 크기)과 받은 뒤(실제 바이트) 모두 이 값으로 거른다 —
   * 드라이브 PDF 상한(100MB, WP-803)은 메일 첨부에 적용하지 않는다.
   */
  @Value("${workplace.storage.attachment.max-file-size-bytes:26214400}")
  private long maxFileSize;

  public MailAttachmentViewService(
      MailAttachmentResolver resolver,
      MailAttachmentService attachmentService,
      AttachmentViewService attachmentView,
      ExtractedTextService extractedText,
      PlatformTransactionManager txManager) {
    this.resolver = resolver;
    this.attachmentService = attachmentService;
    this.attachmentView = attachmentView;
    this.extractedText = extractedText;
    this.readOnlyTx = new TransactionTemplate(txManager);
    this.readOnlyTx.setReadOnly(true);
  }

  /** 소유 확인 결과 + 추출 사본이 알아 둔 PDF 쪽수(모르면 null). */
  private record ViewMeta(Resolved resolved, Integer knownPageCount) {}

  /**
   * 첨부 하나를 이미지로 그린다. 권한은 {@code /content}·{@code /text} 와 같다 — 본인 소유(활성 계정) 첨부가 아니면 404(존재 은닉).
   *
   * @param page PDF 면 1부터 센 쪽 번호(필수), 이미지면 null(필수)
   * @throws EmailAttachmentNotFoundException 없거나 타인 소유일 때
   * @throws AttachmentViewException 형식·page·크기가 맞지 않거나 워커가 그리지 못했을 때
   */
  public ViewImage view(long userId, long attachmentId, Integer page) {
    // ① 소유 확인 + 메타 — provider 에서 원본을 가져오기 전에 고칠 수 없는 요청(형식·page·쪽 범위·과대)을 거른다(/text 가 구간을 먼저 보는
    // 것과 같은 이유).
    ViewMeta meta = readOnlyTx.execute(st -> loadMeta(userId, attachmentId));
    Resolved r = meta.resolved();
    // 쪽수를 알면(이전 /text 추출) 범위 밖 쪽을 받기 전에 거른다 — 워커·AttachmentViewService 와 같은 PAGE_OUT_OF_RANGE(쪽수
    // 포함).
    AttachmentViewService.validate(r.mime(), page, 0, meta.knownPageCount());
    if (r.exceedsBeforeFetch(maxFileSize)) throw new AttachmentViewException("TOO_LARGE");

    // ② 바이트 확보 — /content 와 같은 경로. ① 에서 소유를 확인한 컨텍스트를 넘겨 다시 조회하지 않는다. download 는 자기 트랜잭션을 열고 닫는다.
    byte[] content = attachmentService.download(userId, r.ctx()).content();
    // 목록 크기가 작게 기록된 첨부도 받은 바이트로 다시 판정한다 — 받기 전 검사와 같은 메일 첨부 상한.
    if (content.length > maxFileSize) throw new AttachmentViewException("TOO_LARGE");

    // ③ 렌더 — 트랜잭션 밖, 워커에 본문으로 보낸다(디스크에 쓰지 않는다).
    return attachmentView.viewTransient(content, r.mime(), page);
  }

  /** ① 의 조회 — 읽기 전용 트랜잭션 안에서 부른다(RLS GUC). 없거나 타인 소유면 404. */
  private ViewMeta loadMeta(long userId, long attachmentId) {
    Resolved r = resolver.resolve(userId, attachmentId);
    // 추출 사본의 바이너리는 추출 직후 지워지지만 file·추출 행은 만료(TTL)까지 남아 쪽수를 알려 준다. 사본이 만료돼 행이 없으면 null(워커가 판정).
    Long extractFileId = r.target() == null ? null : r.target().extractFileId();
    Integer pageCount = null;
    if (extractFileId != null) {
      ExtractionInfo info = extractedText.info(List.of(extractFileId)).get(extractFileId);
      if (info != null) pageCount = info.pageCount();
    }
    return new ViewMeta(r, pageCount);
  }
}
