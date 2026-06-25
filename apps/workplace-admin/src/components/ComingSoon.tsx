// 아직 구현되지 않은 운영 메뉴의 준비중 플레이스홀더.
export function ComingSoon({ title }: { title: string }) {
  return (
    <div
      className="flex min-h-[50vh] flex-col items-center justify-center gap-2 text-center"
      data-testid="coming-soon"
    >
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">준비중입니다.</p>
    </div>
  )
}
