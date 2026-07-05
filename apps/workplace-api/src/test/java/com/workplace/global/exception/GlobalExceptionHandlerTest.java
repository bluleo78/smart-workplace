package com.workplace.global.exception;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.drive.exception.DriveInvalidTargetException;
import com.workplace.file.exception.FileNotFoundException;
import com.workplace.file.exception.FileSizeLimitExceededException;
import com.workplace.file.exception.UnsupportedUploadFileTypeException;
import com.workplace.global.dto.ErrorResponse;
import java.io.IOException;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;

/**
 * GlobalExceptionHandler 단위 테스트 — 클라이언트 연결 종료(Broken pipe 등) 노이즈 억제 검증.
 *
 * <p>의존성이 없는 @RestControllerAdvice 라 Spring 컨텍스트 없이 직접 인스턴스화한다.
 */
class GlobalExceptionHandlerTest {

  private final GlobalExceptionHandler handler = new GlobalExceptionHandler();
  private final MockHttpServletRequest request =
      new MockHttpServletRequest("GET", "/api/v1/messaging/stream");

  @Test
  void brokenPipe_는_무시되어_null_을_반환한다() {
    // SSE 스트림에 쓰다 클라이언트가 끊긴 경우 — ErrorResponse 직렬화를 시도하지 않는다.
    assertThat(handler.handleException(new IOException("Broken pipe"), request)).isNull();
  }

  @Test
  void 원인체인에_brokenPipe_가_있어도_무시한다() {
    Exception ex = new IllegalStateException("wrap", new IOException("Broken pipe"));
    assertThat(handler.handleException(ex, request)).isNull();
  }

  @Test
  void connectionReset_도_무시한다() {
    assertThat(handler.handleException(new IOException("Connection reset by peer"), request))
        .isNull();
  }

  @Test
  void 일반_예외는_500_을_반환한다() {
    ResponseEntity<ErrorResponse> res =
        handler.handleException(new RuntimeException("boom"), request);
    assertThat(res).isNotNull();
    assertThat(res.getStatusCode()).isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR);
    assertThat(res.getBody()).isNotNull();
  }

  @Test
  void executor_포화_TaskRejected_는_503_을_반환한다() {
    // wikiAiStreamExecutor 큐 포화 시 AbortPolicy → TaskRejectedException → 깔끔한 503.
    ResponseEntity<ErrorResponse> res =
        handler.handleTaskRejected(
            new org.springframework.core.task.TaskRejectedException("queue full"), request);
    assertThat(res).isNotNull();
    assertThat(res.getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
    assertThat(res.getBody()).isNotNull();
    assertThat(res.getBody().message()).contains("잠시 후");
  }

  @Test
  void 지원하지_않는_파일형식은_400_을_반환한다() {
    // #587: FileUploadService.uploadSingleFile()이 던지는 이 예외가 핸들러 부재로
    // Exception.class 폴백(500)에 떨어지던 회귀 방지.
    ResponseEntity<ErrorResponse> res =
        handler.handleUnsupportedUploadFileType(
            new UnsupportedUploadFileTypeException("application/x-msdownload"), request);
    assertThat(res.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(res.getBody()).isNotNull();
    assertThat(res.getBody().message()).contains("지원하지 않는 파일 형식");
  }

  @Test
  void 파일_크기_한도_초과는_400_을_반환한다() {
    // #587: 같은 이유로 500 폴백에 떨어지던 회귀 방지.
    ResponseEntity<ErrorResponse> res =
        handler.handleFileSizeLimitExceeded(
            new FileSizeLimitExceededException("IMAGE", 10L * 1024 * 1024), request);
    assertThat(res.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(res.getBody()).isNotNull();
    assertThat(res.getBody().message()).contains("IMAGE");
  }

  @Test
  void 이동_복사_대상이_자신의_하위폴더면_한국어_메시지로_400_을_반환한다() {
    // #594: DriveInvalidTargetException 이 개발자용 영문 메시지를 그대로 담아 던져
    // 프론트 토스트에 "invalid move/copy target: ..." 원문이 노출되던 회귀 방지.
    ResponseEntity<ErrorResponse> res =
        handler.handleDriveBadRequest(
            new DriveInvalidTargetException("폴더 자신 또는 하위 폴더로는 이동/복사할 수 없습니다."), request);
    assertThat(res.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(res.getBody()).isNotNull();
    assertThat(res.getBody().message()).doesNotContainIgnoringCase("invalid move/copy target");
    assertThat(res.getBody().message()).contains("하위 폴더로는 이동/복사할 수 없습니다");
  }

  @Test
  void 파일_코어_not_found_는_404_를_반환한다() {
    // #666: FileUploadService.getFileContentTrusted() 등이 blob 유실(디스크에 파일 없음) 시
    // 던지는 file 코어 FileNotFoundException 이 핸들러 부재로 Exception.class 폴백(500)에
    // 떨어지던 회귀 방지 — drive 미리보기/다운로드뿐 아니라 채팅·메일 첨부 등 공통 소비처에 영향.
    ResponseEntity<ErrorResponse> res =
        handler.handleFileNotFound(new FileNotFoundException(83L), request);
    assertThat(res.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    assertThat(res.getBody()).isNotNull();
    assertThat(res.getBody().message()).contains("83");
  }

  @Test
  void streamingGenerationNotFound_는_404_를_반환한다() {
    var ex = new com.workplace.global.exception.StreamingGenerationNotFoundException("corr-1");
    ResponseEntity<ErrorResponse> res = handler.handleStreamingGenerationNotFound(ex, request);
    assertThat(res.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    assertThat(res.getBody().message()).contains("corr-1");
  }

  @Test
  void streamingGenerationForbidden_는_403_을_반환한다() {
    var ex = new com.workplace.global.exception.StreamingGenerationForbiddenException("corr-2");
    ResponseEntity<ErrorResponse> res = handler.handleStreamingGenerationForbidden(ex, request);
    assertThat(res.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(res.getBody().message()).contains("corr-2");
  }
}
