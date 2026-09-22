import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceHealth } from '../dist/source-health.js';
test('overdue successful sources are not misreported as failed publishers',()=>{
  const h=sourceHealth(Array.from({length:17},()=>({status:'stale'})));
  assert.equal(h.successful,17);assert.equal(h.failed,0);assert.equal(h.overdue,17);
  assert.match(h.text,/17 \/ 17 sources passed their last check/);assert.match(h.text,/17 overdue/);
});
test('actual failures, pending checks and overdue successes remain distinct',()=>{
  const h=sourceHealth([{status:'ok'},{status:'stale'},{status:'unavailable'},{status:'pending'}]);
  assert.deepEqual({successful:h.successful,failed:h.failed,overdue:h.overdue,pending:h.pending},{successful:2,failed:1,overdue:1,pending:1});
});
