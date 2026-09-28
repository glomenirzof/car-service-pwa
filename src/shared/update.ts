import {UPDATE_EVENT} from '@/components/app/UpdatePrompt';

export function announceUpdate(apply: () => void) {
  window.dispatchEvent(new CustomEvent(UPDATE_EVENT, {detail: apply}));
}
