/**
 * 日程提醒配置 — 持久化
 * 默认：早报 + 周报开启，晚报 + 月报关闭
 */
import fs from 'fs';
import { join } from 'path';
import { DATA_DIR } from './config.js';

const CONFIG_PATH = join(DATA_DIR, 'schedule.json');

const DEFAULTS = {
  morningReport: true,   // 每日早报 09:00
  eveningReport: false,  // 每日晚报 21:00
  weeklyReport: true,    // 周报 周日 20:00
  monthlyReport: false,  // 月报 1号 20:00
};

export function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveConfig(updates) {
  const current = loadConfig();
  const merged = { ...current, ...updates };
  // 只允许更新已知键
  for (const key of Object.keys(merged)) {
    if (!(key in DEFAULTS)) delete merged[key];
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf-8');
  return merged;
}

export function resetConfig() {
  saveConfig(DEFAULTS);
  return { ...DEFAULTS };
}

export function isEnabled(key) {
  const cfg = loadConfig();
  return cfg[key] === true;
}

export { DEFAULTS };
