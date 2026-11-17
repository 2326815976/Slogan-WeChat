const sg = require('../../services/shiguang');
const labels = { anniversary: '纪念日', wish: '许愿池', promise: '心约', whisper: '絮语', mood: '心情', collection: '拾物采集' };
Page({
  data: { kind: '', title: '', summary: null, items: [], page: 0, hasMore: false, date: '', formOpen: false, editing: null, replyId: '', busy: false, error: '', loaded: false },
  onLoad(options) { const kind = labels[options.kind] ? options.kind : 'anniversary'; this.setData({ kind, title: labels[kind] }); },
  onShow() { this.load(); this.timer = setInterval(() => this.refreshSummary(), 5000); },
  onHide() { clearInterval(this.timer); if (this.audio) this.audio.stop(); },
  onUnload() { clearInterval(this.timer); if (this.audio) this.audio.destroy(); },
  async refreshSummary() { try { this.setData({ summary: await sg.api() }); } catch (e) { sg.fail(this, e); } },
  async load(page = 0) {
    if (this.loading) return; this.loading = true;
    try {
      const responses = await Promise.all([sg.api(), sg.api(`/${this.data.kind}?page=${page}${this.data.date ? `&date=${this.data.date}` : ''}`)]);
      const summary = responses[0], result = responses[1];
      const links = await sg.mediaLinks(result.items.flatMap(e => [e.payload.image, e.payload.audio]));
      const items = result.items.map(e => ({ ...e, canManage: sg.manage(e, summary), author: (summary.space.members.find(m => m.userId === e.createdBy) || {}).name, time: sg.time(e.createdAt), imageUrl: links[e.payload.image], audioUrl: links[e.payload.audio], days: e.kind === 'anniversary' ? Math.round((Date.parse(`${summary.today}T00:00:00Z`) - Date.parse(`${e.payload.date}T00:00:00Z`)) / 86400000) * (e.payload.direction === 'down' ? -1 : 1) : 0 }));
      this.setData({ summary, items: page ? this.data.items.concat(items) : items, page, hasMore: result.hasMore, error: '', loaded: true });
    } catch (e) { sg.fail(this, e); } finally { this.loading = false; }
  },
  more() { this.load(this.data.page + 1); },
  date(e) { this.setData({ date: e.detail.value }); this.load(); }, clearDate() { this.setData({ date: '' }); this.load(); },
  add() { const s = this.data.summary; const own = s && this.data.kind === 'mood' ? s.moods.find(e => e.createdBy === s.userId) : null; this.setData({ formOpen: true, editing: own || null }); },
  edit(e) { const entry = this.data.items.find(i => i.id === e.currentTarget.dataset.id); if (entry.canManage) this.setData({ formOpen: true, editing: entry }); },
  cancel() { this.setData({ formOpen: false, editing: null }); }, saved() { this.cancel(); this.load(); },
  replies(e) { this.setData({ replyId: this.data.replyId === e.currentTarget.dataset.id ? '' : e.currentTarget.dataset.id }); },
  async play(e) { try { const entry = this.data.items.find(i => i.id === e.currentTarget.dataset.id); const links = await sg.mediaLinks([entry.payload.audio]); if (!this.audio) this.audio = wx.createInnerAudioContext(); this.audio.src = links[entry.payload.audio]; this.audio.play(); } catch (e) { sg.fail(this, e); } },
  async remove(e) { if (this.data.busy || !await sg.confirm(this.data.kind === 'whisper' ? '删除絮语及其全部回复？' : '删除这条记录？')) return; this.setData({ busy: true }); try { const entry = this.data.items.find(i => i.id === e.currentTarget.dataset.id); await sg.api(`/${this.data.kind}/${entry.id}`, 'DELETE', { version: entry.version }); await this.load(); } catch (e) { sg.fail(this, e); } finally { this.setData({ busy: false }); } },
});
