import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiClient } from '../src/aiClient.js';

function harness() {
  const workers = [];
  const client = createAiClient(() => {
    const worker = { postMessage(data) { this.request = data; }, terminate() { this.terminated = true; } };
    workers.push(worker);
    return worker;
  });
  return { client, workers };
}

test('AI task carries the matched rank and returns the worker decision', async () => {
  const { client, workers } = harness();
  const state = { turn: 'ai', moveCount: 4 };
  const task = client.choose(state, 20);
  assert.equal(workers[0].request.rankId, 20);
  assert.equal(workers[0].request.state, state);
  const action = { type: 'reveal', index: 8 };
  workers[0].onmessage({ data: { id: workers[0].request.id, action } });
  assert.deepEqual(await task, action);
  assert(workers[0].terminated);
});

test('pause/restart cancels pending work and ignores late results', async () => {
  const { client, workers } = harness();
  const oldTask = client.choose({}, 20);
  const oldWorker = workers[0];
  client.cancel();
  assert.equal(await oldTask, null);
  assert(oldWorker.terminated);
  const nextTask = client.choose({}, 7);
  oldWorker.onmessage({ data: { id: oldWorker.request.id, action: { type: 'reveal', index: 0 } } });
  const worker = workers[1];
  worker.onmessage({ data: { id: worker.request.id, action: { type: 'reveal', index: 5 } } });
  assert.deepEqual(await nextTask, { type: 'reveal', index: 5 });
});

test('worker failures release the task and a later request can recover', async () => {
  const { client, workers } = harness();
  const task = client.choose({}, 20);
  workers[0].onerror({ message: 'worker failed' });
  await assert.rejects(task, /worker failed/);
  const retry = client.choose({}, 20);
  workers[1].onmessage({ data: { id: workers[1].request.id, action: null } });
  assert.equal(await retry, null);
});
