// 채널 미선택 시 안내. 사이드바에서 채널을 고르면 ChannelPage 로 이동.
export default function ChannelListPage() {
  return (
    <div
      className="flex h-full items-center justify-center text-muted-foreground"
      data-testid="channel-empty"
    >
      왼쪽에서 채널을 선택하세요.
    </div>
  )
}
