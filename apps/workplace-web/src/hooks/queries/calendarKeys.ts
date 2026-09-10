export const calendarKeys = {
  all: ['calendar'] as const,
  range: (from: string, to: string) => ['calendar', 'events', { from, to }] as const,
  event: (id: number) => ['calendar', 'events', id] as const,
  calendars: ['calendar', 'calendars'] as const,
}
