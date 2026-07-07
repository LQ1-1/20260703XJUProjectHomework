<script setup lang="ts">
import {ref, computed} from "vue";
import {useRouter} from 'vue-router';

const name=ref('蓝谦厚')
const schoolId=ref('20242501367')

const router=useRouter();

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

const search = ref('')
const statusFilter = ref('')
const currentPage = ref(1)
const pageSize = ref(5)
const dialogVisible = ref(false)
const isEditing = ref(false)
const editingIndex = ref(-1)
const selectedRows = ref<any[]>([])

interface User {
  name: string
  age: number
  role: string
  department: string
  salary: number
  status: string
  joinDate: string
}

const form = ref<User>({
  name: '',
  age: 25,
  role: '',
  department: '技术部',
  salary: 20,
  status: '在职',
  joinDate: '',
})

const tableData = ref<User[]>([
  { name: '张三', age: 28, role: '前端开发', department: '技术部', salary: 35, status: '在职', joinDate: '2023-03-15' },
  { name: '李四', age: 32, role: '产品经理', department: '产品部', salary: 45, status: '在职', joinDate: '2022-07-01' },
  { name: '王五', age: 25, role: 'UI设计师', department: '设计部', salary: 28, status: '在职', joinDate: '2024-01-10' },
  { name: '赵六', age: 40, role: '技术总监', department: '技术部', salary: 80, status: '在职', joinDate: '2019-05-20' },
  { name: '钱七', age: 35, role: '市场专员', department: '市场部', salary: 30, status: '离职', joinDate: '2021-11-08' },
  { name: '孙八', age: 27, role: '后端开发', department: '技术部', salary: 38, status: '在职', joinDate: '2023-09-01' },
  { name: '周九', age: 31, role: '产品助理', department: '产品部', salary: 25, status: '离职', joinDate: '2022-04-15' },
  { name: '吴十', age: 29, role: '测试工程师', department: '技术部', salary: 32, status: '在职', joinDate: '2023-06-20' },
])

const filteredData = computed(() => {
  let data = tableData.value
  if (search.value) data = data.filter(u => u.name.includes(search.value))
  if (statusFilter.value) data = data.filter(u => u.status === statusFilter.value)
  return data.slice((currentPage.value - 1) * pageSize.value, currentPage.value * pageSize.value)
})

function onSelectionChange(rows: any[]) {
  selectedRows.value = rows
}

function addRow() {
  isEditing.value = false
  editingIndex.value = -1
  form.value = { name: '', age: 25, role: '', department: '技术部', salary: 20, status: '在职', joinDate: '' }
  dialogVisible.value = true
}

function editRow(row: User) {
  isEditing.value = true
  editingIndex.value = tableData.value.indexOf(row)
  form.value = { ...row }
  dialogVisible.value = true
}

function saveRow() {
  if (isEditing.value && editingIndex.value >= 0) {
    tableData.value[editingIndex.value] = { ...form.value }
  } else {
    tableData.value.unshift({ ...form.value })
  }
  dialogVisible.value = false
}

function deleteRow(index: number) {
  tableData.value.splice(index, 1)
}

function deleteSelected() {
  tableData.value = tableData.value.filter(u => !selectedRows.value.includes(u))
}

</script>

<template>
  <div>
    <h1>This is Window0</h1>

    <h1>Name: {{name}}</h1>
    <h2>SchoolId: {{schoolId}}</h2>

    <button @click="button_click_W0()">Jump into Window0</button>
    <button @click="button_click_W1()">Jump into Window1</button>
    <button @click="button_click_W2()">Jump into Window2</button>
    <button @click="button_click_W3()">Jump into Window3</button>
  </div>

  <div class="window0">
    <h2>Window0 - 用户管理表</h2>

    <!-- 搜索/操作栏 -->
    <div style="display: flex; gap: 12px; margin-bottom: 16px; align-items: center">
      <el-input v-model="search" placeholder="搜索姓名" clearable style="width: 200px" />
      <el-select v-model="statusFilter" placeholder="状态筛选" clearable style="width: 140px">
        <el-option label="在职" value="在职" />
        <el-option label="离职" value="离职" />
      </el-select>
      <el-button type="primary" @click="addRow">+ 新增</el-button>
      <el-button type="danger" :disabled="!selectedRows.length" @click="deleteSelected">
        批量删除
      </el-button>
    </div>

    <!-- Table -->
    <el-table
        ref="tableRef"
        :data="filteredData"
        stripe
        border
        style="width: 100%"
        @selection-change="onSelectionChange"
    >
      <el-table-column type="selection" width="50" />
      <el-table-column type="index" label="#" width="50" />
      <el-table-column prop="name" label="姓名" width="120" sortable />
      <el-table-column prop="age" label="年龄" width="80" sortable />
      <el-table-column prop="role" label="职位" width="140" />
      <el-table-column prop="department" label="部门" width="120" />
      <el-table-column prop="salary" label="薪资(万)" width="100" sortable />
      <el-table-column prop="status" label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="row.status === '在职' ? 'success' : 'danger'" size="small">
            {{ row.status }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="joinDate" label="入职日期" width="120" sortable />
      <el-table-column label="操作" width="160" fixed="right">
        <template #default="{ row, $index }">
          <el-button size="small" type="primary" @click="editRow(row)">编辑</el-button>
          <el-button size="small" type="danger" @click="deleteRow($index)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 分页 -->
    <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :page-sizes="[5, 10, 20]"
        background
        layout="total, sizes, prev, pager, next, jumper"
        :total="tableData.length"
        style="margin-top: 16px"
    />

    <!-- 编辑弹窗 -->
    <el-dialog v-model="dialogVisible" :title="isEditing ? '编辑用户' : '新增用户'" width="420px">
      <el-form :model="form" label-width="80px">
        <el-form-item label="姓名">
          <el-input v-model="form.name" />
        </el-form-item>
        <el-form-item label="年龄">
          <el-input-number v-model="form.age" :min="18" :max="65" />
        </el-form-item>
        <el-form-item label="职位">
          <el-input v-model="form.role" />
        </el-form-item>
        <el-form-item label="部门">
          <el-select v-model="form.department" style="width: 100%">
            <el-option label="技术部" value="技术部" />
            <el-option label="产品部" value="产品部" />
            <el-option label="设计部" value="设计部" />
            <el-option label="市场部" value="市场部" />
          </el-select>
        </el-form-item>
        <el-form-item label="薪资(万)">
          <el-input-number v-model="form.salary" :min="5" :max="200" :step="1" />
        </el-form-item>
        <el-form-item label="状态">
          <el-switch v-model="form.status" active-text="在职" inactive-text="离职" :active-value="'在职'" :inactive-value="'离职'" />
        </el-form-item>
        <el-form-item label="入职日期">
          <el-date-picker v-model="form.joinDate" type="date" placeholder="选择日期" style="width: 100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveRow">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>

</style>