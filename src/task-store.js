/**
 * 任务存储 — Supabase PostgreSQL 版
 *
 * 替代了之前 JSON 文件的实现。所有数据持久化在 Supabase。
 * API 接口与之前完全一致（scheduler.js / server.js 无需改动）。
 */
import { createClient } from '@supabase/supabase-js';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek.js';
import utc from 'dayjs/plugin/utc.js';
import { config } from './config.js';

dayjs.extend(isoWeek);
dayjs.extend(utc);

// ==================== Supabase 客户端 ====================

const supabase = createClient(config.supabase.url, config.supabase.anonKey);

/** Generate auto-increment task ID: 00001, 00002, ... */
async function generateTag() {
  const { count, error } = await supabase
    .from('tasks')
    .select('*', { count: 'exact', head: true });
  if (error) throw new Error(`tag生成失败: ${error.message}`);
  return String((count || 0) + 1).padStart(5, '0');
}

// ==================== 任务 CRUD ====================

export async function createTask({ title, description, priority, deadline, source, sourceChat, sourceName }) {
  const tag = await generateTag();
  const insertData = {
    tag,
    title,
    description: description || '',
    priority: validatePriority(priority),
    source: source || 'whatsapp',
    source_chat: sourceChat || '',
    deadline: deadline || null,
  };
  // source_name column may not exist — fall back to storing in description
  if (sourceName) {
    try {
      const { error: testErr } = await supabase.from('tasks').select('source_name').limit(1);
      if (!testErr) {
        insertData.source_name = sourceName;
      } else {
        // Column missing — prepend sourceName to description
        insertData.description = `[来自: ${sourceName}] ${insertData.description || ''}`.trim();
      }
    } catch (_) {
      insertData.description = `[来自: ${sourceName}] ${insertData.description || ''}`.trim();
    }
  }
  const { data, error } = await supabase
    .from('tasks')
    .insert(insertData)
    .select()
    .single();

  if (error) throw new Error(`创建任务失败: ${error.message}`);
  return mapTask(data);
}

