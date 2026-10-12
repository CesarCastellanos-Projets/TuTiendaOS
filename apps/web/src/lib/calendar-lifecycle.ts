export function calendarDeadline(dueDate: string): number {
  return Date.parse(`${dueDate}T00:00:00-05:00`) + 86400000;
}

export function calendarExpired(dueDate: string, now: number): boolean {
  return calendarDeadline(dueDate) <= now;
}
