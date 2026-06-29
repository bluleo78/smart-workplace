package com.workplace.file.storage;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;

/**
 * 파일 디스크 I/O 단일 책임. 단일 루트(workplace.storage.root-dir) 기준으로 저장/읽기/삭제하며 DB 에 저장된 상대경로(또는 레거시 절대경로)를
 * 절대경로로 복원한다.
 */
@Component
public class FileStore {

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
