export function setBoundedMapEntry<K, V>(
  current: ReadonlyMap<K, V>,
  key: K,
  value: V,
  maxEntries: number
): Map<K, V> {
  const next = new Map(current)
  next.delete(key)
  next.set(key, value)
  const safeLimit = Math.max(1, Math.floor(maxEntries))
  while (next.size > safeLimit) {
    const oldestKey = next.keys().next().value as K | undefined
    if (oldestKey === undefined) break
    next.delete(oldestKey)
  }
  return next
}
