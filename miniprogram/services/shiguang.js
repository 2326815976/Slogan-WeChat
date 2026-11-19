const { requestJson, requestUpload } = require('../utils/cloudrun');
const config = require('../config');
const { getStoredCookie, subscribeStoredCookieClear } = require('../utils/auth');
const { downloadPrivateMedia, isPrivatePath, mapPrivateMedia } = require('../utils/shiguang-media');
const { resolvePublicUrl } = require('../utils/storage-url');
const { dbRpc } = require('./photo-api');

// 只在当前会话内复用已经授权下载的临时文件。
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
async function mediaLinks(refs, { avatarPreview = false } = {}) {
  const unique = [...new Set(refs.filter(isPrivatePath))];
  if (!unique.length) return {};
  const result = {};
  const global = getApp()?.globalData || {};
  const base = String(global.appUrl || global.cloudRunBaseUrl || config.appUrl || config.cloudRunBaseUrl || '').replace(/\/$/, '');
  const cacheKey = ref => `${base}${ref}:${avatarPreview ? 'avatar' : 'original'}`;
  const cookie = getStoredCookie(), requestedAt = Date.now();
  if (mediaCookie !== cookie) { mediaLinkCache.clear(); mediaCookie = cookie; }
  for (const [key, item] of mediaLinkCache) {
    if (item.expiresAt <= requestedAt) mediaLinkCache.delete(key);
  }
  const missing = unique.filter(ref => {
    const cached = mediaLinkCache.get(cacheKey(ref));
    if (cached) result[ref] = cached.url;
    return !cached;
  });
  await mapPrivateMedia(missing, async ref => {
    if (!cookie || getStoredCookie() !== cookie) return;
    let url = '';
    if (avatarPreview && ref.startsWith('/api/shiguang/media/')) {
      const preview = await api(`${ref.slice('/api/shiguang'.length)}?view=avatar`).catch(() => null);
      if (typeof preview?.image === 'string' && preview.image) url = `data:image/png;base64,${preview.image}`;
    }
    if (!url) url = await downloadPrivateMedia(ref, cookie).catch(() => '');
    if (!url || getStoredCookie() !== cookie) return;
    result[ref] = url;
    mediaLinkCache.set(cacheKey(ref), { url, expiresAt: requestedAt + 4 * 60000 });
  });
  if (getStoredCookie() !== cookie) throw new Error('登录状态已变化，请重新打开页面');
  return result;
}
function mediaDisplayUrl(reference, links) {
  const value = String(reference || '').trim();
  if (/^(?:(?:https?:)?\/\/[^/]+)?\/?api\/shiguang(?:\/|$)/i.test(value)) return links[value] || '';
  return value;
}
async function summary(previous) {
  const cookie = getStoredCookie();
  const data = await api();
  // 已显示的图片不随业务轮询更换 src；重新进入页面时再校验链接有效期。
  const links = {};
  if (previous && summarySessions.get(previous) === cookie &&
      previous.space.id === data.space.id && previous.publishState === data.publishState) {
    previous.space.members.forEach(m => { links[m.avatar] = m.avatarUrl; });
  }
  const refs = data.space.members.map(m => m.avatar);
  Object.assign(links, await mediaLinks(refs.filter(ref => !links[ref]), { avatarPreview: true }));
  if (getStoredCookie() !== cookie) throw new Error('登录状态已变化，请重新打开页面');
  data.space.members = data.space.members.map(member => ({
    ...member,
    avatarUrl: mediaDisplayUrl(member.avatar, links),
    todayMood: data.moods.find(entry => entry.createdBy === member.userId)?.payload.mood || '',
  }));
  summarySessions.set(data, cookie);
  return data;
}
async function boundAlbumAccessKey() {
  const link = await api('/album');
  const match = /^\/pages\/album\/detail\?key=([^&]+)$/.exec(link?.miniPath || '');
  if (!match) throw new Error('绑定的相册暂不可用');
  return decodeURIComponent(match[1]);
}

