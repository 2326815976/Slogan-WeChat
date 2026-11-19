const sg = require('../../services/shiguang');
const AVATAR_MAX_LONG_EDGE = 512;

function compressAvatar(filePath) {
  return new Promise((resolve, reject) => {
    wx.getImageInfo({
      src: filePath,
      success(info) {
        const width = Number(info.width), height = Number(info.height);
        const longEdge = Math.max(width, height);
        const ratio = Number.isFinite(longEdge) && longEdge > AVATAR_MAX_LONG_EDGE ? AVATAR_MAX_LONG_EDGE / longEdge : 1;
        const options = { src: filePath, quality: 80 };
        if (ratio < 1) {
          options.compressedWidth = Math.max(1, Math.round(width * ratio));
          options.compressedHeight = Math.max(1, Math.round(height * ratio));
        }
        wx.compressImage({
          ...options,
          success(result) {
            if (result?.tempFilePath) resolve(result.tempFilePath);
            else reject(new Error('头像压缩失败，请重新选择'));
          },
          fail() { reject(new Error('头像压缩失败，请重新选择')); },
        });
      },
      fail() { reject(new Error('无法读取所选头像，请重新选择')); },
    });
  });
}

Page({
  data: { profileReady: false, loading: true, name: '', avatar: '', avatarUrl: '', busy: false, error: '' },
  async onLoad() {
    try {
      const data = await sg.summary();
      const self = data.space.members.find(member => member.userId === data.userId);
      if (!self) throw new Error('未找到当前空间成员资料');
      this.setData({ name: self.name, avatar: self.avatar, avatarUrl: self.avatarUrl, profileReady: true });
    } catch (error) { sg.fail(this, error); }
    finally { this.setData({ loading: false }); }
  },
  nameInput(event) { this.setData({ name: event.detail.value, error: '' }); },
  async changeAvatar() {
    if (this.data.busy) return;
    this.setData({ busy: true, error: '' });
    try {
      const file = await sg.chooseImage();
      const compressedFile = await compressAvatar(file);
      const avatar = await sg.upload(compressedFile);
      this.setData({ avatar, avatarUrl: compressedFile, error: '' });
    } catch (error) {
      if (!String(error.errMsg || '').includes('cancel')) sg.fail(this, error);
    } finally { this.setData({ busy: false }); }
  },
  async save() {
    if (this.data.busy) return;
    const name = String(this.data.name || '').trim();
    if (!name) { this.setData({ error: '请填写昵称' }); return; }
    this.setData({ busy: true, error: '' });
    try {
      await sg.api('/profile', 'POST', { name, avatar: this.data.avatar });
      wx.navigateBack();
    } catch (error) { sg.fail(this, error); }
    finally { this.setData({ busy: false }); }
  },
});
