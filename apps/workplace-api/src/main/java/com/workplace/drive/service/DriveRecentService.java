package com.workplace.drive.service;

import com.workplace.drive.dto.DriveFolderResponse;
import com.workplace.drive.dto.DriveRecentFileResponse;
import com.workplace.drive.dto.DriveRecentPageResponse;
import com.workplace.drive.repository.DriveFileActivityRepository;
import com.workplace.drive.repository.DriveFileActivityRepository.ActivityRow;
import com.workplace.drive.repository.DriveFileActivityRepository.Cursor;
import com.workplace.drive.repository.DriveFolderRepository;
import com.workplace.drive.repository.DriveStarRepository;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 드라이브 「최근」(WP-1699) — 내가 열거나 올린 파일을 공간을 가로질러 최근 순으로 쪽 단위로 준다. 권한·휴지통 거르기는 저장소가 SQL 안에서 한다. 이 서비스는
 * 커서 해석, 한 쪽 더 읽어 다음 쪽 판정, 폴더 경로 한 번에 채우기, 공간 이름 규칙만 맡는다.
 */
@Service
@RequiredArgsConstructor
public class DriveRecentService {
  /** 한 쪽 크기이자 요청 limit 의 상한(기본값도 같다). */
  public static final int PAGE_SIZE = 50;

  private final DriveFileActivityRepository activities;
  private final DriveFolderRepository folders;
  private final DriveStarRepository stars;

  /**
   * 내 최근 한 쪽. limit 은 1~50 으로 자른다(null 이면 50). limit+1 줄을 읽어 남으면 다음 커서를 만든다.
   *
   * <p>결정: 해석할 수 없는 커서는 첫 쪽으로 되돌리지 않고 400(IllegalArgumentException)이다 — 조용히 첫 쪽을 주면 무한 스크롤이 같은 쪽을
   * 반복해 붙일 수 있다.
   */
  @Transactional(readOnly = true)
  public DriveRecentPageResponse list(long userId, String cursor, Integer limit) {
    int size = limit == null ? PAGE_SIZE : Math.max(1, Math.min(limit, PAGE_SIZE));
    Cursor after = decode(cursor);
    List<ActivityRow> rows = activities.listForUser(userId, after, size + 1);
    boolean hasNext = rows.size() > size;
    List<ActivityRow> page = hasNext ? rows.subList(0, size) : rows;
    Map<Long, DriveFolderResponse> chain = folderChain(page);
    // 별표(WP-1698) — 공간 화면 목록과 같이 이 쪽의 파일 id 로 한 번만 묻는다(줄마다 묻지 않는다). 「최근」은 파일만이라 폴더 id 는 비운다.
    Set<Long> starred =
        stars
            .starredAmong(userId, page.stream().map(ActivityRow::driveFileId).toList(), List.of())
            .fileIds();
    List<DriveRecentFileResponse> items =
        page.stream().map(r -> toResponse(r, userId, chain, starred)).toList();
    String next = hasNext ? encode(page.get(page.size() - 1)) : null;
    return new DriveRecentPageResponse(items, next);
  }

  /** 쪽 안 파일들의 폴더와 모든 조상을 쿼리 한 번(재귀 CTE)으로 읽는다 — 줄마다 조회하지 않는다. */
  private Map<Long, DriveFolderResponse> folderChain(List<ActivityRow> page) {
    Set<Long> ids = new HashSet<>();
    for (ActivityRow r : page) {
      if (r.folderId() != null) {
        ids.add(r.folderId());
      }
    }
    Map<Long, DriveFolderResponse> byId = new HashMap<>();
    for (DriveFolderResponse f : folders.listWithAncestors(ids)) {
      byId.put(f.id(), f);
    }
    return byId;
  }

  private DriveRecentFileResponse toResponse(
      ActivityRow r, long userId, Map<Long, DriveFolderResponse> chain, Set<Long> starred) {
    return new DriveRecentFileResponse(
        r.driveFileId(),
        r.name(),
        r.mimeType(),
        r.sizeBytes(),
        r.spaceId(),
        spaceName(r, userId),
        r.folderId(),
        DriveFolderPaths.segmentsOf(r.folderId(), chain),
        r.lastAction().name(),
        r.lastAt(),
        starred.contains(r.driveFileId()));
  }

  /** 공간 이름 — 규칙은 {@link DriveSpaceNames}. 내 개인 공간은 저장된 이름 그대로 둔다. */
  private static String spaceName(ActivityRow r, long userId) {
    return DriveSpaceNames.displayName(
        r.spaceType(), r.spaceName(), r.spaceOwnerId(), r.spaceOwnerName(), userId);
  }

  /** 커서 = lastAt 의 epoch 마이크로초 + "_" + id 를 base64url(패딩 없음). 마이크로초라야 DB 시각과 한 틱도 어긋나지 않는다. */
  static String encode(ActivityRow last) {
    Instant t = last.lastAt().toInstant();
    long micros = t.getEpochSecond() * 1_000_000L + t.getNano() / 1000;
    String raw = micros + "_" + last.id();
    return Base64.getUrlEncoder()
        .withoutPadding()
        .encodeToString(raw.getBytes(StandardCharsets.UTF_8));
  }

  /** 커서 해석. null·빈 값이면 첫 쪽(null), 깨졌으면 IllegalArgumentException(400). */
  static Cursor decode(String cursor) {
    if (cursor == null || cursor.isBlank()) {
      return null;
    }
    try {
      String raw = new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8);
      int sep = raw.indexOf('_');
      long micros = Long.parseLong(raw.substring(0, sep));
      long id = Long.parseLong(raw.substring(sep + 1));
      OffsetDateTime at =
          Instant.ofEpochSecond(
                  Math.floorDiv(micros, 1_000_000L), Math.floorMod(micros, 1_000_000L) * 1000)
              .atOffset(ZoneOffset.UTC);
      return new Cursor(at, id);
    } catch (RuntimeException e) {
      throw new IllegalArgumentException("잘못된 cursor 입니다.");
    }
  }
}
