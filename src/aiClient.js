// Keep the existing search strength while allowing the page to render and respond.
export function createAiClient(createWorker = () => new Worker(new URL('./aiWorker.js?v=async-ai-20261010-1', import.meta.url), { type: 'module' })) {
  let worker = null;
  let pending = null;
  let requestId = 0;

  function cancel() {
    worker?.terminate();
    worker = null;
    pending?.resolve(null);
    pending = null;
  }

  function choose(state, rankId) {
    cancel();
    return new Promise((resolve, reject) => {
      const id = ++requestId;
      pending = { resolve, reject };
      try {
        const current = createWorker();
        worker = current;
        const fail = (message) => {
          if (worker !== current) return;
          const task = pending;
          pending = null;
          current.terminate();
          worker = null;
          task?.reject(new Error(message));
        };
        current.onmessage = ({ data }) => {
          if (worker !== current || data.id !== id) return;
          if (data.error) { fail(data.error); return; }
          pending = null;
          current.terminate();
          worker = null;
          resolve(data.action);
        };
        current.onerror = (event) => { event.preventDefault?.(); fail(event.message || 'AI 计算失败'); };
        current.onmessageerror = () => fail('AI 结果读取失败');
        current.postMessage({ id, state, rankId });
      } catch (error) {
        pending = null;
        worker?.terminate();
        worker = null;
        reject(error);
      }
    });
  }

  return { choose, cancel };
}
