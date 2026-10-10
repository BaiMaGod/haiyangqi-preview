import { chooseAiAction } from './ai.js?v=ai-explore-20261006-1';

self.onmessage = ({ data: { id, state, rankId } }) => {
  try {
    self.postMessage({ id, action: chooseAiAction(state, { rankId }) });
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};
