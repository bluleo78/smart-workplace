package com.workplace.wiki.report;

import com.workplace.global.exception.CodedException;
import java.util.Map;
import org.springframework.http.HttpStatus;

/**
 * 「지금 생성」을 마치지 못했다(WP-1630) — 화면이 문구를 그대로 보이고 다시 시도하게 한다. 사유 코드는 {@code errors.code} 로 싣는다.
 *
 * <ul>
 *   <li>{@code REPORT_BUSY}(409): 정기 실행이나 다른 「지금 생성」이 같은 회차를 만드는 중
 *   <li>{@code NO_ASSISTANT}(409): 워크스페이스 공통 비서가 없어 AI 를 부를 수 없음(설정 상태)
 *   <li>{@code REPORT_FAILED}(502): 생성 실패(AI 오류·빈 글·상한 초과·노트 쓰기 실패) — 문구에 이유를 붙인다
 * </ul>
 */
public class ProjectReportGenerateException extends RuntimeException implements CodedException {

  private final HttpStatus status;
  private final String code;

  private ProjectReportGenerateException(HttpStatus status, String code, String message) {
    super(message);
    this.status = status;
    this.code = code;
  }

  /** 같은 회차를 만드는 중이다. */
  static ProjectReportGenerateException busy() {
    return new ProjectReportGenerateException(
        HttpStatus.CONFLICT, "REPORT_BUSY", "이미 리포트를 만드는 중이에요");
  }

  /** 공통 비서가 없다. */
  static ProjectReportGenerateException noAssistant() {
    return new ProjectReportGenerateException(
        HttpStatus.CONFLICT, "NO_ASSISTANT", "워크스페이스 AI 비서가 없어 리포트를 만들 수 없어요");
  }

  /** 생성 실패 — reason 은 사람이 읽을 이유(생성기가 남기는 실패 문구). */
  static ProjectReportGenerateException failed(String reason) {
    return new ProjectReportGenerateException(
        HttpStatus.BAD_GATEWAY, "REPORT_FAILED", "리포트를 만들지 못했어요 — " + reason);
  }

  @Override
  public HttpStatus status() {
    return status;
  }

  @Override
  public Map<String, String> errors() {
    return Map.of("code", code);
  }
}
