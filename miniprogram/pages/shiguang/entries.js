const sg = require('../../services/shiguang');
const { openMedia } = require('./components/message-media');
const entryPages = {
  anniversary: { title: '纪念日', actionLabel: '新增纪念日', emptyLabel: '还没有纪念日，记下第一个特别的日子吧。' },
  wish: { title: '许愿池', actionLabel: '写下愿望', emptyLabel: '暂无愿望' },
  promise: { title: '心约', actionLabel: '写下约定', emptyLabel: '还没有约定，写下一件想一起做的事吧。' },
  whisper: { title: '絮语', actionLabel: '写一则絮语', emptyLabel: '还没有絮语，留下一句想对对方说的话吧。' },
  mood: { title: '心情', actionLabel: '记录今日心情', emptyLabel: '还没有心情记录。' },
};
Page({
  data: { kind: '', title: '', actionLabel: '', emptyLabel: '', summary: null, items: [], page: 0, hasMore: false, date: '', formOpen: false, editing: null, replyId: '', busy: false, error: '', loaded: false, loading: false },
  onLoad(options) {
    if (options.kind === 'collection') {
      this.setData({ title: '拾物采集', loaded: true, error: '拾物采集暂未开放' });
      return;
    }
    const kind = Object.prototype.hasOwnProperty.call(entryPages, options.kind) ? options.kind : 'anniversary';
    this.setData({ kind, ...entryPages[kind] });
  },
  onShow() {
    this.visible = true;
    if (!this.data.kind) return;
    this.load();
    this.timer = setInterval(() => this.refreshSummary(), 5000);
  },
  onHide() { this.visible = false; clearInterval(this.timer); if (this.audio) this.audio.stop(); },
  onUnload() { this.visible = false; clearInterval(this.timer); if (this.audio) this.audio.destroy(); },
  async refreshSummary() { try { this.setData({ summary: await sg.api() }); } catch (e) { sg.fail(this, e); } },
  async load(page = 0) {
    if (page && (this.data.loading || !this.data.hasMore)) return;
    const request = {};
    const { kind, date } = this.data;
    this.entriesRequest = request;
    this.setData({ loading: true, error: '' });
    try {
      const responses = await Promise.all([sg.api(), sg.api(`/${kind}?page=${page}${date ? `&date=${date}` : ''}`)]);
      if (this.entriesRequest !== request) return;
      const summary = responses[0], result = responses[1];
      const imagePath = entry => entry.payload.image ? `${entry.payload.image}?variant=preview` : '';
      const links = await sg.mediaLinks(result.items.map(imagePath));
      if (this.entriesRequest !== request) return;
      const items = result.items.map(e => ({ ...e, canManage: sg.manage(e, summary), author: (summary.space.members.find(m => m.userId === e.createdBy) || {}).name, time: sg.time(e.createdAt), imageUrl: links[imagePath(e)] || '', days: e.kind === 'anniversary' ? Math.round((Date.parse(`${summary.today}T00:00:00Z`) - Date.parse(`${e.payload.date}T00:00:00Z`)) / 86400000) * (e.payload.direction === 'down' ? -1 : 1) : 0 }));
      this.setData({ summary, items: page ? this.data.items.concat(items) : items, page, hasMore: result.hasMore, error: '', loaded: true });
    } catch (error) {
      if (this.entriesRequest === request) sg.fail(this, error);
    } finally {
      if (this.entriesRequest === request) this.setData({ loading: false });
    }
  },
  more() { this.load(this.data.page + 1); },
  changeDate(event) { this.filterDate(event.detail.value); },
  clearDate() { this.filterDate(''); },
  filterDate(date) {
    if (date === this.data.date) return;
    this.setData({ date, items: [], page: 0, hasMore: false, loaded: false });
    this.load();
  },
  add() { const s = this.data.summary; const own = s && this.data.kind === 'mood' ? s.moods.find(e => e.createdBy === s.userId) : null; this.setData({ formOpen: true, editing: own || null }); },
  edit(e) { const entry = this.data.items.find(i => i.id === e.currentTarget.dataset.id); if (entry.canManage) this.setData({ formOpen: true, editing: entry }); },
  async toggleWish(event) {
    const { kind, busy, loading, items } = this.data;
    if (kind !== 'wish' || busy || loading) return;
    const { id } = event.currentTarget.dataset;
    const entry = items.find(item => item.id === id);
    if (!entry?.canManage) return;
    const status = entry.payload.status === 'fulfilled' ? 'pending' : 'fulfilled';
    this.setData({ busy: true, error: '' });
    try {
      await sg.api(`/wish/${id}`, 'PUT', { version: entry.version, payload: { ...entry.payload, status } });
      if (this.visible) await this.load();
    } catch (error) {
      if (!this.visible) return;
      if (error.statusCode === 409) {
        await this.load();
        if (this.visible && !this.data.error) wx.showToast({ title: '愿望已变化，请重试', icon: 'none' });
      } else {
        sg.fail(this, error);
      }
    } finally {
      this.setData({ busy: false });
    }
  },
  cancel() { this.setData({ formOpen: false, editing: null }); }, saved() { this.cancel(); this.load(); },
  replies(e) { this.setData({ replyId: e.currentTarget.dataset.id }); },
  closeReplies() { this.setData({ replyId: '' }); },
  async play(event) {
    const reference = event.currentTarget.dataset.reference;
    const request = this.audioRequest = {};
    try {
      const url = sg.mediaDisplayUrl(reference, await sg.mediaLinks([reference]));
      if (!this.visible || this.audioRequest !== request) return;
      if (!url) throw new Error('音频暂时无法播放');
      if (!this.audio) this.audio = wx.createInnerAudioContext();
      this.audio.src = url;
      this.audio.play();
    } catch (error) { if (this.visible) sg.fail(this, error); }
  },
  async openAttachment(event) {
    const { reference, field } = event.currentTarget.dataset;
    try { await openMedia(reference, field, () => this.visible); }
    catch (error) { if (this.visible) sg.fail(this, error); }
  },
  async remove(e) { if (this.data.busy || !await sg.confirm(this.data.kind === 'whisper' ? '删除絮语及其全部回复？' : '删除这条记录？')) return; this.setData({ busy: true }); try { const entry = this.data.items.find(i => i.id === e.currentTarget.dataset.id); await sg.api(`/${this.data.kind}/${entry.id}`, 'DELETE', { version: entry.version }); await this.load(); } catch (e) { sg.fail(this, e); } finally { this.setData({ busy: false }); } },
});
