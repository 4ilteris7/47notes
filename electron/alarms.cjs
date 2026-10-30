// Scheduling lives in the main process so hidden windows cannot throttle alarms.
function scheduledItems(data = {}) {
  const alarms = (Array.isArray(data.alarms) ? data.alarms : [])
    .filter(alarm => alarm && alarm.enabled !== false)
    .map(alarm => ({ id: alarm.id, title: alarm.title, scheduledAt: alarm.scheduledAt, source: 'alarm' }));
  const tasks = (Array.isArray(data.tasks) ? data.tasks : [])
    .filter(task => task && !task.done && task.reminderAt)
    .map(task => ({ id: task.id, title: task.title, scheduledAt: task.reminderAt, source: 'task' }));
  return [...alarms, ...tasks]
    .filter(item => typeof item.id === 'string' && item.id && typeof item.title === 'string' && Number.isFinite(Date.parse(item.scheduledAt)))
    .map(item => ({ ...item, scheduledAt: new Date(item.scheduledAt).toISOString(), key: `${item.source}:${item.id}:${new Date(item.scheduledAt).toISOString()}` }))
    .sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt));
}

class AlarmScheduler {
  constructor({ history = {}, saveHistory, deliver, now = Date.now, onError = () => {} }) {
    this.history = { ...history };
    this.saveHistory = saveHistory;
    this.deliver = deliver;
    this.now = now;
    this.onError = onError;
    this.items = [];
    this.checking = false;
  }

  update(data) {
    this.items = scheduledItems(data);
  }

  async check() {
    if (this.checking) return;
    this.checking = true;
    try {
      for (const item of this.items) {
        if (Date.parse(item.scheduledAt) > this.now() || this.history[item.key]) continue;
        const deliveredAt = new Date(this.now()).toISOString();
        const nextHistory = { ...this.history, [item.key]: deliveredAt };
        // Commit before delivery to prevent duplicate alerts after restart.
        await this.saveHistory(nextHistory);
        this.history = nextHistory;
        // Completion, deletion or rescheduling can happen while the write is pending.
        if (!this.items.some(current => current.key === item.key)) continue;
        await this.deliver({ ...item, deliveredAt });
      }
    } catch (error) {
      this.onError(error);
    } finally {
      this.checking = false;
    }
  }
}

module.exports = { AlarmScheduler, scheduledItems };
