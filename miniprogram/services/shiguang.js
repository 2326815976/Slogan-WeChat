const { requestJson, requestUpload } = require('../utils/cloudrun');
const config = require('../config');
const { getStoredCookie } = require('../utils/auth');

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
  for (let i = 0; i < unique.length; i += 100) {
    const links = await api('/media-links', 'POST', { ids: unique.slice(i, i + 100).map(ref => ref.split('/').pop()) });
    Object.keys(links).forEach(ref => { result[ref] = `${base}${links[ref]}`; });
  }
  return result;
}
async function summary() {
  const data = await api();
  const links = await mediaLinks([data.space.cover, ...data.space.members.map(m => m.avatar)]);
  data.space.coverUrl = links[data.space.cover] || data.space.cover;
  data.space.members = data.space.members.map(m => ({ ...m, avatarUrl: links[m.avatar] || m.avatar, todayMood: (data.moods.find(e => e.createdBy === m.userId) || {}).payload?.mood || '今日未记录' }));
  return data;
}
function time(value) { return value ? new Date(new Date(value).getTime() + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ') : ''; }
function manage(entry, data) { return ['anniversary', 'wish', 'promise'].includes(entry.kind) || entry.createdBy === data.userId && (entry.kind !== 'mood' || entry.moodDate === data.today); }
function fail(page, error) {
  page.setData({ error: error.message || '请求失败，请重试' });
  if ([401, 403].includes(error.statusCode) && !page.route.startsWith('pages/admin/')) {
    getApp().globalData.shiguangMembership = null;
    wx.switchTab({ url: '/pages/index/index' });
  }
}
let membershipPending = null;
let membershipCookie = '';
async function refreshMembership() {
  const app = getApp();
  if (!getStoredCookie()) { app.globalData.shiguangMembership = null; return null; }
  if (membershipPending) return membershipPending;
  const cookie = getStoredCookie();
  membershipPending = api('/membership').then(result => {
    if (getStoredCookie() !== cookie) return null;
    membershipCookie = cookie;
    app.globalData.shiguangMembership = result; return result;
  }).catch(error => { app.globalData.shiguangMembership = null; throw error; }).finally(() => { membershipPending = null; });
  return membershipPending;
}
function withSpaceTab(items, loggedIn) {
  const member = getApp().globalData.shiguangMembership;
  if (!loggedIn || !getStoredCookie() || getStoredCookie() !== membershipCookie || !member || !member.enabled) return items;
  return [{ key: 'shiguang', iconKey: 'hearts', pagePath: 'pages/shiguang/index', displayText: '拾光' }, ...items];
}
function chooseImage() { return new Promise((resolve, reject) => wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['camera', 'album'], success: result => resolve(result.tempFiles[0].tempFilePath), fail: reject })); }
function confirm(content) { return new Promise(resolve => wx.showModal({ title: '请确认', content, success: r => resolve(r.confirm), fail: () => resolve(false) })); }
function preferSpaceEntry() {
  const app = getApp(), data = app.globalData, member = data.shiguangMembership;
  if (!member || !member.enabled) return;
  const key = `${data.appEnterSeq || 0}:${member.userId}`;
  if (data.shiguangEntryHandled === key) return;
  const pages = getCurrentPages(), current = pages[pages.length - 1];
  if (!current || !['pages/index/index', 'pages/album/index', 'pages/gallery/index', 'pages/booking/index', 'pages/profile/index'].includes(current.route)) return;
  data.shiguangEntryHandled = key;
  wx.reLaunch({ url: '/pages/shiguang/index' });
}
module.exports = { api, upload, mediaLinks, summary, uuid, time, manage, fail, refreshMembership, withSpaceTab, chooseImage, confirm, preferSpaceEntry };
