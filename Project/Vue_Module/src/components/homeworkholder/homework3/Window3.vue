<script setup lang="ts">
import {ref} from "vue";
import {useRouter} from 'vue-router';
const router=useRouter();
let variant1=true;
let variant2=false;
function button_click_W0(){
  router.push('/Window0')
}
function button_click_W1(){
  router.push('/Window1')
}
function button_click_W2(){
  router.push('/Window2')
}
function button_click_W3(){
  router.push('/Window3')
}
</script>

<template>
  <div>
    <h1>This is Window3</h1>

    <div v-if="variant1">variant1 is true</div>
    <div v-else>variant1 is false</div>

    <div v-show="variant1">Show up</div>



    <button @click="button_click_W0()">Jump into Window0</button>
    <button @click="button_click_W1()">Jump into Window1</button>
    <button @click="button_click_W2()">Jump into Window2</button>
    <button @click="button_click_W3()">Jump into Window3</button>
  </div>
</template>

<style scoped>

</style>