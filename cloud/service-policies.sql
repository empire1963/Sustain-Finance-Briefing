create policy sustain_sources_service_access on public.sustain_sources
  for all to service_role using (true) with check (true);
create policy sustain_collector_service_access on public.sustain_collector
  for all to service_role using (true) with check (true);
