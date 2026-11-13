package com.workplace.drive.service;

/**
 * 채팅 앱 링크 카드용 폴더 정보(WP-1536) — 폴더 링크(/drive/spaces/{s}?folderId={id})를 보는 사람이 그 폴더를 열 수 있을 때만 만든다.
 * 카드에 보일 이름 둘만 담는다(목록·경로 등 폴더 내용은 싣지 않는다).
 *
 * @param name 폴더 이름
 * @param spaceName 폴더가 있는 드라이브 공간 이름
 */
public record DriveFolderLinkCard(String name, String spaceName) {}
