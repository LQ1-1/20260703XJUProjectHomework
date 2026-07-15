import { computed, ref } from 'vue'

export function HudState() {
  const speedKmh = ref(0)
  const depthMeters = ref(0)
  const headingDegrees = ref(0) //航向
  const periscopeRelativeBearingDegrees = ref(0)  //潜望镜相对艇艏的方位
  const hydroPhoneBearingDegrees = ref(0) //水听器方位
  const navigationState = ref<'水面' | '水下' | '潜望镜视角' | '水面瞄准视角'>('水面')
  const submarineWorldX = ref(0)
  const submarineWorldZ = ref(0)

  const speedKnots = computed(() => speedKmh.value / 1.852)

  return {
    speedKmh,
    depthMeters,
    headingDegrees,
    periscopeRelativeBearingDegrees,
    navigationState,
    submarineWorldX,
    submarineWorldZ,
    speedKnots,
  }
}