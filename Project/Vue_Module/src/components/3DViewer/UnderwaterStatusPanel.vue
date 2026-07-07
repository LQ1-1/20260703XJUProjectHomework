<script setup lang="ts">
import '../../css/underwater-status-panel.css'

defineProps<{
  depthMeters: number
  speedKnots: number
  headingDegrees: number
  navigationState: string

  submarineWorldX: number
  submarineWorldZ: number
}>()
</script>

<template>
  <aside class="underwater-status" aria-label="航行信息">
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
        <dd>坐标:{{submarineWorldX}},{{submarineWorldZ}}</dd>
      </div>
      <div>
        <dt>潜望镜相对方位</dt>
        <dd></dd>
      </div>
    </dl>
  </aside>
</template>
