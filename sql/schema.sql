-- effective-commerce-agents — Postgres schema. Applied automatically at server start (server/src/migrate.ts);
-- every statement is idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS), so re-running is safe.
-- Requires the pgcrypto/gen_random_uuid() built into Postgres 13+.

-- ig_private_sessions.create
CREATE TABLE IF NOT EXISTS ig_private_sessions (
      tenant_id VARCHAR(64) PRIMARY KEY,
      ig_username VARCHAR(255),
      status VARCHAR(16) NOT NULL DEFAULT 'disconnected',
      connected_at TIMESTAMP WITH TIME ZONE,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

-- commerce_settings.table
CREATE TABLE IF NOT EXISTS commerce_settings (
      tenant_id VARCHAR(64) PRIMARY KEY,
      slug VARCHAR(64) NOT NULL UNIQUE,
      brand_name VARCHAR(160) NOT NULL DEFAULT '',
      assistant_name VARCHAR(80) NOT NULL DEFAULT 'Ассистент',
      brand_voice VARCHAR(400) NOT NULL DEFAULT '',
      greeting VARCHAR(400) NOT NULL DEFAULT '',
      accent VARCHAR(16) NOT NULL DEFAULT '#111827',
      theme VARCHAR(8) NOT NULL DEFAULT 'auto',
      logo_url TEXT,
      position VARCHAR(16) NOT NULL DEFAULT 'bottom-right',
      language VARCHAR(8) NOT NULL DEFAULT 'auto',
      business_profile TEXT NOT NULL DEFAULT '',
      policies TEXT NOT NULL DEFAULT '',
      currency VARCHAR(8) NOT NULL DEFAULT 'RUB',
      site_url TEXT,
      checkout_url TEXT,
      platform VARCHAR(16) NOT NULL DEFAULT 'other',
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      voice_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      proactive_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      anthropic_key_encrypted TEXT,
      shopping_model VARCHAR(80),
      merchant_model VARCHAR(80),
      crawl_status JSONB,
      share_title VARCHAR(160),
      share_description VARCHAR(400),
      share_cover_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

-- commerce_products.table
CREATE TABLE IF NOT EXISTS commerce_products (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id VARCHAR(64) NOT NULL,
      external_id VARCHAR(400),
      sku VARCHAR(160),
      title VARCHAR(400) NOT NULL,
      brand VARCHAR(160),
      description TEXT,
      price NUMERIC(14,2) NOT NULL DEFAULT 0,
      currency VARCHAR(8) NOT NULL DEFAULT 'RUB',
      compare_at_price NUMERIC(14,2),
      in_stock BOOLEAN NOT NULL DEFAULT TRUE,
      stock INTEGER,
      image_url TEXT,
      url TEXT,
      category VARCHAR(200),
      attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
      options JSONB NOT NULL DEFAULT '{}'::jsonb,
      option_values JSONB NOT NULL DEFAULT '{}'::jsonb,
      variant_of UUID,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      search_text TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

-- commerce_products.uniq_external
CREATE UNIQUE INDEX IF NOT EXISTS commerce_products_tenant_external_uniq ON commerce_products (tenant_id, external_id) WHERE external_id IS NOT NULL;

-- commerce_products.idx_tenant
CREATE INDEX IF NOT EXISTS commerce_products_tenant_idx ON commerce_products (tenant_id, active);

-- commerce_products.idx_fts
CREATE INDEX IF NOT EXISTS commerce_products_fts_idx ON commerce_products USING GIN (to_tsvector('simple', search_text));

-- commerce_conversations.table
CREATE TABLE IF NOT EXISTS commerce_conversations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id VARCHAR(64) NOT NULL,
      visitor_id VARCHAR(80) NOT NULL,
      channel VARCHAR(16) NOT NULL DEFAULT 'widget',
      page_url TEXT,
      lang VARCHAR(8),
      cart JSONB NOT NULL DEFAULT '{"items":[]}'::jsonb,
      seen_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      status VARCHAR(16) NOT NULL DEFAULT 'open',
      summary TEXT,
      message_count INTEGER NOT NULL DEFAULT 0,
      turn_count INTEGER NOT NULL DEFAULT 0,
      usage JSONB,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

-- commerce_conversations.idx
CREATE INDEX IF NOT EXISTS commerce_conversations_tenant_idx ON commerce_conversations (tenant_id, channel, last_at DESC);

-- commerce_conversations.idx_visitor
CREATE INDEX IF NOT EXISTS commerce_conversations_visitor_idx ON commerce_conversations (tenant_id, visitor_id, last_at DESC);

-- commerce_messages.table
CREATE TABLE IF NOT EXISTS commerce_messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id VARCHAR(64) NOT NULL,
      conversation_id UUID NOT NULL REFERENCES commerce_conversations(id) ON DELETE CASCADE,
      role VARCHAR(16) NOT NULL,
      turn INTEGER NOT NULL DEFAULT 1,
      seq INTEGER NOT NULL DEFAULT 0,
      api JSONB,
      display JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

-- commerce_messages.idx
CREATE INDEX IF NOT EXISTS commerce_messages_conv_idx ON commerce_messages (conversation_id, turn, seq);

-- commerce_leads.table
CREATE TABLE IF NOT EXISTS commerce_leads (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id VARCHAR(64) NOT NULL,
      conversation_id UUID,
      kind VARCHAR(16) NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'new',
      items JSONB NOT NULL DEFAULT '[]'::jsonb,
      total NUMERIC(14,2),
      currency VARCHAR(8),
      contact JSONB NOT NULL DEFAULT '{}'::jsonb,
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

-- commerce_leads.idx
CREATE INDEX IF NOT EXISTS commerce_leads_tenant_idx ON commerce_leads (tenant_id, created_at DESC);

-- commerce_events.table
CREATE TABLE IF NOT EXISTS commerce_events (
      id BIGSERIAL PRIMARY KEY,
      tenant_id VARCHAR(64) NOT NULL,
      kind VARCHAR(24) NOT NULL,
      conversation_id UUID,
      product_id UUID,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

-- commerce_events.idx
CREATE INDEX IF NOT EXISTS commerce_events_tenant_idx ON commerce_events (tenant_id, kind, created_at DESC);

-- commerce_changes.table
CREATE TABLE IF NOT EXISTS commerce_changes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id VARCHAR(64) NOT NULL,
      kind VARCHAR(24) NOT NULL,
      items JSONB NOT NULL DEFAULT '[]'::jsonb,
      note TEXT,
      status VARCHAR(16) NOT NULL DEFAULT 'staged',
      created_by VARCHAR(64) NOT NULL DEFAULT 'agent',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      applied_at TIMESTAMPTZ
    );

-- commerce_changes.idx
CREATE INDEX IF NOT EXISTS commerce_changes_tenant_idx ON commerce_changes (tenant_id, status, created_at DESC);

-- commerce_memory.table
CREATE TABLE IF NOT EXISTS commerce_memory (
      tenant_id VARCHAR(64) NOT NULL,
      subject_id VARCHAR(80) NOT NULL,
      key VARCHAR(64) NOT NULL,
      value VARCHAR(400) NOT NULL,
      category VARCHAR(16) NOT NULL DEFAULT 'preference',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, subject_id, key)
    );

-- commerce_settings.currency_default_eur
ALTER TABLE commerce_settings ALTER COLUMN currency SET DEFAULT 'EUR';

-- commerce_settings.social
ALTER TABLE commerce_settings ADD COLUMN IF NOT EXISTS social_status JSONB, ADD COLUMN IF NOT EXISTS social_accounts JSONB NOT NULL DEFAULT '{}'::jsonb;

-- commerce_posts.table
CREATE TABLE IF NOT EXISTS commerce_posts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id VARCHAR(64) NOT NULL,
      source VARCHAR(16) NOT NULL,
      post_id VARCHAR(120) NOT NULL,
      url TEXT NOT NULL,
      text TEXT NOT NULL DEFAULT '',
      image_url TEXT,
      taken_at TIMESTAMPTZ,
      transcript TEXT,
      on_screen TEXT,
      visual TEXT,
      views INTEGER,
      search_text TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (tenant_id, source, post_id)
    );

-- commerce_posts.idx
CREATE INDEX IF NOT EXISTS commerce_posts_tenant_idx ON commerce_posts (tenant_id, taken_at DESC);

-- commerce_posts.idx_fts
CREATE INDEX IF NOT EXISTS commerce_posts_fts_idx ON commerce_posts USING GIN (to_tsvector('simple', search_text));

-- commerce_posts.is_video
ALTER TABLE commerce_posts ADD COLUMN IF NOT EXISTS is_video BOOLEAN NOT NULL DEFAULT FALSE;

-- commerce_settings.starters
ALTER TABLE commerce_settings ADD COLUMN IF NOT EXISTS starters JSONB;

-- commerce_settings.notify_telegram
ALTER TABLE commerce_settings ADD COLUMN IF NOT EXISTS notify_telegram JSONB;

-- commerce_settings.gemini_key
ALTER TABLE commerce_settings ADD COLUMN IF NOT EXISTS gemini_key_encrypted TEXT;

-- commerce_settings.agent_notes
ALTER TABLE commerce_settings ADD COLUMN IF NOT EXISTS agent_notes TEXT NOT NULL DEFAULT '';

-- commerce_settings.owner_lang
ALTER TABLE commerce_settings ADD COLUMN IF NOT EXISTS owner_lang VARCHAR(8);

-- commerce_settings.app_name
ALTER TABLE commerce_settings ADD COLUMN IF NOT EXISTS app_name VARCHAR(12);

-- commerce_push_config.table
CREATE TABLE IF NOT EXISTS commerce_push_config (id INT PRIMARY KEY, public_key TEXT NOT NULL, private_key TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());

-- commerce_push_subs.table
CREATE TABLE IF NOT EXISTS commerce_push_subs (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id VARCHAR(64) NOT NULL, slug TEXT, visitor_id TEXT, conversation_id UUID, endpoint TEXT NOT NULL UNIQUE, keys JSONB NOT NULL, lang TEXT, ua TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_ok_at TIMESTAMPTZ, disabled_at TIMESTAMPTZ);

-- commerce_push_subs.idx
CREATE INDEX IF NOT EXISTS commerce_push_subs_tenant_idx ON commerce_push_subs (tenant_id, conversation_id, visitor_id);

-- commerce_push_jobs.table
CREATE TABLE IF NOT EXISTS commerce_push_jobs (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id VARCHAR(64) NOT NULL, conversation_id UUID, title TEXT NOT NULL, body TEXT NOT NULL, url TEXT, icon TEXT, send_at TIMESTAMPTZ NOT NULL DEFAULT now(), status VARCHAR(16) NOT NULL DEFAULT 'scheduled', sent INT NOT NULL DEFAULT 0, failed INT NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), sent_at TIMESTAMPTZ);

-- commerce_push_jobs.idx
CREATE INDEX IF NOT EXISTS commerce_push_jobs_due_idx ON commerce_push_jobs (status, send_at);

-- commerce_settings.pixels
ALTER TABLE commerce_settings ADD COLUMN IF NOT EXISTS pixels JSONB;

-- commerce_settings.consent
ALTER TABLE commerce_settings ADD COLUMN IF NOT EXISTS consent_enabled BOOLEAN NOT NULL DEFAULT false, ADD COLUMN IF NOT EXISTS privacy_url TEXT;

-- commerce_conversations.intent
ALTER TABLE commerce_conversations ADD COLUMN IF NOT EXISTS intent VARCHAR(8) NOT NULL DEFAULT 'cold', ADD COLUMN IF NOT EXISTS signals JSONB NOT NULL DEFAULT '[]'::jsonb, ADD COLUMN IF NOT EXISTS contact JSONB;

-- commerce_settings.owner_email
ALTER TABLE commerce_settings ADD COLUMN IF NOT EXISTS owner_email TEXT, ADD COLUMN IF NOT EXISTS email_notify BOOLEAN NOT NULL DEFAULT true, ADD COLUMN IF NOT EXISTS digest_enabled BOOLEAN NOT NULL DEFAULT true, ADD COLUMN IF NOT EXISTS digest_sent_on DATE;

-- commerce_visitors.table
CREATE TABLE IF NOT EXISTS commerce_visitors (tenant_id VARCHAR(64) NOT NULL, visitor_id VARCHAR(64) NOT NULL, first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(), visits INT NOT NULL DEFAULT 1, client JSONB NOT NULL DEFAULT '{}'::jsonb, geo JSONB, source TEXT, installed BOOLEAN NOT NULL DEFAULT false, PRIMARY KEY (tenant_id, visitor_id));

-- commerce_tg_links.table
CREATE TABLE IF NOT EXISTS commerce_tg_links (code VARCHAR(32) PRIMARY KEY, tenant_id VARCHAR(64) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), used_at TIMESTAMPTZ);
