// 使用服务端提供的北京时间日期计算整天数，避免手机时区影响正数和倒数。
function buildSlides(entries, today) {
  const currentDay = Date.parse(`${today}T00:00:00Z`);
  return (entries || []).map(entry => {
    const payload = entry.payload || {};
    const elapsed = Math.round((currentDay - Date.parse(`${payload.date}T00:00:00Z`)) / 86400000);
    if (!Number.isFinite(elapsed)) return null;
    const days = Math.abs(elapsed);
    return {
      id: entry.id,
      name: payload.name,
      typeLabel: payload.direction === 'down' ? '倒数日' : '纪念日',
      days,
      compact: String(days).length > 5,
      caption: elapsed === 0 ? '就是今天' : elapsed < 0 ? '还有' : payload.direction === 'down' ? '已过去' : '已走过',
      date: String(payload.date).replace(/-/g, '.'),
    };
  }).filter(Boolean);
}

Component({
  properties: { entries: { type: Array, value: [] }, today: String },
  data: { slides: [], current: 0, active: true },
  observers: {
    'entries,today'(entries, today) { this.updateSlides(entries, today); },
  },
  pageLifetimes: {
    show() { this.resetOnUpdate = true; this.setData({ active: true, current: 0 }); },
    hide() { this.setData({ active: false }); },
  },
  methods: {
    updateSlides(entries, today) {
      const slides = buildSlides(entries, today);
      const reset = this.resetOnUpdate;
      this.resetOnUpdate = false;
      // 首页每 5 秒刷新数据；内容未变时不重建 swiper，保留手动滑动与轮播进度。
      if (JSON.stringify(slides) === JSON.stringify(this.data.slides)) return;
      const selected = !reset && this.data.slides[this.data.current];
      const current = selected ? slides.findIndex(item => item.id === selected.id) : 0;
      this.setData({ slides, current: Math.max(0, current) });
    },
    change(event) {
      const current = Number(event.detail.current);
      if (Number.isInteger(current) && current >= 0 && current < this.data.slides.length && current !== this.data.current) {
        this.setData({ current });
      }
    },
    manage() { this.triggerEvent('manage'); },
  },
});
