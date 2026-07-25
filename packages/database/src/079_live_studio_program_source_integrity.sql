with selected as (
  select coalesce(
    (
      select settings.program_source_id
      from live_studio_settings settings
      join live_studio_sources source on source.source_id=settings.program_source_id
      where settings.id=true
    ),
    (
      select source_id
      from live_studio_sources
      where in_program=true
      order by slot_index,updated_at desc,source_id
      limit 1
    )
  ) as source_id
)
update live_studio_sources source
set in_program=(source.source_id=(select source_id from selected)),
    updated_at=case
      when source.in_program is distinct from (source.source_id=(select source_id from selected)) then now()
      else source.updated_at
    end
where source.in_program=true
   or source.source_id=(select source_id from selected);

update live_studio_settings settings
set program_source_id=(
      select source_id
      from live_studio_sources
      where in_program=true
      limit 1
    ),
    updated_at=now()
where settings.id=true
  and settings.program_source_id is distinct from (
    select source_id
    from live_studio_sources
    where in_program=true
    limit 1
  );

create unique index if not exists idx_live_studio_single_program_source
  on live_studio_sources ((1))
  where in_program=true;
