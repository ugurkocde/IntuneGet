# Database Setup

This guide covers configuring Supabase for IntuneGet.

## Overview

IntuneGet uses Supabase (PostgreSQL) for:
- Storing deployment status and history
- Real-time updates via Supabase Realtime
- App catalog metadata

## Options

### Option 1: Supabase Cloud (Recommended)

Easiest option with a generous free tier.

1. Create account at [supabase.com](https://supabase.com)
2. Create a new project
3. Run migrations
4. Copy credentials to environment

### Option 2: Self-Hosted Supabase

For enterprises requiring data sovereignty.

See [Supabase Self-Hosting Docs](https://supabase.com/docs/guides/self-hosting)

### Option 3: Plain PostgreSQL

IntuneGet can work with plain PostgreSQL, but you'll lose:
- Real-time subscriptions (deployment status updates)
- Supabase Auth (if used in future)
- Supabase Studio for management

## Supabase Cloud Setup

### Step 1: Create Project

1. Go to [supabase.com](https://supabase.com)
2. Sign up or log in
3. Click **New Project**
4. Fill in:
   - **Name**: `intuneget`
   - **Database Password**: Generate a strong password
   - **Region**: Choose closest to your users
5. Click **Create new project**
6. Wait for project to provision

### Step 2: Run Migrations

The database schema is defined in `supabase/migrations/`.

**Option A: Using Supabase CLI**

```bash
# Install Supabase CLI
npm install -g supabase

# Login to Supabase
supabase login

# Link to your project
supabase link --project-ref your-project-ref

# Run migrations
supabase db push
```

**Option B: Using SQL Editor**

1. Go to your Supabase project dashboard
2. Click **SQL Editor** in the left menu
3. Open each file in `supabase/migrations/` in order
4. Copy contents and run in SQL Editor

### Step 3: Get Credentials

1. Go to **Settings** > **API** in your Supabase dashboard
2. Copy these values:

| Setting | Environment Variable |
|---------|---------------------|
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` |
| anon public | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| service_role | `SUPABASE_SERVICE_ROLE_KEY` |

## Database Schema

### Tables

#### `deployments`

Tracks all deployment requests and their status.

```sql
CREATE TABLE deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  app_id TEXT NOT NULL,
  app_name TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  error_message TEXT,
  intune_app_id TEXT,
  workflow_run_id TEXT
);
```

#### `apps`

Stores app catalog metadata.

```sql
CREATE TABLE apps (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  publisher TEXT,
  version TEXT,
  description TEXT,
  icon_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Row Level Security (RLS)

RLS policies ensure users can only access their own data:

```sql
-- Users can only see their own deployments
CREATE POLICY "Users can view own deployments"
  ON deployments FOR SELECT
  USING (auth.uid()::text = user_id);

-- Service role can insert/update all deployments
CREATE POLICY "Service can manage deployments"
  ON deployments FOR ALL
  USING (auth.role() = 'service_role');
```

## Real-Time Configuration

IntuneGet uses Supabase Realtime for live deployment status updates.

### Enable Realtime

1. Go to **Database** > **Replication** in Supabase dashboard
2. Enable replication for the `deployments` table

### Client Configuration

The app subscribes to deployment updates:

```typescript
supabase
  .channel('deployments')
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'deployments',
    filter: `user_id=eq.${userId}`
  }, handleUpdate)
  .subscribe()
```

## Backup and Recovery

### Automated Backups (Supabase Cloud)

- Free tier: Daily backups, 7-day retention
- Pro tier: Point-in-time recovery

### Manual Backup

```bash
# Using pg_dump
pg_dump -h db.your-project.supabase.co \
  -U postgres \
  -d postgres \
  -F c \
  -f backup.dump

# Restore
pg_restore -h db.your-project.supabase.co \
  -U postgres \
  -d postgres \
  backup.dump
```

## Performance Optimization

### Indexes

Recommended indexes for production:

```sql
-- Speed up deployment queries by user
CREATE INDEX idx_deployments_user_id ON deployments(user_id);

-- Speed up deployment queries by tenant
CREATE INDEX idx_deployments_tenant_id ON deployments(tenant_id);

-- Speed up status filtering
CREATE INDEX idx_deployments_status ON deployments(status);

-- Composite index for common queries
CREATE INDEX idx_deployments_user_status ON deployments(user_id, status);
```

### Connection Pooling

For high-traffic deployments, use Supabase's connection pooler:

1. Go to **Settings** > **Database**
2. Copy the **Connection pooling** URL
3. Use for server-side connections

## Troubleshooting

### "Permission denied" errors

Check RLS policies are correctly configured:

```sql
-- View existing policies
SELECT * FROM pg_policies WHERE tablename = 'deployments';
```

### Real-time not working

1. Verify table is enabled for replication
2. Check browser console for WebSocket errors
3. Verify `NEXT_PUBLIC_SUPABASE_ANON_KEY` is correct

### Connection timeouts

1. Check if project is paused (free tier pauses after inactivity)
2. Verify network allows connections to Supabase
3. Check connection string is correct

## Migration from Other Databases

If migrating from another database:

1. Export data in CSV format
2. Use Supabase import tools or `COPY` command
3. Verify data integrity
4. Update application configuration
