export const ToastMessages = {
  APP_READY: 'Toast System Ready!',
  PINNED: '🔒 Always on top',
  UNPINNED: '🔓 Sometime on top',
  TIMER_START: (mins: number) => `🚀 ${mins} mins focus mode engaged!`,
  TIMER_DONE: "⏰ Time's up! You survived!",
  REOPENED: (title: string) => `↩ Restored: "${title}"`,
  NO_CLOSED_NOTES: 'No closed notes to restore',
};
