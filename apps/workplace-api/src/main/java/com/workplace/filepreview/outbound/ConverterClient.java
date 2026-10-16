package com.workplace.filepreview.outbound;

import com.workplace.global.outbound.InternalHttp;
import com.workplace.global.outbound.InternalResponses;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * 문서 변환 서비스 {@code POST /convert/pdf} 동기 호출(WP-431) — HWP·HWPX·PPTX·PPT·DOC 원본을 PDF 로 바꿔 받는다.
 *
 * <p>오류 매핑(apps/workplace-converter/README.md 계약):
 *
 * <ul>
 *   <li>입력 문제 — 415 UNSUPPORTED, 413 TOO_LARGE, 422 TOO_MANY_PAGES·CONVERT_FAILED → 영구 실패(같은 원본은 다시
 *       해도 같다)
 *   <li>429 BUSY → 같은 작업 안에서 {@code busyRetries} 번 더 시도(대기 {@code busyBackoffMs × n}), 그래도 바쁘면 BUSY
 *       일시 실패
 *   <li>504 → TIMEOUT 일시 실패, 그 밖의 5xx(503 UNAVAILABLE·500 INTERNAL 등) → UNAVAILABLE 일시 실패
 *   <li>연결 실패·요청 타임아웃·401·상태와 코드가 어긋나거나 해석할 수 없는 응답 → UNAVAILABLE 일시 실패(API 쪽 결함 의심은 경고 로그)
 * </ul>
 *
 * <p>호출은 트랜잭션 밖에서 해야 한다(최대 timeoutSeconds 동안 DB 연결을 잡지 않게).
 */
@Component
public class ConverterClient {

  private static final Logger log = LoggerFactory.getLogger(ConverterClient.class);

  static final String BUSY = "BUSY";
  static final String TIMEOUT = "TIMEOUT";
  static final String UNAVAILABLE = "UNAVAILABLE";
  static final String TOO_LARGE = "TOO_LARGE";

  private final ConverterProperties props;
  private final HttpClient http;

  @Autowired
  public ConverterClient(ConverterProperties props) {
    // HTTP/1.1 고정 — InternalHttp 참조. 연결 타임아웃은 짧게(변환 서비스 다운을 빨리 일시 실패로).
    this(props, InternalHttp.httpClientBuilder().connectTimeout(Duration.ofSeconds(2)).build());
  }

  /** 테스트용 — HttpClient 주입. */
  ConverterClient(ConverterProperties props, HttpClient http) {
    this.props = props;
    this.http = http;
  }

  /**
   * 원본 파일 하나를 PDF 로 변환한다. 예외를 던지지 않고 결과를 값으로 돌려준다.
   *
   * @param source 원본 파일 경로 — 본문은 파일에서 바로 흘려 보낸다(100MB 를 힙에 올리지 않게)
   * @param mime 변환 서비스가 받는 정규형 mime(예: application/x-hwp)
   */
  public ConvertOutcome convertPdf(Path source, String mime) {
    long size;
    try {
      size = Files.size(source);
    } catch (IOException e) {
      // 원본을 읽을 수 없으면 변환 서비스 문제는 아니지만 일시 장애(볼륨 마운트 등)일 수 있어 일시 실패로 둔다.
      log.warn("변환 원본 크기 확인 실패: source={} error={}", source, e.toString());
      return new ConvertOutcome.Failure(UNAVAILABLE, true);
    }
    if (size > props.maxBytes()) {
      // 변환 서비스도 413 을 내겠지만 큰 본문을 보내기 전에 끊는다.
      return new ConvertOutcome.Failure(TOO_LARGE, false);
    }

    URI uri =
        URI.create(
            props.baseUrl()
                + "/convert/pdf?mime="
                + URLEncoder.encode(mime, StandardCharsets.UTF_8));
    // 첫 시도 + BUSY 재시도. 429 일 때만 다시 보낸다 — 다른 실패는 같은 작업 안에서 다시 해도 나아지지 않거나(영구) 다음 열람에 맡긴다(일시).
    for (int attempt = 0; ; attempt++) {
      ConvertOutcome outcome = sendOnce(uri, source, mime);
      boolean busy = outcome instanceof ConvertOutcome.Failure f && BUSY.equals(f.code());
      if (!busy || attempt >= props.busyRetries()) {
        return outcome;
      }
      try {
        Thread.sleep(props.busyBackoffMs() * (attempt + 1));
      } catch (InterruptedException e) {
        // 인터럽트 상태를 되살려 상위(종료·취소)가 알아차리게 한다.
        Thread.currentThread().interrupt();
        return new ConvertOutcome.Failure(UNAVAILABLE, true);
      }
    }
  }

  /** 한 번 보내고 응답을 결과로 바꾼다. */
  private ConvertOutcome sendOnce(URI uri, Path source, String mime) {
    HttpResponse<byte[]> resp;
    try {
      HttpRequest req =
          HttpRequest.newBuilder()
              .uri(uri)
              .timeout(Duration.ofSeconds(props.timeoutSeconds()))
              .header("Authorization", "Internal " + props.internalToken())
              .header("Content-Type", "application/octet-stream")
              // 시도마다 새 publisher — 파일에서 바로 읽어 보낸다.
              .POST(HttpRequest.BodyPublishers.ofFile(source))
              .build();
      resp = http.send(req, HttpResponse.BodyHandlers.ofByteArray());
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      return new ConvertOutcome.Failure(UNAVAILABLE, true);
    } catch (IOException e) {
      // 연결 거부·연결/요청 타임아웃(HttpTimeoutException 도 IOException)·원본 파일 읽기 실패
      log.warn("변환 호출 실패: mime={} source={} error={}", mime, source, e.toString());
      return new ConvertOutcome.Failure(UNAVAILABLE, true);
    }

    int status = resp.statusCode();
    if (status == 200) {
      return new ConvertOutcome.Success(resp.body(), InternalResponses.pageCount(resp));
    }
    if (status == 429) {
      return new ConvertOutcome.Failure(BUSY, true);
    }
    if (status == 504) {
      return new ConvertOutcome.Failure(TIMEOUT, true);
    }
    if (status >= 500) {
      // 503 UNAVAILABLE(soffice 기동 실패 등)·500 INTERNAL(예상 못한 오류) — 입력 문제가 아니므로 다음 열람 때 다시.
      log.warn(
          "변환 서비스 오류: status={} mime={} body={}",
          status,
          mime,
          InternalResponses.abbreviate(resp.body()));
      return new ConvertOutcome.Failure(UNAVAILABLE, true);
    }
    String code = InternalResponses.errorCode(resp.body());
    if (isPermanent(status, code)) {
      return new ConvertOutcome.Failure(code, false);
    }
    // 401(토큰 불일치)·상태와 코드가 어긋남·JSON 아님 — API 쪽 설정/결함 의심. 영구 실패로 굳히지 않는다.
    log.warn(
        "변환 거절을 해석할 수 없음(API 쪽 결함 의심): status={} code={} mime={} body={}",
        status,
        code,
        mime,
        InternalResponses.abbreviate(resp.body()));
    return new ConvertOutcome.Failure(UNAVAILABLE, true);
  }

  /** 계약상 입력 문제로 정해진 상태·코드 쌍만 영구 실패로 본다. */
  private static boolean isPermanent(int status, String code) {
    if (code == null) {
      return false;
    }
    return switch (status) {
      case 415 -> "UNSUPPORTED".equals(code);
      case 413 -> TOO_LARGE.equals(code);
      case 422 -> "TOO_MANY_PAGES".equals(code) || "CONVERT_FAILED".equals(code);
      default -> false;
    };
  }
}
