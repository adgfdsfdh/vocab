import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { db } from '../../db/db'
import { buildQueue, getNewPerDay, nextDue, type Queue } from './srs'

export interface Today {
  queue: Queue
  next?: Date
  newPerDay: number
}

// Очередь на сегодня. Пересчитывается при изменениях в базе и раз в минуту (слова «созревают» со временем).
export function useToday(newPerDay = getNewPerDay()): Today | undefined {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000)
    return () => clearInterval(id)
  }, [])
  return useLiveQuery(async () => {
    const [words, reviews] = await Promise.all([db.words.toArray(), db.reviews.toArray()])
    const now = new Date()
    return { queue: buildQueue(words, reviews, now, newPerDay), next: nextDue(reviews, now), newPerDay }
  }, [tick, newPerDay])
}
