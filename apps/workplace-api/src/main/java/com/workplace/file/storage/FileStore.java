package com.workplace.file.storage;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Comparator;
import java.util.stream.Stream;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.multipart.MultipartFile;

/**
 * 파일 디스크 I/O 단일 책임. 단일 루트(workplace.storage.root-dir) 기준으로 저장/읽기/삭제하며 DB 에 저장된 상대경로(또는 레거시 절대경로)를
 * 절대경로로 복원한다.
 */
@Slf4j
@Component
public class FileStore {

  /**
   * 이미지 보기 캐시(WP-250) 디렉터리 접미사 — 원본 "{storage_path}" 옆 "{storage_path}.view/" 에 둔다. 캐시를 쓰는
   * AttachmentViewService 와 원본과 함께 지우는 {@link #deleteWithDerived} 가 같은 규칙을 쓰도록 한 곳에 둔다.
   */
  private static final String VIEW_CACHE_SUFFIX = ".view";

  private final Path rootDir;

  public FileStore(@Value("${workplace.storage.root-dir:./file-data}") String rootDir) {
    this.rootDir = Path.of(rootDir).toAbsolutePath().normalize();
  }

  public Path rootDir() {
    return rootDir;
  }

  /** 상대/절대 경로를 절대경로로 복원. 상대경로는 루트 밖 탈출을 차단한다. */
  public Path resolve(String stored) {
    Path p = rootDir.resolve(stored).normalize();
    // Path.resolve 는 절대 인자를 그대로 통과시킨다(레거시 절대경로 호환).
    // 상대경로였다면 루트 밖으로 벗어나지 못하게 방어(시스템 생성 값이라 심층 방어 성격).
    if (!Path.of(stored).isAbsolute() && !p.startsWith(rootDir)) {
      throw new IllegalArgumentException("스토리지 루트 밖 경로 거부: " + stored);
    }
    return p;
  }

  /** 절대경로를 루트 기준 상대경로 문자열로 변환(썸네일 등록 등). */
  public String toRelative(Path absolute) {
    return rootDir.relativize(absolute.toAbsolutePath().normalize()).toString();
  }

  public void store(String relativePath, MultipartFile file) {
    try {
      Path target = resolve(relativePath);
      Files.createDirectories(target.getParent());
      file.transferTo(target.toFile());
    } catch (IOException e) {
      throw new UncheckedIOException("파일 저장 실패: " + relativePath, e);
    }
  }

  /** 디스크의 다른 파일(임시 파일 등)을 저장 경로로 복사한다(WP-369 — 업로드 링크 PUT 본문을 임시 파일로 받은 뒤 저장). 원본 정리는 호출부 몫이다. */
  public void storeFrom(String relativePath, Path source) {
    try {
      Path target = resolve(relativePath);
      Files.createDirectories(target.getParent());
      Files.copy(source, target);
    } catch (IOException e) {
      throw new UncheckedIOException("파일 저장 실패: " + relativePath, e);
    }
  }

  public void storeBytes(String relativePath, byte[] bytes) {
    try {
      Path target = resolve(relativePath);
      Files.createDirectories(target.getParent());
      Files.write(target, bytes);
    } catch (IOException e) {
      throw new UncheckedIOException("파일 저장 실패: " + relativePath, e);
    }
  }

  public void copy(String src, String destRelativePath) {
    try {
      Path target = resolve(destRelativePath);
      Files.createDirectories(target.getParent());
      Files.copy(resolve(src), target);
    } catch (IOException e) {
      throw new UncheckedIOException("파일 복사 실패: " + destRelativePath, e);
    }
  }

  public boolean deleteIfExists(String stored) {
    try {
      return Files.deleteIfExists(resolve(stored));
    } catch (IOException e) {
      throw new UncheckedIOException("파일 삭제 실패: " + stored, e);
    }
  }

  /**
   * 현재 트랜잭션이 롤백되면 방금 저장한 바이너리를 지운다 — 저장 뒤 DB 쓰기·커밋이 실패하면 FILE 행이 없어 만료 스윕이 찾지 못하는 고아 blob 이 남기
   * 때문이다. 트랜잭션 밖이면 등록하지 않는다. 삭제 실패는 경고만 남긴다(롤백 결과를 바꾸지 않는다).
   */
  public void deleteOnRollback(String relativePath) {
    if (!TransactionSynchronizationManager.isSynchronizationActive()) return;
    TransactionSynchronizationManager.registerSynchronization(
        new TransactionSynchronization() {
          @Override
          public void afterCompletion(int status) {
            if (status != STATUS_ROLLED_BACK) return;
            try {
              deleteIfExists(relativePath);
            } catch (RuntimeException e) {
              log.warn("롤백 바이너리 정리 실패(무시) path={}", relativePath, e);
            }
          }
        });
  }

