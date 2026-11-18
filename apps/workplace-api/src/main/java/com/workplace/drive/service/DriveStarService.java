package com.workplace.drive.service;

import com.workplace.drive.dto.DriveFolderResponse;
import com.workplace.drive.dto.DriveStarredItemResponse;
import com.workplace.drive.dto.DriveStarredPage;
import com.workplace.drive.exception.DriveFileNotFoundException;
import com.workplace.drive.exception.DriveFolderNotFoundException;
import com.workplace.drive.repository.DriveFileRepository;
import com.workplace.drive.repository.DriveFolderRepository;
import com.workplace.drive.repository.DriveStarRepository;
import com.workplace.drive.repository.DriveStarRepository.Cursor;
import com.workplace.drive.repository.DriveStarRepository.StarRow;
import com.workplace.global.time.CursorInstants;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.Function;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 드라이브 「별표」(WP-1698) — 파일·폴더에 별표를 넣고 빼고, 내 별표 목록(사이드바 「별표」)을 돌려준다. 늘 로그인한 사람 자신의 별표만 다룬다.
 *
 * <p>별표는 권한을 주지 않는다. 넣을 때는 그 항목을 지금 볼 수 있어야 하고(공간 실효 멤버 + 휴지통 아님), 볼 수 없으면 없는 항목과 같은 404 로 답해 id 를
 * 넣어 보는 것만으로 있는지 알 수 없게 한다. 목록은 읽을 때마다 같은 판정으로 다시 거른다.
 */
@Service
@RequiredArgsConstructor
public class DriveStarService {
  private final DriveStarRepository stars;
  private final DriveFileRepository files;
  private final DriveFolderRepository folders;
  private final DrivePermissions perms;

  /** 목록 한 페이지 기본 크기. */
  static final int PAGE_SIZE = 50;

  /** 커서 안 시각과 id 를 가르는 글자 — ISO-8601 시각에 쓰이지 않는다. */
  private static final char CURSOR_SEP = '~';

  /**
   * 별표 넣기(멱등) — 이미 별표했으면 그대로 둔다. 항목이 없거나, 휴지통에 있거나, 그 공간 구성원이 아니면 없는 항목과 같은 404(파일은 {@link
   * DriveFileNotFoundException}, 폴더는 {@link DriveFolderNotFoundException}). kind 와 id 가 어긋나도(폴더라며
   * 파일 id) 그 종류로 찾지 못해 같은 404 다. 보관된 공간도 볼 수 있으니 별표할 수 있다(별표는 공간 내용을 바꾸지 않는다).
   */
  @Transactional
  public void star(long userId, boolean folder, long targetId) {
    requireVisible(userId, folder, targetId);
    stars.star(userId, folder, targetId);
  }

  /** 별표 빼기 — 내 행만 지운다. 볼 수 없게 됐거나 별표가 없어도 조용히 끝난다(멱등 — 남의 항목 존재 여부를 드러내지 않는다). */
  @Transactional
  public void unstar(long userId, boolean folder, long targetId) {
    stars.unstar(userId, folder, targetId);
  }

  /**
   * 내 별표 목록 한 페이지(별표한 순). cursor 는 앞 페이지의 nextCursor — 형식이 틀리면 400(IllegalArgumentException). 경로는
   * 행이 닿는 폴더 사슬만 한 번에 읽어 만든다(행마다 묻지 않는다).
   */
  @Transactional(readOnly = true)
  public DriveStarredPage list(long userId, String cursor) {
    List<StarRow> rows = stars.listForUser(userId, parseCursor(cursor), PAGE_SIZE + 1);
    boolean more = rows.size() > PAGE_SIZE;
    List<StarRow> page = more ? rows.subList(0, PAGE_SIZE) : rows;
    Map<Long, DriveFolderResponse> chain =
        folders
            .listWithAncestors(
                page.stream().map(StarRow::parentFolderId).filter(Objects::nonNull).toList())
            .stream()
            .collect(Collectors.toMap(DriveFolderResponse::id, Function.identity(), (a, b) -> a));
    List<DriveStarredItemResponse> items =
        page.stream()
            .map(r -> toResponse(r, DriveFolderPaths.pathOf(r.parentFolderId(), chain), userId))
            .toList();
    String next = more ? encodeCursor(page.get(page.size() - 1)) : null;
    return new DriveStarredPage(items, next);
  }

  /** 넣기 전 판정 — 살아 있는 항목이고 그 공간을 볼 수 있어야 한다. 아니면 그 종류의 「없음」 404. */
  private void requireVisible(long userId, boolean folder, long targetId) {
    if (folder) {
      long spaceId =
          folders
              .findSpaceId(targetId)
              .orElseThrow(() -> new DriveFolderNotFoundException(targetId));
      // 비멤버의 「공간 없음」을 「폴더 없음」으로 바꿔 없는 id 와 같은 응답을 낸다.
      perms.hidingNonMember(
          () -> perms.requireRoleEvenIfArchived(spaceId, userId, "VIEWER"),
          () -> new DriveFolderNotFoundException(targetId));
      return;
    }
    long spaceId =
        files
            .findRow(targetId)
            .orElseThrow(() -> new DriveFileNotFoundException(targetId))
            .spaceId();
    perms.requireFileRoleEvenIfArchived(spaceId, userId, targetId, "VIEWER");
  }

  /** 저장소 한 줄 → 응답. */
  private static DriveStarredItemResponse toResponse(StarRow r, String path, long userId) {
    return new DriveStarredItemResponse(
        r.folder() ? "FOLDER" : "FILE",
        r.itemId(),
        r.name(),
        r.mimeType(),
        r.sizeBytes(),
        r.fileId(),
        r.category(),
        r.versionCount(),
        r.available(),
        r.folderCount(),
        r.fileCount(),
        r.parentFolderId(),
        path,
        r.spaceId(),
        // 내 개인 공간은 「내 드라이브」 그대로, 남의 것은 「{주인}의 드라이브」.
        DriveSpaceNames.displayName(
            r.spaceType(), r.spaceName(), r.spaceOwnerId(), r.spaceOwnerName(), userId),
        r.updatedAt(),
        r.starredAt());
  }

  /** 커서 문자열 → (시각, id). null 이면 첫 페이지. 형식·범위가 틀리면 IllegalArgumentException(전역 핸들러가 400). */
  static Cursor parseCursor(String raw) {
    if (raw == null || raw.isBlank()) return null;
    int sep = raw.lastIndexOf(CURSOR_SEP);
    if (sep <= 0) throw new IllegalArgumentException("목록 위치(cursor)가 올바르지 않습니다");
    try {
      OffsetDateTime at = CursorInstants.parse(raw.substring(0, sep)).atOffset(ZoneOffset.UTC);
      return new Cursor(at, Long.parseLong(raw.substring(sep + 1)));
    } catch (RuntimeException e) {
      throw new IllegalArgumentException("목록 위치(cursor)가 올바르지 않습니다", e);
    }
  }

  /** 페이지 마지막 행 → 커서. 시각은 Instant 문자열(마이크로초 보존 — 같은 밀리초 행을 건너뛰지 않게, WP-1618). */
  private static String encodeCursor(StarRow last) {
    return last.starredAt().toInstant().toString() + CURSOR_SEP + last.starId();
  }
}
