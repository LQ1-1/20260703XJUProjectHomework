<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import {useRouter} from 'vue-router';
import type { FormInstance, FormRules } from 'element-plus'
import {
    User,
    UserFilled,
    Lock,
    Key,
    Phone,
    MessageBox,
} from '@element-plus/icons-vue'
import { UBoatKommandant, LoginDTO, login, registration } from '../api/ContactTool'
import '../../../css/login.css'


const router = useRouter()


const KommandantRegistrationForm = reactive(new UBoatKommandant('', '', ''))    //注册Kommandant编号的表单


const formRef = ref<FormInstance>()

const registerType = ref<'login' | 'registration'>('login')
const isLoading = ref(false)

const isRegister = computed(() => registerType.value !== 'login')

const inputedUUID = ref('')
const showNewUUID = ref(false)
const newUUID = ref(0)

const titleText = computed(() => {
    if (registerType.value === 'registration') {
        return '潜艇指挥官注册'
    }

    return '登录'
})


const rules: FormRules = {
    KommandantUUID: [
        { required: true, message: '请输入指挥官ID', trigger: 'blur' },
    ],
    KommandantName: [
        { required: true, message: '请输入您的称呼', trigger: 'blur' },
    ],
    UBoatID: [
        { required: true, message: '请输入潜艇编号', trigger: 'blur' }
    ]

}

function resetForm() {
    formRef.value?.resetFields()

    KommandantRegistrationForm.KommandantUUID = ''
    KommandantRegistrationForm.KommandantName = ''
    KommandantRegistrationForm.UBoatID = ''
    newUUID.value = 0
    showNewUUID.value = false
}

function switchToRegister(type: 'registration') {
    registerType.value = type
    resetForm()
}

function switchToLogin() {
    registerType.value = 'login'
    resetForm()
}

async function handleSubmit() {
    if (!formRef.value) {
        return
    }

    const valid = await formRef.value.validate().catch(() => false)

    if (!valid) {
        return
    }

    isLoading.value = true

    try {
        if (isRegister.value) {
            showNewUUID.value = true

            console.log('注册数据：', {
                KommandantName: KommandantRegistrationForm.KommandantName,
                UBoatID: KommandantRegistrationForm.UBoatID,
            })

            let newKommandantRecord: UBoatKommandant = new UBoatKommandant(
                KommandantRegistrationForm.KommandantName,
                undefined,
                KommandantRegistrationForm.UBoatID);

            //发起注册请求
            let result = await registration(newKommandantRecord)    //sf: success flag
            if (result.data.sf) {
                let data = result.data
                newUUID.value = data.KommandantUUID
            }else{
                alert(result.data.message)
            }

        } else {
            console.log('登录数据：', {
                KommandantUUID: KommandantRegistrationForm.KommandantUUID
            })

            let loginBody: LoginDTO = new LoginDTO(
                inputedUUID.value
            )

            //发起登录请求
            let result = await login(loginBody)
            if(result.data.sf){
                //跳转进入模式选择界面
                router
            }else{
                alert(result.data.message)
            }

        }
    } finally {
        isLoading.value = false
    }
}
</script>




<template>
    <div class="login-container">
        <el-card class="login-card">
            <template #header>
                <div class="card-header">
                    <!-- 标题根据状态动态显示：登录 / 指挥官注册  -->
                    <span>{{ titleText }}</span>
                </div>
            </template>
            <!-- 表单区域 -->
            <el-form ref="formRef" :model="KommandantRegistrationForm" :rules="rules" label-width="100px" size="large"
                status-icon>

                <!-- 只在登录时显示 -->
                <template v-if="!isRegister">
                    <el-form-item label="指挥官编号" prop="KommandantUUID">
                        <el-input v-model="inputedUUID" placeholder="请输入您的指挥官ID" :prefix-icon="Key" />
                    </el-form-item>
                </template>

                <!-- 只在注册时显示 -->
                <template v-if="isRegister">
                    <el-form-item label="指挥官称呼" prop="KommandantName">
                        <el-input v-model="KommandantRegistrationForm.KommandantName" placeholder="Wie heißen Sie?"
                            :prefix-icon="UserFilled" />
                    </el-form-item>

                    <el-form-item label="潜艇编号" prop="UBoatID">
                        <el-input v-model="KommandantRegistrationForm.UBoatID" type="number" placeholder="请输入潜艇编号" />
                    </el-form-item>

                    <!-- 拿到新生成的UUID时才显示 -->
                    <template v-if="showNewUUID">
                        <el-form-item label="指挥官编号" prop="KommandantUUID">
                            <el-input v-model="newUUID" disabled />
                            <el-form-item label="请保存好您的指挥官编号，最好记录到您的笔记本上" label-width="350px"></el-form-item>
                        </el-form-item>
                    </template>
                </template>


                <el-form-item>
                    <el-button type="primary" :loading="isLoading" class="login-button" @click="handleSubmit">
                        {{ isRegister ? '立 即 注 册' : '登 录' }}
                    </el-button>
                </el-form-item>

                <div class="form-footer">
                    <template v-if="!isRegister">
                        <div class="footer-links">
                            <el-link type="primary" :underline="false" @click="switchToRegister('registration')">
                                还没有潜艇？注册成为艇长吧!
                            </el-link>
                        </div>
                    </template>

                    <template v-else>
                        <el-link type="primary" :underline="false" @click="switchToLogin">
                            已是艇长？准备进入游戏
                        </el-link>
                    </template>
                </div>

            </el-form>
        </el-card>
    </div>
</template>
