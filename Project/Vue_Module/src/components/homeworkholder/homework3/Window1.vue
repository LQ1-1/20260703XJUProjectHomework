<script setup lang="ts">
import {ref} from "vue";
import {useRouter} from 'vue-router';


const router=useRouter();
const msg='<span style="color:blue">Kapitänleutnant: LQH</span>'
const color='color: yellow'

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
    <h1>This is Window1</h1>
    <div v-html="msg"></div>
    <label :style="color">:style练习</label>


    <button @click="button_click_W0()">Jump into Window0</button>
    <button @click="button_click_W1()">Jump into Window1</button>
    <button @click="button_click_W2()">Jump into Window2</button>
    <button @click="button_click_W3()">Jump into Window3</button>
  </div>
</template>

<style scoped>

</style>