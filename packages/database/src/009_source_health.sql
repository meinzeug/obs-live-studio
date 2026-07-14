create index if not exists idx_source_checks_source_checked_at
  on source_checks(source_id,checked_at desc);
