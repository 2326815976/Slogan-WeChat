const sg = require('../../services/shiguang');
Page({
  data: { name: '', avatar: '', avatarUrl: '', busy: false, error: '' },
  async onLoad() { try { const data = await sg.summary(); const self = data.space.members.find(m => m.userId === data.userId); this.setData({ name: self.name, avatar: self.avatar, avatarUrl: self.avatarUrl }); } catch (e) { sg.fail(this, e); } },
  nameInput(e) { this.setData({ name: e.detail.value }); },
  async avatar() { if (this.data.busy) return; this.setData({ busy: true }); try { const file = await sg.chooseImage(); const avatar = await sg.upload(file); this.setData({ avatar, avatarUrl: file }); } catch (e) { if (!String(e.errMsg || '').includes('cancel')) sg.fail(this, e); } finally { this.setData({ busy: false }); } },
  async save() { if (this.data.busy) return; this.setData({ busy: true }); try { await sg.api('/profile', 'POST', { name: this.data.name, avatar: this.data.avatar }); wx.navigateBack(); } catch (e) { sg.fail(this, e); } finally { this.setData({ busy: false }); } },
});
