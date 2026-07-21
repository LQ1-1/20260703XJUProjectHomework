import axios from 'axios'
import { getApiBaseUrl } from './runtimeConfig'


const request = axios.create({
    baseURL: getApiBaseUrl(),
    timeout: 10000,
})

//请求拦截器
request.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('token')
        if (token) {
            config.headers.Authorization = `Bearer ${token}`
        }
        return config
    },
    (error) => Promise.reject(error),
)

//响应拦截器
request.interceptors.response.use(
    (res)=> res.data, 
    (error) =>{
        console.error('请求失败详情', {
            message: error?.message,
            code: error?.code,
            status: error?.response?.status,
            statusText: error?.response?.statusText,
            url: error?.config?.url,
            baseURL: error?.config?.baseURL,
            method: error?.config?.method,
            params: error?.config?.params,
            data: error?.config?.data,
            responseData: error?.response?.data,
            stack: error?.stack,
        })
        return Promise.reject(error)
    }
)

export default request
