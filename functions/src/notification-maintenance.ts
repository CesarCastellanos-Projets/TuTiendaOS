export async function runNotificationMaintenance(calendar: () => Promise<void>, replenishments: () => Promise<void>, transient: () => Promise<void> = async () => undefined): Promise<void> {
  const results = await Promise.allSettled([
    Promise.resolve().then(calendar),
    Promise.resolve().then(replenishments),
    Promise.resolve().then(transient)
  ]);
  const failed = results.flatMap((result, index) => {
    if (result.status === 'fulfilled') return [];
    console.error('Mantenimiento de notificaciones pendiente', {
      task: ['calendar', 'replenishments', 'transient'][index],
      error: result.reason instanceof Error ? result.reason.message : 'error'
    });
    return [result.reason];
  });
  if (failed.length) throw new AggregateError(failed, 'No se completaron todas las tareas de notificaciones.');
}
