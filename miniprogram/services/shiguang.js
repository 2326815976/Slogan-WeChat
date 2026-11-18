const { requestJson, requestUpload } = require('../utils/cloudrun');
const config = require('../config');
const { getStoredCookie, subscribeStoredCookieClear } = require('../utils/auth');

// 临时链接有效期为 5 分钟；按会话缓存，提前 1 分钟重新申请。
const mediaLinkCache = new Map();
const summarySessions = new WeakMap();
let mediaCookie = '';

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const n = Math.floor(Math.random() * 16);
    return (c === 'x' ? n : (n & 3) | 8).toString(16);
  });
}
async function api(path = '', method = 'GET', data) {
  const route = path.startsWith('admin/') ? `/api/${path}` : `/api/shiguang${path}`;
  const result = await requestJson(route, { method, data, header: { 'X-Shiguang-Channel': 'miniprogram' }, skipAuthRetry: true });
  return result.data;
}
async function upload(filePath, admin = false, audio = false) {
  const result = await requestUpload('/api/shiguang/media', {
    filePath, name: 'file', fileName: audio ? 'recording.mp3' : filePath.split('/').pop(),
    ...(audio ? { contentType: 'audio/mpeg' } : {}), formData: admin ? { purpose: 'admin' } : {},
  });
  return result.data.reference;
}
async function mediaLinks(refs) {
  const unique = [...new Set(refs.filter(s => /^\/api\/shiguang\/media\//.test(s || '')))];
  if (!unique.length) return {};
  const result = {};
  const app = getApp(), global = app.globalData || {};
  const base = String(global.appUrl || global.cloudRunBaseUrl || config.appUrl || config.cloudRunBaseUrl || '').replace(/\/$/, '');
  const cookie = getStoredCookie(), requestedAt = Date.now();
  if (mediaCookie !== cookie) { mediaLinkCache.clear(); mediaCookie = cookie; }
  for (const [key, item] of mediaLinkCache) {
    if (item.expiresAt <= requestedAt) mediaLinkCache.delete(key);
  }
  const missing = unique.filter(ref => {
    const cached = mediaLinkCache.get(`${base}${ref}`);
    if (cached) result[ref] = cached.url;
    return !cached;
  });
  for (let i = 0; i < missing.length; i += 100) {
    const links = await api('/media-links', 'POST', { ids: missing.slice(i, i + 100).map(ref => ref.split('/').pop()) });
    if (getStoredCookie() !== cookie) throw new Error('登录状态已变化，请重新打开页面');
    Object.keys(links).forEach(ref => {
      result[ref] = `${base}${links[ref]}`;
      mediaLinkCache.set(`${base}${ref}`, { url: result[ref], expiresAt: requestedAt + 4 * 60000 });
    });
  }
  return result;
}
async function summary(previous) {
  const cookie = getStoredCookie();
  const data = await api();
  // 已显示的图片不随业务轮询更换 src；重新进入页面时再校验链接有效期。
  const links = {};
  if (previous && summarySessions.get(previous) === cookie &&
      previous.space.id === data.space.id && previous.publishState === data.publishState) {
    links[previous.space.cover] = previous.space.coverUrl;
    previous.space.members.forEach(m => { links[m.avatar] = m.avatarUrl; });
  }
  const refs = [data.space.cover, ...data.space.members.map(m => m.avatar)];
  Object.assign(links, await mediaLinks(refs.filter(ref => !links[ref])));
  if (getStoredCookie() !== cookie) throw new Error('登录状态已变化，请重新打开页面');
  data.space.coverUrl = links[data.space.cover] || data.space.cover;
  data.space.members = data.space.members.map(m => ({ ...m, avatarUrl: links[m.avatar] || m.avatar, todayMood: (data.moods.find(e => e.createdBy === m.userId) || {}).payload?.mood || '今日未记录' }));
  summarySessions.set(data, cookie);
  return data;
}
function time(value) { return value ? new Date(new Date(value).getTime() + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ') : ''; }
function manage(entry, data) { return ['anniversary', 'wish', 'promise'].includes(entry.kind) || entry.createdBy === data.userId && (entry.kind !== 'mood' || entry.moodDate === data.today); }
function fail(page, error) {
  page.setData({ error: error.message || '请求失败，请重试' });
  if ([401, 403].includes(error.statusCode) && !page.route.startsWith('pages/admin/')) {
    invalidateMembership(error.statusCode);
    wx.switchTab({ url: '/pages/index/index' });
  }
}
let membershipPending = null;
let membershipCookie = '';
const membershipListeners = new Set();
function getMembership() {
  const cookie = getStoredCookie();
  return cookie && cookie === membershipCookie ? getApp().globalData.shiguangMembership : null;
}
function updateMembership(result, cookie) {
  const previous = getApp().globalData.shiguangMembership;
  const changed = membershipCookie !== cookie || JSON.stringify(previous) !== JSON.stringify(result);
  membershipCookie = cookie;
  getApp().globalData.shiguangMembership = result;
  if (changed) membershipListeners.forEach(listener => listener(result));
}
function invalidateMembership(statusCode) {
  const member = getMembership();
  // 空间停用仅移除入口；401 才表示登录失效。
  updateMembership(statusCode === 403 && member ? { ...member, enabled: false } : null, getStoredCookie());
}
function subscribeMembership(listener) {
  membershipListeners.add(listener);
  listener(getMembership());
  return () => membershipListeners.delete(listener);
}
subscribeStoredCookieClear(() => {
  membershipPending = null;
  mediaLinkCache.clear();
  mediaCookie = '';
  updateMembership(null, '');
});
async function refreshMembership() {
  const cookie = getStoredCookie();
  if (!cookie) { updateMembership(null, ''); return null; }
  if (membershipPending && membershipPending.cookie === cookie) return membershipPending.promise;
  if (membershipCookie !== cookie) updateMembership(null, cookie);
  const pending = { cookie, promise: null };
  membershipPending = pending;
  pending.promise = api('/membership').then(result => {
    if (getStoredCookie() !== cookie || membershipPending !== pending) return null;
    updateMembership(result, cookie);
    return result;
  }).catch(error => {
    // 网络失败不等于解绑或退出；仅确定的权限拒绝清除入口。
    if (getStoredCookie() === cookie && membershipPending === pending && [401, 403].includes(error.statusCode)) invalidateMembership(error.statusCode);
    throw error;
  }).finally(() => { if (membershipPending === pending) membershipPending = null; });
  return pending.promise;
}
function withSpaceTab(items, loggedIn) {
  const member = getMembership();
  if (!loggedIn || !member || !member.enabled) return items;
  return [{ key: 'shiguang', iconKey: 'hearts', pagePath: 'pages/shiguang/index', displayText: '拾光' }, ...items];
}
function chooseImage() { return new Promise((resolve, reject) => wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['camera', 'album'], success: result => resolve(result.tempFiles[0].tempFilePath), fail: reject })); }
function confirm(content) { return new Promise(resolve => wx.showModal({ title: '请确认', content, success: r => resolve(r.confirm), fail: () => resolve(false) })); }
function preferSpaceEntry() {
  const app = getApp(), data = app.globalData, member = getMembership();
  if (!member || !member.enabled) return;
  const key = `${data.appEnterSeq || 0}:${member.userId}`;
  if (data.shiguangEntryHandled === key) return;
  const pages = getCurrentPages(), current = pages[pages.length - 1];
  if (current && current.route === 'pages/shiguang/index') {
    data.shiguangEntryHandled = key;
    return;
  }
  if (!current || !['pages/index/index', 'pages/album/index', 'pages/gallery/index', 'pages/booking/index', 'pages/profile/index'].includes(current.route)) return;
  data.shiguangEntryHandled = key;
  wx.reLaunch({ url: '/pages/shiguang/index' });
}
module.exports = { api, upload, mediaLinks, summary, uuid, time, manage, fail, getMembership, subscribeMembership, refreshMembership, withSpaceTab, chooseImage, confirm, preferSpaceEntry };
