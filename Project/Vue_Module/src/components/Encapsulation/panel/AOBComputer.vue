<script setup lang="ts">
import { AOBComputer } from '../../../common/calculator/calculator'
import { computed, ref, watch } from 'vue'
const message = ref('')

const targetRealHeading = ref<number | null>(0)
const ownShipHeading = ref<number | null>(0)
const targetRelativeBearingDegrees = ref<number | null>(0)
const AOB = computed(() => {
    if (
        targetRealHeading.value === null ||
        ownShipHeading.value === null ||
        targetRelativeBearingDegrees.value === null
    ) {
        return NaN
    }
    let res = new AOBComputer(targetRealHeading.value, ownShipHeading.value, targetRelativeBearingDegrees.value).getAOB()
    while(res > 360){
        res -= 360
    }
    while(res < 0){
        res += 360
    }
    return res > 180 ? res -= 360 : res
})

const props = defineProps<{
    periscopeRelativeBearingDegrees: number
}>()

const emit = defineEmits<{
    'use-aob': [AOB: number]
}>()




watch(
    () => props.periscopeRelativeBearingDegrees,
    (bearing) => {
        if (!Number.isFinite(bearing)) return
        targetRelativeBearingDegrees.value = bearing
    },
    { immediate: true },
)

function useAOB() {
    emit('use-aob', AOB.value)
    message.value = '已填入AOB'
}


</script>

<template>
    <section class="computer-panel range-computer" aria-label="测距计算机">
        <header class="computer-panel__header">
            <h3>AOB计算器</h3>
        </header>

        <div class="computer-grid">
            <label>
                目标航向
                <input v-model.number="targetRealHeading" type="number" min="0" step="0.01" />
            </label>
            <label>
                本艇航向
                <input v-model.number="ownShipHeading" type="number" min="0" step="0.01" />
            </label>
            <label>
                目标相对方位
                <input v-model.number="targetRelativeBearingDegrees" type="number" min="-180" max="180" step="0.01" />
            </label>
        </div>

        <dl class="computer-readout">
            <div>
                <dt>AOB</dt>
                <dd>{{ AOB.toFixed(1) }}</dd>
            </div>
        </dl>

        <div class="computer-actions">
            <button type="button" @click="useAOB">填入AOB</button>
        </div>

        <p v-if="message" class="computer-message">{{ message }}</p>
    </section>
</template>
