create index if not exists idx_sessions_expires_at on sessions(expires_at);
alter table sessions add column if not exists user_agent text;
alter table sessions add column if not exists ip_address inet;
