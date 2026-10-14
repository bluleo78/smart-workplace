package com.workplace.file.storage;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mock.web.MockMultipartFile;

class FileStoreTest {

  @Test
  void store_thenResolveAndRead_roundTrip(@TempDir Path root) throws Exception {
    FileStore store = new FileStore(root.toString());
    store.store(
        "tenant-1/files/2026-06-29/a.txt",
        new MockMultipartFile("f", "a.txt", "text/plain", "hi".getBytes()));
    Path resolved = store.resolve("tenant-1/files/2026-06-29/a.txt");
    assertThat(Files.readString(resolved)).isEqualTo("hi");
    assertThat(resolved.startsWith(root.toAbsolutePath().normalize())).isTrue();
  }

  @Test
  void resolve_absoluteLegacyPath_passesThrough(@TempDir Path root) {
    FileStore store = new FileStore(root.toString());
    String legacyAbs = "/var/legacy/uploads/x.txt";
    assertThat(store.resolve(legacyAbs).toString())
        .isEqualTo(Path.of(legacyAbs).normalize().toString());
  }

  @Test
  void resolve_relativeTraversal_rejected(@TempDir Path root) {
    FileStore store = new FileStore(root.toString());
    assertThatThrownBy(() -> store.resolve("../../etc/passwd"))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void toRelative_returnsPathUnderRoot(@TempDir Path root) {
    FileStore store = new FileStore(root.toString());
    Path abs = root.resolve("tenant-2/issue/2026-06-29/b.png");
    assertThat(store.toRelative(abs)).isEqualTo("tenant-2/issue/2026-06-29/b.png");
  }

  @Test
  void deleteIfExists_removesFile(@TempDir Path root) throws Exception {
    FileStore store = new FileStore(root.toString());
    store.storeBytes("tenant-1/files/d/x.bin", new byte[] {1, 2, 3});
    assertThat(store.deleteIfExists("tenant-1/files/d/x.bin")).isTrue();
    assertThat(store.exists("tenant-1/files/d/x.bin")).isFalse();
  }

  /** 원자적 쓰기(WP-250 렌더 캐시): 상위 디렉터리를 만들고, 기존 파일을 통째로 바꾸며, 임시 파일을 남기지 않는다. */
  @Test
  void writeAtomically_createsParents_replaces_andLeavesNoTemp(@TempDir Path root)
      throws Exception {
    FileStore store = new FileStore(root.toString());
    String rel = "tenant-1/files/d/a.pdf.view/p1-1568.png";
    store.writeAtomically(rel, new byte[] {1, 2, 3});
    store.writeAtomically(rel, new byte[] {9, 8});

    assertThat(store.readAllBytes(rel)).containsExactly(9, 8);
    try (var files = Files.list(store.resolve("tenant-1/files/d/a.pdf.view"))) {
      assertThat(files.map(p -> p.getFileName().toString())).containsExactly("p1-1568.png");
    }
  }

  /** 디렉터리 통째 삭제(원본 삭제 시 렌더 캐시 정리용) — 없으면 조용히 넘어간다. */
  @Test
  void deleteTreeIfExists_removesDirectoryRecursively_andIgnoresMissing(@TempDir Path root) {
    FileStore store = new FileStore(root.toString());
    store.writeAtomically("t/a.pdf.view/p1-1568.png", new byte[] {1});
    store.writeAtomically("t/a.pdf.view/p2-1568.jpg", new byte[] {2});

    store.deleteTreeIfExists("t/a.pdf.view");

    assertThat(store.exists("t/a.pdf.view")).isFalse();
    assertThat(store.exists("t")).isTrue();
    store.deleteTreeIfExists("t/a.pdf.view"); // 두 번째는 대상이 없어도 예외 없음
  }

  /** 새 메서드도 resolve 의 루트 이탈 방지를 거친다. */
  @Test
  void newMethods_rejectRelativeTraversal(@TempDir Path root) {
    FileStore store = new FileStore(root.toString());
    assertThatThrownBy(() -> store.writeAtomically("../x.png", new byte[] {1}))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> store.readAllBytes("../x.png"))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> store.deleteTreeIfExists("../x"))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
