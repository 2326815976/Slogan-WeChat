// 兼容已保存的旧链接，拾光管理统一在后台主体内展示。
Page({
  onLoad() { wx.redirectTo({ url: '/pages/admin/index?section=shiguang' }); },
});
