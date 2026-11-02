package com.workplace.wiki.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.service.AssistantResolver;
import com.workplace.fileai.security.FileSecurityCheckExecutorConfig;
import com.workplace.fileai.security.FileSecurityCheckService;
import com.workplace.fileai.security.ScriptDigest;
import com.workplace.fileai.security.dto.SecurityCheckView;
import com.workplace.global.util.AfterCommit;
import com.workplace.jooq.tables.records.WikiHtmlScriptsCheckRecord;
import com.workplace.wiki.dto.WikiHtmlScriptsCheckResponse;
import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.repository.WikiHtmlScriptsCheckRepository;
import java.util.List;
import java.util.concurrent.Executor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 노트 HTML 블록 보안 점검 조회·요청(WP-1290). 페이지의 스크립트가 든 HTML 소스({@link WikiHtmlScriptSources})를 (페이지, 지문)으로
 * 묶어 파일 점검과 같은 상태 기계·판정 기준·실행기로 점검한다.
 *
 * <ul>
 *   <li>{@link #view} — 읽기만(행을 만들지 않는다). 앱 화면이 지금 상태를 볼 때.
 *   <li>{@link #request} — 행이 없으면 만들고 FAILED·SKIPPED·지난 기준의 DONE 은 PENDING 으로 되돌려 커밋 뒤 점검(↻·공유 창의
 *       게시 전 점검).
 *   <li>{@link #ensureForPublic} — 공개 보기: 행이 없을 때만 만든다(익명 요청이 다시 점검을 강제하지 못하게 기존 행은 건드리지 않는다).
 * </ul>
 *
 * <p>요청은 트랜잭션 안에서 상태만 바꾸고, 점검은 커밋 뒤 파일 점검 전용 실행기로 넘긴다(LLM 호출이 요청 스레드·DB 커넥션을 쥐지 않게).
 */
@Slf4j
@Service
public class WikiHtmlScriptsCheckService {

  /** 이은 소스 크기 상한(글자) — 넘으면 AI 를 부르지 않고 FAILED(too-large). */
  static final int MAX_SOURCE_CHARS = 5 * 1024 * 1024;

  private final WikiHtmlScriptsCheckRepository repo;
  private final WikiHtmlScriptsCheckPipeline pipeline;
  private final WikiPageService pageService;
  private final AssistantResolver assistantResolver;
  private final ObjectMapper objectMapper;
  private final Executor executor;

  public WikiHtmlScriptsCheckService(
      WikiHtmlScriptsCheckRepository repo,
      WikiHtmlScriptsCheckPipeline pipeline,
      WikiPageService pageService,
      AssistantResolver assistantResolver,
      ObjectMapper objectMapper,
      @Qualifier(FileSecurityCheckExecutorConfig.EXECUTOR) Executor executor) {
    this.repo = repo;
    this.pipeline = pipeline;
    this.pageService = pageService;
    this.assistantResolver = assistantResolver;
    this.objectMapper = objectMapper;
    this.executor = executor;
  }

  /** 저장된 내용의 점검 상태 — 페이지를 볼 수 있어야 한다(멤버 또는 공유 토큰). 행을 만들지 않는다. */
  @Transactional(readOnly = true)
  public WikiHtmlScriptsCheckResponse view(long callerId, long pageId, String shareToken) {
    WikiPageDetail detail = pageService.get(callerId, pageId, shareToken);
    List<String> sources = WikiHtmlScriptSources.of(detail.kind(), detail.body(), detail.html());
    if (sources.isEmpty()) return WikiHtmlScriptsCheckResponse.NONE;
    String joined = WikiHtmlScriptSources.joined(sources);
    String hash = WikiHtmlScriptSources.sha256Hex(joined);
    boolean hasAi = aiAvailable();
    return respond(pageId, hash, sources.size(), repo.find(pageId, hash).orElse(null), hasAi);
  }

  /**
   * 저장된 내용의 점검 요청 — 페이지를 볼 수 있어야 한다. 행이 없거나 FAILED(크기 초과 제외)·SKIPPED·지난 기준의 DONE 이면 PENDING 으로 만들고
   * 커밋 뒤 점검한다. AI 가 없으면 행을 만들지 않고 reason NO_AI.
   */
  @Transactional
  public WikiHtmlScriptsCheckResponse request(long callerId, long pageId, String shareToken) {
    WikiPageDetail detail = pageService.get(callerId, pageId, shareToken);
    return ensure(
        pageId, WikiHtmlScriptSources.of(detail.kind(), detail.body(), detail.html()), true);
  }

  /**
   * 공개 보기의 점검 상태(지연 요청) — 호출부가 공유 판정과 공개 본문(가린 마크다운)으로 뽑은 소스를 넘긴다. AI 가 있고 그 지문의 행이 없을 때만 PENDING
   * 행을 만들어 커밋 뒤 점검한다. 기존 행(FAILED 포함)은 되돌리지 않는다 — 익명 호출이 다시 점검(AI 비용)을 강제하지 못하게. 호출부 트랜잭션에 합류한다.
   */
  @Transactional
  public WikiHtmlScriptsCheckResponse ensureForPublic(long pageId, List<String> sources) {
    return ensure(pageId, sources, false);
  }

  /**
   * 행을 보장하고(요청이면 되돌림까지) 응답한다. 요청(reset)이면 PENDING 일 때, 공개 보기면 이번 호출이 행을 새로 만들었을 때만 커밋 뒤 점검을 깨운다 —
   * 익명 폴링(3초)마다 PENDING 행을 실행기에 다시 넣어 드라이브 파일 점검과 함께 쓰는 큐를 채우지 않게(남은 PENDING 은 스케줄러가 줍는다).
   */
  private WikiHtmlScriptsCheckResponse ensure(long pageId, List<String> sources, boolean reset) {
    if (sources.isEmpty()) return WikiHtmlScriptsCheckResponse.NONE;
    String joined = WikiHtmlScriptSources.joined(sources);
    String hash = WikiHtmlScriptSources.sha256Hex(joined);
    int blockCount = sources.size();
    if (!aiAvailable()) {
      return respond(pageId, hash, blockCount, repo.find(pageId, hash).orElse(null), false);
    }
    WikiHtmlScriptsCheckRecord row = repo.find(pageId, hash).orElse(null);
    boolean wake = reset;
    if (row == null) {
      if (joined.length() > MAX_SOURCE_CHARS) {
        // 크기 초과 — AI 를 부르지 않고 바로 FAILED. 지문이 같으면 내용이 같아 다시 해도 같으므로 되돌림 대상도 아니다.
        repo.insertTooLargeIfAbsent(pageId, hash, blockCount);
      } else {
        // 요지는 행이 없을 때만 만든다 — 지문이 같으면 요지도 같다.
        ScriptDigest.Result digest = ScriptDigest.build(joined);
        wake =
            repo.insertPendingIfAbsent(pageId, hash, blockCount, digest.text(), digest.truncated())
                || wake;
      }
    } else if (reset) {
      repo.resetToPending(pageId, hash);
    }
    // 새로 넣었거나 되돌렸을 때만 다시 읽는다.
    if (row == null || reset) row = repo.find(pageId, hash).orElse(null);
    if (wake && row != null && "PENDING".equals(row.getStatus())) {
      runAfterCommit(pageId, hash);
    }
    return respond(pageId, hash, blockCount, row, true);
  }

  /** 워크스페이스에 AI(비서)가 있는지. */
  private boolean aiAvailable() {
    return assistantResolver.resolveWorkspaceOrEmpty().isPresent();
  }

  /**
   * 커밋 뒤 전용 실행기로 점검을 넘긴다. 큐가 넘치면 실행기가 버리고 행은 PENDING 으로 남아 스케줄러가 다시 줍는다. TenantContext 는
   * TenantContextTaskDecorator 가 워커로 옮긴다.
   */
  private void runAfterCommit(long pageId, String hash) {
    AfterCommit.run(
        () ->
            executor.execute(
                () -> {
                  try {
                    pipeline.check(pageId, hash);
                  } catch (RuntimeException e) {
                    log.warn("노트 HTML 보안 점검 처리 실패 — 행은 PENDING 으로 남는다: pageId={}", pageId, e);
                  }
                }));
  }

  /** 행 → 응답 — 상태 판정은 파일 점검과 같은 규칙({@link FileSecurityCheckService#viewOf}). */
  private WikiHtmlScriptsCheckResponse respond(
      long pageId, String hash, int blockCount, WikiHtmlScriptsCheckRecord row, boolean hasAi) {
    SecurityCheckView view =
        row == null
            ? FileSecurityCheckService.viewOf(null, null, null, List.of(), null, null, null, hasAi)
            : FileSecurityCheckService.viewOf(
                row.getStatus(),
                row.getRisk(),
                row.getHeadline(),
                FileSecurityCheckService.parseEvidence(
                    objectMapper, row.getEvidence(), "pageId=" + pageId),
                row.getCheckedAt(),
                row.getError(),
                row.getCriteriaVersion(),
                hasAi);
    return new WikiHtmlScriptsCheckResponse(hash, blockCount, view);
  }
}
