import { useToday } from './useToday'

// «Сегодня к повторению: N · Новых слов: M» — на главном экране и на экране тренировки.
export default function TodayCounts() {
  const today = useToday()
  if (!today) return null
  return (
    <p className="today-counts">
      Сегодня к повторению: <strong>{today.queue.due.length}</strong> · Новых слов:{' '}
      <strong>{today.queue.fresh.length}</strong>
    </p>
  )
}