export async function listTasks({ status, priority, sortBy } = {}) {
  let query = supabase.from('tasks').select('*');

  if (status) query = query.eq('status', status);
  if (priority) query = query.eq('priority', priority);

  // 排序：优先级(高→低) → 截止日期(近→远) → 创建时间(新→旧)
  // PostgreSQL 中 high=3, medium=2, low=1
  query = query
    .order('priority_order', { ascending: false, nullsFirst: false })
    .order('deadline', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: false });

  const { data, error } = await query;
  if (error) throw new Error(`查询任务失败: ${error.message}`);

  const tasks = (data || []).map(mapTask);

  // 服务端排序补充
  const priorityWeight = { high: 3, medium: 2, low: 1 };
  tasks.sort((a, b) => {
    const pw = (priorityWeight[b.priority] || 0) - (priorityWeight[a.priority] || 0);
    if (pw !== 0) return pw;
    if (a.deadline && b.deadline) return new Date(a.deadline) - new Date(b.deadline);
    if (a.deadline) return -1;
    if (b.deadline) return 1;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  return tasks;
}

function isUUID(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

/** Build a where clause matching either UUID id or short tag */
function idOrTag(id) {
  return isUUID(id) ? `id.eq.${id},tag.eq.${id}` : `tag.eq.${id}`;
}

export async function getTask(id) {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .or(idOrTag(id))
    .maybeSingle();

  if (error) throw new Error(`查询任务失败: ${error.message}`);
  return data ? mapTask(data) : null;
}

export async function updateTask(id, updates) {
  const set = {};
  if (updates.title !== undefined) set.title = updates.title;
  if (updates.description !== undefined) set.description = updates.description;
  if (updates.priority !== undefined) set.priority = validatePriority(updates.priority);
  if (updates.deadline !== undefined) set.deadline = updates.deadline || null;

  const { data, error } = await supabase
    .from('tasks')
    .update(set)
    .or(idOrTag(id))
    .select()
    .maybeSingle();

  if (error) throw new Error(`更新任务失败: ${error.message}`);
  return data ? mapTask(data) : null;
}

export async function completeTask(id) {
  const { data, error } = await supabase
    .from('tasks')
    .update({ status: 'done', completed_at: new Date().toISOString() })
    .or(idOrTag(id))
    .select()
    .maybeSingle();

  if (error) throw new Error(`标记完成失败: ${error.message}`);
  return data ? mapTask(data) : null;
}

export async function uncompleteTask(id) {
  const { data, error } = await supabase
    .from('tasks')
    .update({ status: 'pending', completed_at: null })
    .or(idOrTag(id))
    .select()
    .maybeSingle();

  if (error) throw new Error(`撤销完成失败: ${error.message}`);
  return data ? mapTask(data) : null;
}

export async function deleteTask(id) {
  const { error } = await supabase
    .from('tasks')
    .delete()
    .or(idOrTag(id));

  if (error) throw new Error(`删除任务失败: ${error.message}`);
  return true;
}

// ==================== 会话追踪 ====================

export async function getConversation(phone) {
  const { data, error } = await supabase
    .from('conversations')
    .select('conversation_id')
    .eq('phone', phone)
    .maybeSingle();

  if (error) {
    console.error('[task-store] 查询会话失败:', error.message);
    return null;
  }
  return data?.conversation_id || null;
}

export async function setConversation(phone, conversationId) {
  const { error } = await supabase
    .from('conversations')
    .upsert(
      { phone, conversation_id: conversationId, updated_at: new Date().toISOString() },
      { onConflict: 'phone' }
    );

  if (error) {
    console.error('[task-store] 保存会话失败:', error.message);
  }
}

// ==================== 总结 ====================

export async function getDailySummary() {
  return getSummary(dayjs().startOf('day'), dayjs().endOf('day'));
}

export async function getWeeklySummary() {
  return getSummary(dayjs().startOf('isoWeek'), dayjs().endOf('isoWeek'));
}

export async function getMonthlySummary() {
  return getSummary(dayjs().startOf('month'), dayjs().endOf('month'));
}

export async function getQuarterSummary() {
  const now = dayjs();
  // 手动计算季度：0=Q1, 1=Q2, 2=Q3, 3=Q4
  const q = Math.floor(now.month() / 3);
  const start = now.startOf('year').add(q * 3, 'month');
  const end = start.add(3, 'month').subtract(1, 'day').endOf('day');
  return getSummary(start, end);
}

export async function getCurrentYearSummary() {
  return getSummary(dayjs().startOf('year'), dayjs().endOf('year'));
}

export async function getSummaryByDateRange(fromDate, toDate) {
  const from = dayjs(fromDate).startOf('day');
  const to = dayjs(toDate).endOf('day');
  if (!from.isValid() || !to.isValid()) {
    throw new Error('日期格式无效，请使用 YYYY-MM-DD 格式');
  }
  return getSummary(from, to);
}

async function getSummary(from, to) {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .gte('created_at', from.toISOString())
    .lte('created_at', to.toISOString());

  if (error) throw new Error(`获取总结失败: ${error.message}`);

  const periodTasks = (data || []).map(mapTask);
  const total = periodTasks.length;
  const done = periodTasks.filter(t => t.status === 'done').length;
  const pending = periodTasks.filter(t => t.status === 'pending').length;
  const overdue = periodTasks.filter(t => {
    if (t.status === 'done' || !t.deadline) return false;
    return new Date(t.deadline) < new Date();
  });
  const highPriorityPending = periodTasks.filter(t => t.status === 'pending' && t.priority === 'high').length;
  const byPriority = { high: 0, medium: 0, low: 0 };
  pendingTasks(periodTasks).forEach(t => byPriority[t.priority]++);

  return {
    period: `${from.format('YYYY-MM-DD')} ~ ${to.format('YYYY-MM-DD')}`,
    total,
    done,
    pending,
    overdue: overdue.length,
    highPriorityPending,
    byPriority,
    completionRate: total > 0 ? Math.round((done / total) * 100) : 0,
    topPending: pendingTasks(periodTasks).slice(0, 5).map(t => ({
      id: t.tag,
      title: t.title,
      priority: t.priority,
      deadline: t.deadline,
    })),
  };
}

function pendingTasks(tasks) {
  return tasks.filter(t => t.status === 'pending');
}

export async function getStats() {
  const { count: total, error: err1 } = await supabase
    .from('tasks').select('*', { count: 'exact', head: true });
  const { count: done, error: err2 } = await supabase
    .from('tasks').select('*', { count: 'exact', head: true }).eq('status', 'done');

  if (err1 || err2) throw new Error('获取统计失败');
  return { total: total || 0, done: done || 0, pending: (total || 0) - (done || 0) };
}

// ==================== 工具函数 ====================

function validatePriority(p) {
  if (['high', 'medium', 'low'].includes(p)) return p;
  return 'medium';
}

function mapTask(row) {
  return {
    id: row.tag,        // 短ID，供用户在 WhatsApp 中引用
    uuid: row.id,       // 完整 UUID
    title: row.title,
    description: row.description || '',
    priority: row.priority,
    status: row.status,
    source: row.source,
    sourceChat: row.source_chat || '',
    sourceName: row.source_name || '',
    deadline: row.deadline || null,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

// 兼容旧接口：即刻支持
export { createClient };
console.log('[task-store] ✅ 已连接到 Supabase');
console.log(`  URL: ${config.supabase.url.replace(/\/?$/, '')}`);
