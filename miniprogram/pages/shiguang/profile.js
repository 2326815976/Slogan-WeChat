const sg = require('../../services/shiguang');
Page({
  data: { profile: null, formOpen: false, name: '', avatar: '', avatarUrl: '', busy: false, error: '' },
  async onLoad() {
    try {
      const data = await sg.summary();
      const self = data.space.members.find(member => member.userId === data.userId);
      const profile = { name: self.name, avatar: self.avatar, avatarUrl: self.avatarUrl };
      this.setData({ profile, ...profile, formOpen: true });
    } catch (error) { sg.fail(this, error); }
  },
  open() { if (this.data.profile && !this.data.busy) this.setData({ ...this.data.profile, formOpen: true, error: '' }); },
  close() { if (!this.data.busy) this.setData({ formOpen: false, error: '' }); },
  nameInput(e) { this.setData({ name: e.detail.value }); },
  async avatar() { if (this.data.busy) return; this.setData({ busy: true }); try { const file = await sg.chooseImage(); const avatar = await sg.upload(file); this.setData({ avatar, avatarUrl: file }); } catch (e) { if (!String(e.errMsg || '').includes('cancel')) sg.fail(this, e); } finally { this.setData({ busy: false }); } },
  async save() {
    if (this.data.busy) return;
    const { name, avatar, avatarUrl } = this.data;
    this.setData({ busy: true, error: '' });
    try {
      await sg.api('/profile', 'POST', { name, avatar });
      this.setData({ profile: { name, avatar, avatarUrl }, formOpen: false });
      wx.navigateBack();
    } catch (error) { sg.fail(this, error); }
    finally { this.setData({ busy: false }); }
  },
});