  /**
   * 임시 파일에 다 쓴 뒤 이름 바꾸기로 한 번에 놓는다(WP-250 렌더 캐시). 같은 경로를 여러 요청이 동시에 써도 읽는 쪽은 언제나 온전한 파일 하나만 본다 — 마지막
   * 이름 바꾸기가 이기고, 반쯤 쓴 파일이 보이는 순간이 없다. 임시 파일은 같은 디렉터리에 둬야 원자적 이름 바꾸기가 된다(다른 파일시스템이면 안 된다).
   */
  public void writeAtomically(String relativePath, byte[] bytes) {
    Path target = resolve(relativePath);
    Path tmp = null;
    try {
      Files.createDirectories(target.getParent());
      tmp = Files.createTempFile(target.getParent(), ".tmp-", ".part");
      Files.write(tmp, bytes);
      Files.move(tmp, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
      tmp = null;
    } catch (IOException e) {
      throw new UncheckedIOException("파일 저장 실패: " + relativePath, e);
    } finally {
      // 이름 바꾸기 전에 실패했으면 임시 파일을 지운다(캐시 디렉터리에 찌꺼기가 쌓이지 않게).
      if (tmp != null) {
        try {
          Files.deleteIfExists(tmp);
        } catch (IOException ignored) {
          // 정리 실패는 원래 오류를 가리지 않게 무시한다.
        }
      }
    }
  }

  /** 파일 전체를 읽는다(렌더 캐시 적중 시). */
  public byte[] readAllBytes(String stored) {
    try {
      return Files.readAllBytes(resolve(stored));
    } catch (IOException e) {
      throw new UncheckedIOException("파일 읽기 실패: " + stored, e);
    }
  }

  /** 원본의 이미지 보기 캐시 디렉터리 경로(끝 "/" 없음) — "{storage_path}.view". */
  public static String viewCacheDir(String storagePath) {
    return storagePath + VIEW_CACHE_SUFFIX;
  }

  /**
   * 원본과 파생 파일(썸네일·이미지 보기 캐시)을 함께 지운다. 파생 파일은 DB 행이 없어 원본과 같이 지우지 않으면 영구 고아가 된다.
   *
   * <p>원본 삭제 실패는 {@link UncheckedIOException} 으로 던진다 — 만료 정리는 이때 DB 행을 남겨 다음 회차에 재시도하고, 첨부 삭제는 로그만
   * 남긴다. 파생 파일은 원본 성패와 무관하게 각각 best-effort 로 지운다(하나가 실패해도 나머지는 계속, 실패는 경고 로그 — 고아 파생 파일은 경미).
   *
   * @param thumbnailPath 썸네일 상대경로(없으면 null)
   */
  public void deleteWithDerived(String storagePath, String thumbnailPath) {
    try {
      deleteIfExists(storagePath);
    } finally {
      if (thumbnailPath != null) {
        try {
          deleteIfExists(thumbnailPath);
        } catch (RuntimeException e) {
          log.warn("썸네일 삭제 실패(무시): {}", thumbnailPath, e);
        }
      }
      try {
        deleteTreeIfExists(viewCacheDir(storagePath));
      } catch (RuntimeException e) {
        log.warn("이미지 보기 캐시 삭제 실패(무시): {}", viewCacheDir(storagePath), e);
      }
    }
  }

  /** 디렉터리를 통째로 지운다(원본 삭제 시 렌더 캐시 "{storage_path}.view/" 정리용). 없으면 아무것도 하지 않는다. */
  public void deleteTreeIfExists(String relativeDir) {
    Path dir = resolve(relativeDir);
    if (!Files.exists(dir)) {
      return;
    }
    // 깊은 경로부터 지워야 디렉터리가 비어 있다 — walk 결과를 역순으로.
    try (Stream<Path> paths = Files.walk(dir)) {
      for (Path p : paths.sorted(Comparator.reverseOrder()).toList()) {
        Files.deleteIfExists(p);
      }
    } catch (IOException e) {
      throw new UncheckedIOException("디렉터리 삭제 실패: " + relativeDir, e);
    }
  }

  public boolean exists(String stored) {
    return Files.exists(resolve(stored));
  }

  public long size(String stored) {
    try {
      return Files.size(resolve(stored));
    } catch (IOException e) {
      throw new UncheckedIOException("파일 크기 조회 실패: " + stored, e);
    }
  }
}
