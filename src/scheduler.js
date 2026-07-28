/**
 * 定时任务调度器
 * - 每日提醒：推送当天待办
 * - 每周总结：周日推送周报
 * - 每月总结：1号推送月报
 */
import cron from 'node-cron';
import { config } from './config.js';
import { listTasks, getDailySummary, getWeeklySummary, getMonthlySummary } from './task-store.js';
import { loadConfig } from './schedule-config.js';
import { loadConfig } from './schedule-config.js';

let sendFn = null;

export function registerSender(fn) {
  sendFn = fn;
}

async function safeSend(phone, message) {
  if (sendFn) {
    try {
      await sendFn(phone, message);
    } catch (err) {
      console.error('[scheduler] 发送失败:', err.message);
    }
  } else {
    console.log(`[scheduler] 📨 模拟发送给 ${phone}:\n${message}`);
  }
}

// ==================== 提醒任务 ====================

async function buildDailyReminder() {
  const pending = await listTasks({ status: 'pending' });
  if (pending.length === 0) return '🎉 今天没有待办任务！';
  
  const highPri = pending.filter(t => t.priority === 'high');
  const now = new Date();
  const overdue = pending.filter(t => t.deadline && new Date(t.deadline) < now);

  let msg = `📋 *今日待办清单* (共 ${pending.length} 项)\n`;
  msg += `━━━━━━━━━━━━━━━━━━\n`;

  if (overdue.length > 0) {
    msg += `\n⚠️ *已逾期 ${overdue.length} 项:*\n`;
    overdue.slice(0, 5).forEach(t => {
      const d = new Date(t.deadline).toLocaleDateString('zh-CN');
      msg += `  🔴 [${t.priority}] ${t.title} (截止: ${d})\n`;
    });
  }

  if (highPri.length > 0) {
    msg += `\n🔥 *高优先级:*\n`;
    highPri.forEach(t => {
      const d = t.deadline ? ` | 截止: ${new Date(t.deadline).toLocaleDateString('zh-CN')}` : '';
      msg += `  ⭐ ${t.title}${d}\n`;
    });
  }

  msg += `\n💡 回复"完成 XXX" 或 "已完成 XXX" 来标记任务`;
  return msg;
}

async function buildWeeklySummary() {
  const summary = await getWeeklySummary();
  return buildSummaryText('📊 *本周任务总结*', summary);
}

async function buildMonthlySummary() {
  const summary = await getMonthlySummary();
  return buildSummaryText('📈 *本月任务总结*', summary);
}

function buildSummaryText(header, summary) {
  let msg = `${header}\n`;
  msg += `━━━━━━━━━━━━━━━━━━\n`;
  msg += `📅 周期: ${summary.period}\n\n`;
  msg += `📊 总任务: ${summary.total}\n`;
  msg += `✅ 已完成: ${summary.done}\n`;
  msg += `⏳ 待完成: ${summary.pending}\n`;
  msg += `⚠️ 已逾期: ${summary.overdue}\n`;
  msg += `🔥 高优先级待办: ${summary.highPriorityPending}\n`;
  msg += `🎯 完成率: ${summary.completionRate}%\n`;
  msg += `━━━━━━━━━━━━━━━━━━\n`;

  if (summary.byPriority.high > 0) {
    msg += `\n优先级分布: 高 ${summary.byPriority.high} | 中 ${summary.byPriority.medium} | 低 ${summary.byPriority.low}\n`;
  }

  if (summary.topPending.length > 0) {
    msg += `\n📌 *待办 TOP ${summary.topPending.length}:*\n`;
    summary.topPending.forEach(t => {
      const d = t.deadline ? ` | 截止: ${new Date(t.deadline).toLocaleDateString('zh-CN')}` : '';
      msg += `  ${t.priority === 'high' ? '🔴' : t.priority === 'medium' ? '🟡' : '🟢'} ${t.title}${d}\n`;
    });
  }

  msg += `\n💪 继续加油！`;
  return msg;
}

// ==================== 启动调度 ====================

export function startScheduler(phone) {
  if (!phone) {
    console.warn('[scheduler] 未设置接收提醒的手机号（跳过定时任务）');
    return;
  }

  const cfg = loadConfig();
  console.log('[scheduler] 提醒配置:', JSON.stringify(cfg));

  // 每日早报（默认开启）
  const [dh, dm] = config.schedule.dailyReminder.split(':');
  if (cfg.morningReport) {
    cron.schedule(`${dm} ${dh} * * *`, async () => {
      console.log('[scheduler] 执行每日早报');
      const msg = await buildDailyReminder();
      await safeSend(phone, msg);
    });
    console.log(`[scheduler] 早报: ON (${config.schedule.dailyReminder})`);
  } else {
    console.log('[scheduler] 早报: OFF');
  }

  // 每日晚报（默认关闭）
  if (cfg.eveningReport) {
    cron.schedule('0 21 * * *', async () => {
      console.log('[scheduler] 执行每日晚报');
      const msg = await buildDailyReminder();
      await safeSend(phone, '\ud83c\udf06 *今晚待办回顾*\n\n' + msg);
    });
    console.log('[scheduler] 晚报: ON (21:00)');
  } else {
    console.log('[scheduler] 晚报: OFF');
  }

  // 每周总结（默认开启）
  const [wh, wm] = config.schedule.weeklySummaryTime.split(':');
  if (cfg.weeklyReport) {
    cron.schedule(`${wm} ${wh} * * ${config.schedule.weeklySummaryDay}`, async () => {
      console.log('[scheduler] 执行每周总结');
      const msg = await buildWeeklySummary();
      await safeSend(phone, msg);
    });
    console.log(`[scheduler] 周报: ON (周${config.schedule.weeklySummaryDay} ${config.schedule.weeklySummaryTime})`);
  } else {
    console.log('[scheduler] 周报: OFF');
  }

  // 每月总结（默认关闭）
  const [mh, mm] = config.schedule.monthlySummaryTime.split(':');
  if (cfg.monthlyReport) {
    cron.schedule(`${mm} ${mh} ${config.schedule.monthlySummaryDay} * *`, async () => {
      console.log('[scheduler] 执行每月总结');
      const msg = await buildMonthlySummary();
      await safeSend(phone, msg);
    });
    console.log(`[scheduler] 月报: ON (${config.schedule.monthlySummaryDay}号 ${config.schedule.monthlySummaryTime})`);
  } else {
    console.log('[scheduler] 月报: OFF');
  }

  console.log('[scheduler] 定时任务已启动');
}

export { buildDailyReminder, buildWeeklySummary, buildMonthlySummary };
