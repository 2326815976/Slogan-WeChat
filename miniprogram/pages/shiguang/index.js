const sg = require('../../services/shiguang');
Page({
  data: { summary: null, error: '', letterOpen: false, modules: [
    { key: 'album', label: '专属空间', icon: '♡' }, { key: 'anniversary', label: '纪念日', icon: '◷' }, { key: 'wish', label: '许愿池', icon: '☆' }, { key: 'promise', label: '心约', icon: '☷' },
    { key: 'whisper', label: '絮语', icon: '♫' }, { key: 'mood', label: '心情', icon: '☺' }, { key: 'collection', label: '拾物采集', icon: '▧' }, { key: 'tickets', label: '心意奖券', icon: '♡' },
  ] },
  onShow() { this.load(); this.timer = setInterval(() => this.load(), 5000); },
  onHide() { clearInterval(this.timer); }, onUnload() { clearInterval(this.timer); },
  async load() { if (this.loading) return; this.loading = true; try { this.setData({ summary: await sg.summary(), error: '' }); await sg.refreshMembership(); } catch (e) { sg.fail(this, e); } finally { this.loading = false; } },
  toggleLetter() { this.setData({ letterOpen: !this.data.letterOpen }); },
  editProfile() { wx.navigateTo({ url: '/pages/shiguang/profile' }); },
  async open(e) { const key = e.currentTarget.dataset.key; try { if (key === 'album') { const link = await sg.api('/album'); wx.navigateTo({ url: link.miniPath }); } else wx.navigateTo({ url: key === 'tickets' ? '/pages/shiguang/tickets' : `/pages/shiguang/entries?kind=${key}` }); } catch (e) { sg.fail(this, e); } },
});
