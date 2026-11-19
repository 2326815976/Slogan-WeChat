const config = require('../config');
const { getStoredCookie } = require('./auth');

const PRIVATE_PATH = /^\/api\/shiguang\/(?:media|album-assets)\/[a-f0-9-]{36}(?:\?variant=(?:cover|thumbnail|preview|original))?$/i;

function isPrivatePath(path) {
  return PRIVATE_PATH.test(path || '');
}

async function downloadPrivateMedia(path, cookie = getStoredCookie()) {
  if (!isPrivatePath(path) || !cookie || cookie !== getStoredCookie()) throw new Error('空间媒体不可访问');
  const global = getApp()?.globalData || {};
  const origin = String(global.appUrl || global.cloudRunBaseUrl || config.appUrl || config.cloudRunBaseUrl || '').replace(/\/$/, '');
  if (!/^https:\/\/[^/]+$/i.test(origin)) throw new Error('空间媒体服务不可用');
  const result = await new Promise((resolve, reject) => {
    wx.downloadFile({
      url: `${origin}${path}`,
      header: { Cookie: cookie, 'X-Shiguang-Channel': 'miniprogram' },
      timeout: 20000,
      success: resolve,
      fail: reject,
    });
  });
  if (cookie !== getStoredCookie() || result?.statusCode !== 200 || !result.tempFilePath) throw new Error('空间媒体不可访问');
  return result.tempFilePath;
}

async function mapPrivateMedia(items, resolve) {
  const result = [];
  for (let offset = 0; offset < items.length; offset += 6) {
    result.push(...await Promise.all(items.slice(offset, offset + 6).map(resolve)));
  }
  return result;
}

module.exports = { downloadPrivateMedia, isPrivatePath, mapPrivateMedia };
