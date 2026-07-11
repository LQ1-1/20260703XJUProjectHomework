export function moveTowards(current: number, target: number, maximumDelta: number) {
  if (Math.abs(target - current) <= maximumDelta) return target
  return current + Math.sign(target - current) * maximumDelta
}
