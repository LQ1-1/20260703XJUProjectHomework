<script setup lang="ts">

import {ref} from "vue";
import ChildHW from "./ChildHW.vue";

const AbsoluteDial=ref(0)
const RelativeDial=ref(0)


function AbsoluteDial_add(){
  AbsoluteDial.value++;
}

function AbsoluteDial_reduce(){
  AbsoluteDial.value--;
}

function RelativeDial_add(){
  RelativeDial.value++;
}

function RelativeDial_reduce(){
  RelativeDial.value--;
}

function fluctuate(newAD: number, newRD: number){
  AbsoluteDial.value=newAD
  RelativeDial.value=newRD
}

</script>

<template>

  <div class="FatherHW">
    <h1>FatherHW</h1>
    <dt>Marine Compass</dt>
    <dd>{{AbsoluteDial}}</dd>
    <dt>RelativeDial</dt>
    <dd>{{RelativeDial}}</dd>

    <button id="button_add" @click="AbsoluteDial_add()">+</button>
    <button id="button_reduce" @click="AbsoluteDial_reduce()">-</button>

    <button id="button_add" @click="RelativeDial_add()">+</button>
    <button id="button_reduce" @click="RelativeDial_reduce()">-</button>
  </div>

  <div class="ChildSector">
    <ChildHW :AbsoluteDial="AbsoluteDial" :RelativeDial="RelativeDial" @send="fluctuate"/>
  </div>

</template>

<style scoped>

</style>