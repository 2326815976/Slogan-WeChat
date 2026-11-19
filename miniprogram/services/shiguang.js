const { requestJson, requestUpload } = require('../utils/cloudrun');
const { dbRpc } = require('./photo-api');
const config = require('../config');
const { getStoredCookie, subscribeStoredCookieClear } = require('../utils/auth');
const { resolvePublicUrl } = require('../utils/storage-url');
const { downloadPrivateMedia, isPrivatePath, mapPrivateMedia } = require('../utils/shiguang-media');

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
async function albumRootPhotos(isActive, onFirstPhoto) {
  const cookie = getStoredCookie();
  const canLoad = () => isActive() && getStoredCookie() === cookie;
  const resolvePhoto = async photo => {
    if (!canLoad()) return null;
    try {
      const url = isPrivatePath(photo.url) ? await downloadPrivateMedia(photo.url, cookie) : resolvePublicUrl(photo.url);
      return canLoad() && url ? { id: photo.id, url } : null;
    } catch {
      return null;
    }
  };
  const link = await api('/album');
  const match = /[?&]key=([^&]+)/.exec(link?.miniPath || '');
  if (!match) throw new Error('绑定的相册暂不可用');
  const accessKey = decodeURIComponent(match[1]);
  const pageSize = 40;
  const photos = new Map();
  let firstPhotoId;
  let firstPhotoTask;

  for (let page = 1; canLoad(); page += 1) {
    const result = await dbRpc('get_album_photo_page', {
      input_key: accessKey, folder_id: '__ROOT__', page_no: page, page_size: pageSize,
    }, { keepPrivatePaths: true });
    if (!canLoad()) return null;
    const payload = result?.data;
    const rows = payload?.photos;
    if (result?.error || !Array.isArray(rows)) throw new Error('相册照片暂时无法加载');
    for (const photo of rows) {
      if (!photo?.id || String(photo.folder_id ?? '').trim()) continue;
      const url = photo.thumbnail_url || photo.preview_url || photo.original_url || photo.url;
      if (url && !photos.has(photo.id)) photos.set(photo.id, { id: photo.id, url });
    }
    if (!firstPhotoTask && photos.size) {
      const firstPhoto = photos.values().next().value;
      firstPhotoId = firstPhoto.id;
      firstPhotoTask = (async () => {
        const prepared = await resolvePhoto(firstPhoto);
        if (!prepared) return null;
        try {
          const info = await new Promise((resolve, reject) => {
            wx.getImageInfo({ src: prepared.url, success: resolve, fail: reject });
          });
          if (!canLoad()) return null;
          const preview = isPrivatePath(firstPhoto.url) ? prepared : { ...prepared, url: info.path || prepared.url };
          onFirstPhoto(preview);
          return preview;
        } catch {
          return null;
        }
      })();
    }
    const hasMore = typeof payload.has_more === 'boolean' ? payload.has_more : page * pageSize < Number(payload.total);
    if (!hasMore) {
      const remaining = [...photos.values()].filter(photo => photo.id !== firstPhotoId);
      const [firstPhoto, local] = await Promise.all([firstPhotoTask, mapPrivateMedia(remaining, resolvePhoto)]);
      return canLoad() ? [firstPhoto, ...local].filter(Boolean) : null;
    }
    if (!rows.length) throw new Error('相册照片暂时无法加载');
  }
  return null;
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
module.exports = { api, upload, mediaLinks, mediaDisplayUrl, summary, albumRootPhotos, uuid, time, manage, fail, getMembership, subscribeMembership, refreshMembership, withSpaceTab, chooseImage, confirm, preferSpaceEntry, reserveManualNavigation };
