export function sourceHealth(sources){
  const successful=sources.filter(s=>s.status==='ok'||s.status==='stale').length;
  const overdue=sources.filter(s=>s.status==='stale').length;
  const failed=sources.filter(s=>s.status==='unavailable').length;
  const pending=sources.filter(s=>s.status==='pending').length;
  const text=sources.length?`${successful} / ${sources.length} sources passed their last check${overdue?' · '+overdue+' overdue':''}`:'Connecting to sources';
  return {successful,overdue,failed,pending,text};
}
