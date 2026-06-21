import { writable } from 'svelte/store';

interface ToastState {
  message: string;
  visible: boolean;
}

export const toastState = writable<ToastState>({
  message: '',
  visible: false,
});

let timeoutId: ReturnType<typeof setTimeout>;

export function showToast(message: string) {
  clearTimeout(timeoutId);
  toastState.set({ message, visible: true });
  
  const savedDuration = localStorage.getItem('toastDuration');
  const duration = savedDuration ? parseInt(savedDuration) : 3000;
  
  timeoutId = setTimeout(() => {
    hideToast();
  }, duration);
}

export function hideToast() {
  clearTimeout(timeoutId);
  toastState.update(state => ({ ...state, visible: false }));
}
