import { createRouter, createWebHistory } from 'vue-router'
import Login from '../components/Encapsulation/login/Login.vue'
import UboatGame_Offline from '../components/Encapsulation/GameBody/UboatGame_Offline.vue'
import UboatGame_Online from '../components/Encapsulation/GameBody/UboatGame_Online.vue'
import Mode from '@/components/Encapsulation/mode/Mode.vue'

const router = createRouter({
  history: createWebHistory(),
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
      path: '/UboatGame_Online',
      name: 'UboatGame_Online',
      component: UboatGame_Online
    },
    {
      path: '/UboatGame_Offline',
      name: 'UboatGame_Offline',
      component: UboatGame_Offline,
    },
  ],
})

export default router