const sg = require('../../services/shiguang');
Page({
  data: { summary: null, error: '', letterOpen: false, modules: [
    { key: 'album', label: '专属空间', icon: '♡', description: '重温镜头里的我们' }, { key: 'anniversary', label: '纪念日', icon: '◷', description: '记住每个特别的日子' }, { key: 'wish', label: '许愿池', icon: '☆', description: '让小愿望慢慢实现' }, { key: 'promise', label: '心约', icon: '☷', description: '写下两个人的约定' },
    { key: 'whisper', label: '絮语', icon: '♫', description: '有些话，只想说给你' }, { key: 'mood', label: '心情', icon: '☺', description: '分享今天的晴与雨' }, { key: 'collection', label: '拾物采集', icon: '▧', description: '收藏路上的小美好' }, { key: 'tickets', label: '心意奖券', icon: '♡', description: '把偏爱变成小惊喜' },
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