async function prepareAlbumThumbnail(photo, cookie) {
  const source = String(photo.thumbnail_url || '').trim();
  if (isPrivatePath(source)) {
    const thumbnail = `/api/shiguang/album-assets/${encodeURIComponent(photo.id)}?variant=thumbnail`;
    return source === thumbnail ? downloadPrivateMedia(source, cookie).catch(() => '') : '';
  }
  if (!source || source.startsWith('/api/')) return '';
  const url = resolvePublicUrl(source);
  if (!/^https?:\/\//i.test(url)) return '';
  return new Promise(resolve => {
    wx.getImageInfo({ src: url, success: info => resolve(info.path || url), fail: () => resolve('') });
  });
}

async function albumRootPhotos(isActive, onPhotos) {
  const cookie = getStoredCookie();
  const canLoad = () => isActive() && getStoredCookie() === cookie;
  const accessKey = await boundAlbumAccessKey();
  if (!canLoad()) return;
  const pageSize = 40;
  const readPage = async page => {
    const result = await dbRpc('get_album_photo_page', {
      input_key: accessKey, folder_id: '__ROOT__', page_no: page, page_size: pageSize,
    }, { keepPrivatePaths: true });
    if (result?.error || !Array.isArray(result?.data?.photos)) throw new Error('相册照片暂时无法加载');
    return result.data;
  };
  let payload = await readPage(1);
  const seen = new Set();
  let hasReadyPhoto = false;
  for (let page = 1; canLoad(); page += 1) {
    const photos = payload.photos.filter(photo => {
      if (!photo?.id || seen.has(photo.id) || String(photo.folder_id ?? '').trim()) return false;
      seen.add(photo.id);
      return true;
    });
    let cursor = 0;
    const settled = new Map();
    const previews = mapPrivateMedia(photos, async photo => {
      if (!canLoad()) return;
      const url = await prepareAlbumThumbnail(photo, cookie);
      settled.set(photo.id, url);
      if (!canLoad()) return;
      const available = [];
      while (cursor < photos.length && settled.has(photos[cursor].id)) {
        const { id, shot_date: shotDate } = photos[cursor++];
        const readyUrl = settled.get(id);
        settled.delete(id);
        if (readyUrl) available.push({ id, url: readyUrl, date: shotDate?.replace(/-/g, '.') || '' });
      }
      if (available.length) {
        hasReadyPhoto = true;
        onPhotos(available);
      }
    });
    const nextRequest = payload.has_more && payload.photos.length
      ? readPage(page + 1).then(data => ({ data }), error => ({ error }))
      : null;
    await previews;
    const nextPage = await nextRequest;
    if (!canLoad()) return;
    if (!nextPage) break;
    if (nextPage.error) throw nextPage.error;
    payload = nextPage.data;
  }
  if (seen.size && !hasReadyPhoto && canLoad()) throw new Error('相册照片暂时无法加载');
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
function getMembership(data = getApp()?.globalData) {
  const cookie = getStoredCookie();
  return data && cookie && cookie === membershipCookie ? data.shiguangMembership : null;
}
function updateMembership(result, cookie, data) {
  const previous = data?.shiguangMembership;
  const changed = membershipCookie !== cookie || JSON.stringify(previous) !== JSON.stringify(result);
  membershipCookie = cookie;
  if (data) data.shiguangMembership = result;
  if (changed) membershipListeners.forEach(listener => listener(result));
}
function invalidateMembership(statusCode, data = getApp()?.globalData) {
  const member = getMembership(data);
  // 空间停用仅移除入口；401 才表示登录失效。
  updateMembership(statusCode === 403 && member ? { ...member, enabled: false } : null, getStoredCookie(), data);
}
function subscribeMembership(listener) {
  membershipListeners.add(listener);
  listener(getMembership());
  return () => membershipListeners.delete(listener);
}
subscribeStoredCookieClear(() => {
  const data = membershipPending?.data ?? getApp()?.globalData;
  membershipPending = null;
  mediaLinkCache.clear();
  mediaCookie = '';
  updateMembership(null, '', data);
});
async function refreshMembership(data = getApp()?.globalData) {
  if (!data) return null;
  const cookie = getStoredCookie();
  if (!cookie) { updateMembership(null, '', data); return null; }
  if (membershipPending && membershipPending.cookie === cookie && membershipPending.data === data) return membershipPending.promise;
  if (membershipCookie !== cookie) updateMembership(null, cookie, data);
  const pending = { cookie, data, promise: null };
  membershipPending = pending;
  pending.promise = api('/membership').then(result => {
    if (getStoredCookie() !== cookie || membershipPending !== pending) return null;
    updateMembership(result, cookie, data);
    data.shiguangEntryFailed = false;
    return result;
  }).catch(error => {
    // 网络失败不等于解绑或退出；仅确定的权限拒绝清除入口。
    if (getStoredCookie() === cookie && membershipPending === pending && [401, 403].includes(error.statusCode)) invalidateMembership(error.statusCode, data);
    throw error;
  }).finally(() => { if (membershipPending === pending) membershipPending = null; });
  return pending.promise;
}
function withSpaceTab(items, loggedIn) {
  const member = getMembership();
  if (!loggedIn || !member || !member.enabled) return items;
  return [{ key: 'shiguang', iconKey: 'hearts', pagePath: 'pages/shiguang/index', displayText: '拾光' }, ...items];
}
async function chooseImage() {
  const data = getApp().globalData;
  data.shiguangMediaChoosing = true;
  try {
    return await new Promise((resolve, reject) => wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['camera', 'album'], success: result => resolve(result.tempFiles[0].tempFilePath), fail: reject }));
  } finally {
    data.shiguangMediaChoosing = false;
  }
}
function confirm(content) { return new Promise(resolve => wx.showModal({ title: '请确认', content, success: r => resolve(r.confirm), fail: () => resolve(false) })); }
let entryNavigation = null;
function reserveManualNavigation(data = getApp()?.globalData) {
  if (entryNavigation) return false;
  if (data) data.shiguangEntrySkippedSeq = data.appEnterSeq || 0;
  return true;
}
function preferSpaceEntry({ appEntry = false, appData: data = getApp()?.globalData } = {}) {
  if (!data) return false;
  const sequence = data.appEnterSeq || 0;
  if (data.shiguangEntrySkippedSeq === sequence) return false;
  const pages = getCurrentPages(), current = pages[pages.length - 1];
  if (current?.route?.startsWith('pages/admin/')) {
    data.shiguangEntrySkippedSeq = sequence;
    return false;
  }
  const member = getMembership(data);
  if (data.shiguangEntrySuspended || data.shiguangEntryChecking || data.shiguangEntryFailed || !member || !member.enabled) return false;
  const key = `${sequence}:${member.userId}`;
  if (data.shiguangEntryHandled === key) {
    return entryNavigation && entryNavigation.key === key ? entryNavigation.promise : Boolean(current && current.route === 'pages/shiguang/index');
  }
  if (pages.some(page => page.route === 'pages/shiguang/index')) {
    data.shiguangEntryHandled = key;
    return current.route === 'pages/shiguang/index';
  }
  if (!current || !appEntry && !['pages/index/index', 'pages/album/index', 'pages/gallery/index', 'pages/booking/index', 'pages/profile/index'].includes(current.route)) return false;
  if (current._shiguangRouteReady === false) {
    current._resumeShiguangEntry = () => preferSpaceEntry({ appEntry, appData: data });
    return false;
  }
  data.shiguangEntryHandled = key;
  let finish;
  const navigation = { key, promise: new Promise(resolve => { finish = resolve; }) };
  entryNavigation = navigation;
  const failed = () => {
    if (data.shiguangEntryHandled === key) data.shiguangEntryHandled = '';
    if (entryNavigation === navigation) entryNavigation = null;
    finish(false);
  };
  try {
    wx.reLaunch({
      url: '/pages/shiguang/index',
      success: () => finish(true),
      fail: failed,
      complete: () => { if (entryNavigation === navigation) entryNavigation = null; },
    });
  } catch (error) {
    failed();
  }
  return navigation.promise;
}
module.exports = { api, upload, mediaLinks, mediaDisplayUrl, summary, boundAlbumAccessKey, albumRootPhotos, uuid, time, manage, fail, getMembership, subscribeMembership, refreshMembership, withSpaceTab, chooseImage, confirm, preferSpaceEntry, reserveManualNavigation };
