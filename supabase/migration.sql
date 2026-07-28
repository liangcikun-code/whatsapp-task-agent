-- =====================================================
-- WhatsApp Task Agent - Supabase 数据库迁移
-- 在 Supabase 的 SQL Editor 中执行此脚本
-- =====================================================

-- 任务表
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tag VARCHAR(16) NOT NULL,                     -- 短ID (00001-99999)，供用户在 WhatsApp 中引用
  title TEXT NOT NULL,
  description TEXT DEFAULT ''::text,
  priority TEXT CHECK (priority IN ('high', 'medium', 'low')) DEFAULT 'medium'::text,
  priority_order SMALLINT DEFAULT 2,           -- 排序权重: high=3, medium=2, low=1
  status TEXT CHECK (status IN ('pending', 'done')) DEFAULT 'pending'::text,
  source TEXT DEFAULT 'whatsapp'::text,
  source_chat TEXT DEFAULT ''::text,
  deadline TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- 查询优化索引
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
CREATE INDEX IF NOT EXISTS idx_tasks_priority_order ON tasks(priority_order);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_tag ON tasks(tag);

-- 会话映射表（WhatsApp 号码 → Dify Conversation ID）
CREATE TABLE IF NOT EXISTS conversations (
  phone TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 自动更新 updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- 行级安全（RLS）：仅允许通过 service_role 访问
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

-- 允许 service_role 完全访问
CREATE POLICY "service_role_all_tasks" ON tasks
  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_conversations" ON conversations
  FOR ALL USING (true) WITH CHECK (true);
