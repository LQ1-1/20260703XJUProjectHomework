import { createRouter, createWebHashHistory, createWebHistory } from 'vue-router'
import Login from '../components/Encapsulation/login/Login.vue'
import UboatGame_Offline from '../components/Encapsulation/GameBody/UboatGame_Offline.vue'
import UboatGame_Online from '../components/Encapsulation/GameBody/UboatGame_Online.vue'
import UboatGame_Online_Demo from '../components/Encapsulation/GameBody/UboatGame_Online_Demo.vue'
import Mode from '@/components/Encapsulation/mode/Mode.vue'
import Room from '@/components/Encapsulation/mode/Room.vue'

const router = createRouter({
  history: import.meta.env.VITE_ROUTER_HISTORY === 'hash'
    ? createWebHashHistory()
    : createWebHistory(),
  routes: [
    {
      path: '/',
      redirect: '/mode',
    },
    {
      path: '/login',
      name: 'Login',
      component: Login,
    },
    {
      path: '/mode',
      name: 'Mode',
      component: Mode
    },
    {
      path: '/room',
      name: 'Room',
      component: Room
    },
    {
      path: '/UboatGame_Online',
      name: 'UboatGame_Online',
      component: UboatGame_Online
    },
    {
      path: '/UboatGame_Online_Demo',
      name: 'UboatGame_Online_Demo',
      component: UboatGame_Online_Demo
    },
    {
      path: '/UboatGame_Offline',
      name: 'UboatGame_Offline',
      component: UboatGame_Offline,
    },
  ],
})

export default router
