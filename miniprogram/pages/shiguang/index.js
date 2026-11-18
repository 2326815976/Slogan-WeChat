const sg = require('../../services/shiguang');
Page({
  data: { summary: null, error: '', letterOpen: false, modules: [
    { key: 'wish', label: '许愿池' }, { key: 'promise', label: '心约' },
    { key: 'whisper', label: '絮语' }, { key: 'mood', label: '心情' },
    { key: 'collection', label: '拾物采集' }, { key: 'tickets', label: '心意奖券' },
  ] },
  onShow() {
    this.hidden = false;
    this._summary = null;
    sg.preferSpaceEntry();
    clearInterval(this.timer);
    this.load();
    this.timer = setInterval(() => this.load(), 5000);
  },
  onHide() { this.hidden = true; clearInterval(this.timer); },
  onUnload() { this.onHide(); },
  async load() {
    if (this.loading) return;
    this.loading = true;
    try {
      const summary = await sg.summary(this._summary);
      if (this.hidden) return;
      this._summary = summary;
      this.setData({ summary, error: '' });
      await sg.refreshMembership();
      if (!this.hidden) sg.preferSpaceEntry();
    } catch (e) {
      if (!this.hidden) sg.fail(this, e);
    } finally { this.loading = false; }
  },
  toggleLetter() { this.setData({ letterOpen: !this.data.letterOpen }); },
  editProfile() { wx.navigateTo({ url: '/pages/shiguang/profile' }); },
  async open(e) { const key = e.currentTarget.dataset.key; try { if (key === 'album') { const link = await sg.api('/album'); wx.navigateTo({ url: link.miniPath }); } else wx.navigateTo({ url: key === 'tickets' ? '/pages/shiguang/tickets' : `/pages/shiguang/entries?kind=${key}` }); } catch (e) { sg.fail(this, e); } },
});
