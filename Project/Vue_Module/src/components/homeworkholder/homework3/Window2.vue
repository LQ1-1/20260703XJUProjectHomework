<script setup lang="ts">
import {ref} from "vue";
import {useRouter} from 'vue-router';
const router=useRouter();
let testObj=ref({
  para1:null
})
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

const arr=['Eins', 'Zwei', 'Drei', 'Fier', 'Funf', 'Sechs'];

</script>

<template>
  <div>
    <h1>This is Window2</h1>

    <div v-for="item in arr">{{item}}</div>
    <div v-for="(item, index) in arr">{{index}} {{item}}</div>

    <div>
      <input type="text" v-model="testObj.para1">
    </div>

    <button @click="button_click_W0()">Jump into Window0</button>
    <button @click="button_click_W1()">Jump into Window1</button>
    <button @click="button_click_W2()">Jump into Window2</button>
    <button @click="button_click_W3()">Jump into Window3</button>
  </div>
</template>

<style scoped>

</style>