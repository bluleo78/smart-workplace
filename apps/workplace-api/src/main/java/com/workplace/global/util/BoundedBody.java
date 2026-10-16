package com.workplace.global.util;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.function.BiFunction;
import org.springframework.http.HttpStatus;

/**
 * 원시 요청 본문을 상한까지만 임시 파일에 받는 도우미 — 드라이브 업로드 링크(WP-369)와 스테이징 업로드 링크(WP-421)가 함께 쓴다.
 *
 * <p>원시 PUT 본문에는 멀티파트 상한이 걸리지 않고 Content-Length 가 없을 수도 있어(chunked), 세면서 복사하는 이 상한이 유일한 제한이다. 클라이언트
 * 쪽 실패(상한 초과·읽기 중단)는 호출자의 거부 예외(400)로, 서버 쪽 쓰기 실패는 IOException 그대로 돌려준다.
 */
public final class BoundedBody {

  private BoundedBody() {}

  /**
   * PUT 본문을 받아 둔 임시 파일. 닫으면(try-with-resources) 지운다 — 저장소에는 복사본이 들어간다.
   *
   * @param mimeType 매개변수를 뗀 Content-Type(없으면 null — 확장자로 정한다)
   */
  public record Received(Path path, long size, String mimeType) implements AutoCloseable {
    @Override
    public void close() {
      deleteQuietly(path);
    }
  }

  /**
   * 임시 디렉터리를 정하고 만든다. 값이 비면 java.io.tmpdir 로 대신한다. 만들 수 없거나 쓸 수 없으면 기동을 멈춘다 — 첫 업로드에서야 500 이 나는 것보다
   * 설정 오류를 바로 드러낸다. 읽기 전용 디렉터리면 기동은 되지만 모든 PUT 이 실패하므로 쓰기 가능 여부도 본다.
   *
   * @param configured 설정값(공백·null 이면 java.io.tmpdir)
   * @param propertyName 오류 문구에 드러낼 설정 키 — 운영자가 어느 값을 고쳐야 하는지 알게 한다
   * @throws IllegalStateException 디렉터리를 만들 수 없음(경로가 파일이거나 권한 없음 등) · 쓸 수 없음
   */
  public static Path prepareTempDir(String configured, String propertyName) {
    String value =
        configured == null || configured.isBlank()
            ? System.getProperty("java.io.tmpdir")
            : configured.strip();
    Path dir = Path.of(value).toAbsolutePath().normalize();
    try {
      Files.createDirectories(dir);
    } catch (IOException e) {
      throw new IllegalStateException(propertyName + " 디렉터리를 만들 수 없습니다: " + dir, e);
    }
    if (!Files.isWritable(dir)) {
      throw new IllegalStateException(propertyName + " 디렉터리에 쓸 수 없습니다: " + dir);
    }
    return dir;
  }

  /**
   * 본문을 상한까지 대상 파일에 복사하고 받은 바이트 수를 돌려준다. 클라이언트 쪽 실패는 {@code rejected}(상태·문구 → 호출자 예외)로 400 을 만든다 —
   * 두 링크의 문구가 같아 여기서 정한다. 링크는 이미 소비됐으므로 새 링크 발급을 안내한다.
   *
   * @param rejected 호출자의 거부 예외 생성자(드라이브·스테이징이 각자 예외 타입을 넘긴다)
   * @throws IOException 대상 파일 열기·쓰기·닫기 실패(서버 디스크) — 원인 그대로, 호출자가 500 으로 옮긴다
   */
  public static long copyWithCap(
      InputStream in,
      Path target,
      long cap,
      BiFunction<HttpStatus, String, ? extends RuntimeException> rejected)
      throws IOException {
    byte[] buf = new byte[64 * 1024];
    long total = 0;
    try (OutputStream out = Files.newOutputStream(target)) {
      while (true) {
        int n;
        try {
          n = in.read(buf);
        } catch (IOException e) {
          // 본문을 끝까지 읽지 못했다(클라이언트 중단 등) — 서버 잘못이 아니라 400.
          throw rejected.apply(HttpStatus.BAD_REQUEST, "업로드 본문을 끝까지 받지 못했습니다. 새 링크를 발급받으세요");
        }
        if (n < 0) {
          return total;
        }
        total += n;
        if (total > cap) {
          // 넘는 순간 끊는다.
          throw rejected.apply(
              HttpStatus.BAD_REQUEST, "파일이 너무 큽니다 (최대 " + toMb(cap) + "MB). 새 링크를 발급받으세요");
        }
        out.write(buf, 0, n);
      }
    }
  }

  /** 바이트를 MB(정수, 내림)로 — 상한 안내 문구("최대 25MB")에 쓴다. */
  public static long toMb(long bytes) {
    return bytes / (1024 * 1024);
  }

  /** 받아 둔 임시 파일을 지운다. 실패는 응답을 바꾸지 않는다(OS 임시 디렉터리 정리에 맡긴다). */
  public static void deleteQuietly(Path p) {
    try {
      Files.deleteIfExists(p);
    } catch (IOException ignored) {
      // 임시 파일 정리 실패는 무시한다.
    }
  }
}
