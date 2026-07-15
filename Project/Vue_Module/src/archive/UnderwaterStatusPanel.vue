<script setup lang="ts">
import BearingCompassPanel from './BearingCompassPanel.vue'
import '../../css/underwater-status-panel.css'

defineProps<{
  mode: 'full' | 'compact'
  depthMeters: number
  speedKnots: number
  headingDegrees: number
  periscopeRelativeBearingDegrees: number
  navigationState: string

  submarineWorldX: number
  submarineWorldZ: number
}>()
</script>

<template>
  <aside class="underwater-status" :class="`underwater-status--${mode}`" aria-label="航行信息">
    <dl class="instrument-strip">
      <div>
        <dt>潜深</dt>
        <dd>{{ depthMeters.toFixed(1) }} m</dd>
      </div>
      <div>
        <dt>航速</dt>
        <dd>{{ speedKnots.toFixed(1) }} kn</dd>
      </div>
      <div>
        <dt>航向</dt>
        <dd>{{ headingDegrees.toFixed(0).padStart(3, '0') }}°</dd>
      </div>
      <div>
        <dt>状态</dt>
        <dd>{{ navigationState }}</dd>
      </div>
      <div>
        <dt>世界坐标-测试使用</dt>
        <dd>坐标:{{ submarineWorldX.toFixed(1) }},{{ submarineWorldZ.toFixed(1) }}</dd>
      </div>
    </dl>

    <BearingCompassPanel
      :heading-degrees="headingDegrees"
      :periscope-relative-bearing-degrees="periscopeRelativeBearingDegrees"
    />
  </aside>
</template>
