<script setup lang="ts">



const props=defineProps(['AbsoluteDial', 'RelativeDial'])

const emits=defineEmits(['send'])

function fluctuate(){

  emits('send', props.AbsoluteDial+90, props.RelativeDial-90);
}

</script>

<template>
  <div class="ChildHW">
    <h1>ChildHW</h1>
    <dt>Marine Compass</dt>
    <dd>{{AbsoluteDial}}</dd>
    <dt>RelativeDial</dt>
    <dd>{{RelativeDial}}</dd>

    <button @click="fluctuate()"></button>
  </div>
</template>

<style scoped>

</style>