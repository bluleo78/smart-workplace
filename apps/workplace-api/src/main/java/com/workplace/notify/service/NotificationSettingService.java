package com.workplace.notify.service;

import com.workplace.notify.dto.NotificationActor;
import com.workplace.notify.dto.NotificationApp;
import com.workplace.notify.dto.NotificationSettingItem;
import com.workplace.notify.dto.NotificationSettingsResponse;
import com.workplace.notify.dto.NotificationSettingsResponse.AppSettings;
import com.workplace.notify.dto.NotificationSettingsResponse.ItemSettings;
import com.workplace.notify.dto.UpdateNotificationSettingsRequest;
import com.workplace.notify.dto.UpdateNotificationSettingsRequest.CellChange;
import com.workplace.notify.exception.NotificationSettingCellNotFoundException;
import com.workplace.notify.repository.NotificationRepository;
import com.workplace.notify.repository.NotificationSettingRepository;
import com.workplace.notify.repository.NotificationSettingRepository.CellKey;
import com.workplace.user.dto.UserKind;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 앱·항목·행위자별 알림 설정. 기본값은 {@link NotificationSettingItem} 상수, DB 에는 사용자가 바꾼 칸과 앱 스위치만 있다. 설정 화면의
 * 조회·수정과, 알림을 만들기 전 수신자를 거르는 판정({@link #filterRecipients})을 함께 맡는다 — 화면이 보여 주는 값과 실제 판정이 한 곳의 규칙을
 * 따르게 하려는 것.
 */
@Service
@RequiredArgsConstructor
public class NotificationSettingService {

  private final NotificationSettingRepository repo;
  private final NotificationRepository notifications;

  /** 설정 전체 — 앱 스위치는 저장값 또는 켜짐, 칸은 저장값 또는 기본값(칸 없는 쪽은 null). */
  @Transactional(readOnly = true)
  public NotificationSettingsResponse get(long userId) {
    Map<NotificationApp, Boolean> apps = repo.findApps(userId);
    Map<CellKey, Boolean> cells = repo.findCells(userId);
    List<AppSettings> out = new ArrayList<>();
    for (NotificationApp app : NotificationApp.values()) {
      List<ItemSettings> items = new ArrayList<>();
      for (NotificationSettingItem item : NotificationSettingItem.values()) {
        if (item.app() != app) continue;
        items.add(
            new ItemSettings(
                item,
                cellValue(cells, item, NotificationActor.HUMAN),
                cellValue(cells, item, NotificationActor.AGENT)));
      }
      out.add(new AppSettings(app, apps.getOrDefault(app, true), items));
    }
    return new NotificationSettingsResponse(out);
  }

  /** 부분 수정 후 전체 반환. 모든 칸을 먼저 검증하고 하나라도 없는 칸이면 아무것도 저장하지 않고 400 — 일부만 저장된 채 실패하는 일을 막는다. */
  @Transactional
  public NotificationSettingsResponse update(long userId, UpdateNotificationSettingsRequest req) {
    List<CellChange> cells = req.cells() == null ? List.of() : req.cells();
    for (CellChange c : cells) {
      if (!c.item().has(c.actor())) throw new NotificationSettingCellNotFoundException();
    }
    if (req.apps() != null) {
      req.apps().forEach((app, enabled) -> repo.upsertApp(userId, app, enabled));
    }
    for (CellChange c : cells) repo.upsertCell(userId, c.item(), c.actor(), c.enabled());
    return get(userId);
  }

  /**
   * 그 알림을 받겠다고 설정한 수신자만(입력 순서 유지). 행위자 열은 actorId 의 kind 로 고르고(없으면 「사람이」), 칸이 없는 쪽이면 하나뿐인 칸으로 보낸다.
   * AGENT 수신자는 설정을 적용하지 않는다(AI 는 항상 받는다 — 작업 흐름이 알림에 기대므로). 사람 수신자는 앱 스위치가 켜져 있고 칸 값(저장값 또는 기본값)이
   * 켜짐이어야 통과한다. 쿼리는 수신자 수와 무관하게 많아야 3개(kind·앱·칸)다. 호출측 트랜잭션에 합류한다.
   */
  @Transactional(readOnly = true)
  public List<Long> filterRecipients(
      List<Long> recipientIds, NotificationSettingItem item, Long actorId) {
    return filterRecipients(recipientIds, item, actorId, Map.of());
  }

  /**
   * 위와 같고, 호출자가 이미 아는 사용자 종류(id → HUMAN·AGENT)를 받는다 — 채널 멤버 목록처럼 종류를 함께 읽어 둔 호출자가 같은 사용자의 종류를 다시
   * 조회하지 않게. knownKinds 에 없는 수신자·행위자만 조회하므로, 모두 알면 종류 쿼리는 0개다.
   */
  @Transactional(readOnly = true)
  public List<Long> filterRecipients(
      List<Long> recipientIds,
      NotificationSettingItem item,
      Long actorId,
      Map<Long, String> knownKinds) {
    if (recipientIds.isEmpty()) return recipientIds;
    Map<Long, String> kinds = new HashMap<>(knownKinds);
    Set<Long> unknown = new HashSet<>(recipientIds);
    if (actorId != null) unknown.add(actorId);
    unknown.removeAll(kinds.keySet());
    if (!unknown.isEmpty()) kinds.putAll(notifications.findKinds(unknown));

    NotificationActor actual =
        actorId != null && UserKind.isAgent(kinds.get(actorId))
            ? NotificationActor.AGENT
            : NotificationActor.HUMAN;
    NotificationActor column = item.column(actual);

    List<Long> humans =
        recipientIds.stream().filter(id -> !UserKind.isAgent(kinds.get(id))).toList();
    Set<Long> appOff = repo.findAppDisabledUsers(humans, item.app());
    Map<Long, Boolean> values = repo.findCellValues(humans, item, column);
    boolean def = item.defaultFor(column);

    return recipientIds.stream()
        .filter(
            id ->
                UserKind.isAgent(kinds.get(id))
                    || (!appOff.contains(id) && values.getOrDefault(id, def)))
        .toList();
  }

  /** 칸이 있으면 저장값 또는 기본값, 없으면 null. */
  private static Boolean cellValue(
      Map<CellKey, Boolean> cells, NotificationSettingItem item, NotificationActor actor) {
    if (!item.has(actor)) return null;
    return cells.getOrDefault(new CellKey(item, actor), item.defaultFor(actor));
  }
}
