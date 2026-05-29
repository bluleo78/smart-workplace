// chat 메시지 시간 표시: 오늘이면 HH:mm, 어제면 '어제 HH:mm', 그 외는 'M월 D일'.
// 시각 검증용으로만 사용 — 정확한 표시는 후속 polish 영역.

export function formatChatTimestamp(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) {
    return `어제 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}
