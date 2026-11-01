package com.workplace.fileai.security;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.fileai.inbound.FileExtractionRequestedEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * 업로드 때 HTML 보안 점검을 자동으로 시작한다(WP-1262). 파일이 영구가 되는 시점에 나는 {@link
 * FileExtractionRequestedEvent}(드라이브· 이슈 첨부·챗 첨부 등)를 함께 듣는다.
 *
 * <p>{@link #onRequested} 는 업로드 트랜잭션 안에서 PENDING 행을 써 업로드와 함께 커밋·롤백되고, <b>이번에 행을 실제로 넣었을 때만</b> 커밋
 * 뒤 전용 실행기에 점검을 넘긴다 — 실패해도 행이 PENDING 으로 남아 스케줄러가 다시 줍는다. 예전엔 모든 HTML·범용 업로드 커밋 뒤에 점검을 돌려 메일 사본(내부
 * 카테고리)이 메일 요청 점검과 같은 행을 두고 다투고(바이너리가 지워진 뒤 FAILED missing-binary), 행이 없는 octet-stream 업로드마다 빈 점검이
 * 돌았다.
 *
 * <p>모든 업로드에 불리므로 mime 이 HTML 도 범용도 아니면 DB 를 보지 않고 바로 돌아간다.
 */
@Component
public class FileSecurityCheckListener {

  private final FileSecurityCheckRepository repo;
  private final FileSecurityCheckPipeline pipeline;
  private final AssistantResolver assistantResolver;
  private final FileSecurityCheckService service;

  public FileSecurityCheckListener(
      FileSecurityCheckRepository repo,
      FileSecurityCheckPipeline pipeline,
      AssistantResolver assistantResolver,
      FileSecurityCheckService service) {
    this.repo = repo;
    this.pipeline = pipeline;
    this.assistantResolver = assistantResolver;
    this.service = service;
  }

  /**
   * 업로드 트랜잭션 안에서 점검 행 생성. 내부 카테고리(메일 사본 — 바이너리가 곧 지워진다)·HTML 아님·AI 없는 워크스페이스는 행을 만들지 않는다. AI 없는 곳에
   * PENDING 을 만들면 화면이 「점검 중」에 영원히 머문다.
   */
  @EventListener
  public void onRequested(FileExtractionRequestedEvent e) {
    if (!mayBeHtml(e.mime())) return;
    // 트랜잭션 밖 발행은 추출 리스너가 이미 예외로 막는다 — 여기서는 조용히 건너뛴다.
    if (!TransactionSynchronizationManager.isActualTransactionActive()) return;
    var meta = repo.findFileMeta(e.fileId()).orElse(null);
    if (meta == null || meta.internal()) return;
    if (!HtmlScriptRules.isHtml(meta.mime(), meta.originalName())) return;
    if (assistantResolver.resolveWorkspaceOrEmpty().isEmpty()) return;
    if (!repo.insertPendingIfAbsent(e.fileId())) return;
    long fileId = e.fileId();
    // 커밋 뒤 실행기로 — 서비스가 제출·실패 로그를 맡는다(TenantContextTaskDecorator 가 테넌트를 워커로 옮긴다).
    service.runAfterCommit(fileId, () -> pipeline.check(fileId));
  }

  /** mime 만으로 HTML 일 수 있는지 — text/html 이거나 비었거나 범용이면 참(그때만 파일명을 본다). */
  private static boolean mayBeHtml(String mime) {
    return HtmlScriptRules.isHtml(mime, ".html");
  }
}
