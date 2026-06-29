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
}
