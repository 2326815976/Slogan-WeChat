const sg = require('../../services/shiguang');
const { getStoredCookie, subscribeStoredCookieClear } = require('../../utils/auth');
const { loadHomePreview, loadWhisperImages } = require('./home-preview');
const OVERVIEW_REFRESH_INTERVAL = 5000;
const OVERVIEW_ROTATION_INTERVAL = 6000;
const FIRST_ALBUM_PHOTO_WAIT_MS = 8000;

// 使用服务端提供的北京时间日期计算整天数，避免手机时区影响正数和倒数。
function buildAnniversarySlides(entries, today) {
  const currentDay = Date.parse(`${today}T00:00:00Z`);
  return (entries || []).map(entry => {
    const payload = entry.payload || {};
    const elapsed = Math.round((currentDay - Date.parse(`${payload.date}T00:00:00Z`)) / 86400000);
    if (!Number.isFinite(elapsed)) return null;
    const days = Math.abs(elapsed);
    return {
      id: entry.id,
      name: payload.name,
      days,
      compact: String(days).length > 5,
      caption: elapsed === 0 ? '就是今天' : elapsed < 0 ? '还有' : payload.direction === 'down' ? '已过去' : '已走过',
      date: String(payload.date).replace(/-/g, '.'),
    };
  }).filter(Boolean);
}

function stepIndex(current, count, step) {
  return count > 1 ? (current + count + step) % count : 0;
}

Page({
  data: { summary: null, error: '', overviewLoading: true, letterOpen: false, albumPhotos: [], albumPhotoIndex: 0,
  albumNextIndex: 0, albumPreviousIndex: 0, albumTouchBlocked: false,
  anniversarySlides: [], anniversaryIndex: 0, albumPreviewError: false,
  homePreview: null, homePreviewFailed: false, whisperScope: 'latest', whisperMediaState: '', whisperVideoUrl: '', quickMoods: [
    { name: '开心', icon: '😄', tone: 'happy' },
    { name: '平静', icon: '😌', tone: 'calm' },
    { name: '难过', icon: '😢', tone: 'sad' },
  ], moodOpen: false, moodExpanded: false,
  moodCurrent: '', moodName: '', moodDescription: '', moodError: '', moodSaving: false },
  onLoad() {
    this.sessionCookie = getStoredCookie();
    this.unsubscribeCookieClear = subscribeStoredCookieClear(() => this.resetOverview(''));
  },
  onShow() {
    this.hidden = false;
    this.homePreviewRequest = null;
    sg.preferSpaceEntry();
    clearInterval(this.timer);
    void this.load();
    this.scheduleOverviewRotation();
    this.timer = setInterval(() => this.load(), OVERVIEW_REFRESH_INTERVAL);
  },
  onHide() { this.stopRefreshing(); },
  onUnload() {
    this.stopRefreshing();
    this.summaryRequest = null;
    this.albumPreviewRequest = null;
    this.clearAlbumWaitTimer();
    this.unsubscribeCookieClear?.();
  },
  stopRefreshing() {
    this.hidden = true;
    this.clearWhisperMedia();
    this.homePreviewRequest = null;
    clearInterval(this.timer);
    this.clearOverviewTimer();
  },
  resetOverview(cookie) {
    this.sessionCookie = cookie;
    this.clearWhisperMedia();
    this.homePreviewRequest = null;
    this.summaryRequest = null;
    this._summary = null;
    this.albumPreviewRequest = null;
    this.clearAlbumWaitTimer();
    this.clearOverviewTimer();
    this.setAlbumSlide([], 0, {
      summary: null, error: '', overviewLoading: true, albumPreviewError: false,
      anniversarySlides: [], anniversaryIndex: 0, letterOpen: false, moodOpen: false,
      homePreview: null, homePreviewFailed: false, whisperScope: 'latest',
      moodCurrent: '', moodName: '', moodDescription: '', moodError: '',
    });
  },
  async load() {
    const cookie = getStoredCookie();
    if (this.sessionCookie !== cookie) this.resetOverview(cookie);
    if (this.summaryRequest) return;
    const request = {};
    this.summaryRequest = request;
    const isActive = () => !this.hidden && this.summaryRequest === request && getStoredCookie() === cookie;
    const moodRevision = this.moodRevision;
    try {
      if (cookie && !this._summary) void this.loadAlbumPreview();
      const summary = await sg.summary(this._summary);
      if (!isActive()) return;
      this._summary = summary;
      void this.loadAlbumPreview(summary.album?.id || '');
      if (moodRevision === this.moodRevision) this.updateSummary(summary);
      void this.loadHomePreview(summary);
      this.scheduleOverviewRotation();
      await sg.refreshMembership();
      if (isActive()) sg.preferSpaceEntry();
    } catch (error) {
      if (!isActive()) return;
      if ([401, 403].includes(error.statusCode)) this.resetOverview(cookie);
      sg.fail(this, error);
    } finally {
      if (this.summaryRequest === request) this.summaryRequest = null;
    }
  },
  updateSummary(summary) {
    const patch = { summary, error: '' };
    const anniversarySlides = buildAnniversarySlides(summary.anniversaries, summary.today);
    if (JSON.stringify(anniversarySlides) !== JSON.stringify(this.data.anniversarySlides)) {
      const selected = this.data.anniversarySlides[this.data.anniversaryIndex];
      patch.anniversarySlides = anniversarySlides;
      patch.anniversaryIndex = selected ? Math.max(0, anniversarySlides.findIndex(slide => slide.id === selected.id)) : 0;
    }
    this.setData(patch);
  },
  async loadHomePreview(summary) {
    const scope = `${summary.space.id}:${summary.userId}`;
    if (this.homePreviewRequest?.scope === scope) return;
    if (this.homePreviewScope !== scope) {
      this.homePreviewScope = scope;
      this.setData({ homePreview: null, homePreviewFailed: false, whisperScope: 'latest' });
    }
    const request = { scope };
    this.homePreviewRequest = request;
    const cookie = this.sessionCookie;
    const isActive = () => !this.hidden && this.homePreviewRequest === request && getStoredCookie() === cookie;
    try {
      const homePreview = await loadHomePreview(summary);
      if (!isActive()) return;
      this.setData({ homePreview, homePreviewFailed: false });
      const imageUrls = await loadWhisperImages(homePreview.whispers).catch(() => null);
      if (imageUrls && isActive()) {
        this.setData({
          'homePreview.whispers.latest.imageUrl': imageUrls.latest,
          'homePreview.whispers.mine.imageUrl': imageUrls.mine,
        });
      }
    } catch {
      if (isActive()) this.setData({ homePreviewFailed: true });
    }
  },
  selectWhisperScope(event) {
    const { scope } = event.currentTarget.dataset;
    if (scope === this.data.whisperScope) return;
    this.clearWhisperMedia();
    this.setData({ whisperScope: scope });
  },
  clearWhisperMedia() {
    this.whisperMediaRequest = null;
    const audio = this.whisperAudio;
    this.whisperAudio = null;
    audio?.destroy();
    if (this.data.whisperMediaState || this.data.whisperVideoUrl) this.setData({ whisperMediaState: '', whisperVideoUrl: '' });
  },
  async openWhisperAttachment() {
    const { whisperScope, whisperMediaState } = this.data;
    const attachment = this.data.homePreview?.whispers[whisperScope];
    if (!attachment?.single || whisperMediaState === 'loading') return;
    const { single, reference } = attachment;
    if (single === 'audio' && this.whisperAudio) {
      if (whisperMediaState === 'playing') this.whisperAudio.pause();
      else {
        this.setData({ whisperMediaState: 'loading' });
        this.whisperAudio.play();
      }
      return;
    }
    const request = this.whisperMediaRequest = {};
    const cookie = this.sessionCookie;
    const isActive = () => !this.hidden && this.whisperMediaRequest === request && getStoredCookie() === cookie;
    this.setData({ whisperMediaState: 'loading' });
    try {
      const url = sg.mediaDisplayUrl(reference, await sg.mediaLinks([reference]));
      if (!isActive()) return;
      if (!url) throw new Error('媒体暂时无法打开');
      if (single === 'image') {
        wx.previewImage({ urls: [url], fail: () => {
          if (isActive()) wx.showToast({ title: '原图暂时无法打开', icon: 'none' });
        } });
      } else if (single === 'video') {
        this.setData({ whisperVideoUrl: url });
      } else {
        const audio = this.whisperAudio = wx.createInnerAudioContext();
        const setPlayback = state => {
          if (isActive() && this.whisperAudio === audio) this.setData({ whisperMediaState: state });
        };
        audio.onPlay(() => setPlayback('playing'));
        audio.onPause(() => setPlayback(''));
        audio.onEnded(() => setPlayback(''));
        audio.onError(() => {
          if (!isActive() || this.whisperAudio !== audio) return;
          this.clearWhisperMedia();
          wx.showToast({ title: '音频暂时无法播放', icon: 'none' });
        });
        audio.src = url;
        audio.play();
      }
    } catch {
      if (isActive()) {
        this.clearWhisperMedia();
        const title = single === 'image' ? '原图暂时无法打开' : single === 'video' ? '视频暂时无法播放' : '音频暂时无法播放';
        wx.showToast({ title, icon: 'none' });
      }
    } finally {
      if (isActive() && !this.whisperAudio) this.setData({ whisperMediaState: '' });
    }
  },
  closeWhisperVideo() { this.setData({ whisperVideoUrl: '' }); },
  onWhisperVideoError() {
    this.closeWhisperVideo();
    wx.showToast({ title: '视频暂时无法播放', icon: 'none' });
  },
  onWhisperImageError(event) {
    const { scope, url } = event.currentTarget.dataset;
    if (this.data.homePreview?.whispers[scope]?.imageUrl === url) {
      this.setData({ [`homePreview.whispers.${scope}.imageUrl`]: '' });
    }
  },
  openMyCards() { wx.navigateTo({ url: '/pages/shiguang/tickets?section=cards' }); },
  async loadAlbumPreview(albumId) {
    const previous = this.albumPreviewRequest;
    if (previous && (albumId === undefined || (albumId && (!previous.albumId || previous.albumId === albumId)))) {
      if (albumId) previous.albumId = albumId;
      return;
    }
    if (previous) {
      this.albumPreviewRequest = null;
      this.clearAlbumWaitTimer();
      this.clearOverviewTimer();
      this.setAlbumSlide([], 0, { overviewLoading: !this.data.summary, albumPreviewError: false });
    }
    if (albumId === '') {
      if (this.data.overviewLoading) this.setData({ overviewLoading: false });
      return;
    }
    const request = { albumId, pending: true };
    this.albumPreviewRequest = request;
    const cookie = this.sessionCookie;
    const isActive = () => this.albumPreviewRequest === request && request.pending && getStoredCookie() === cookie;
    if (this.data.overviewLoading) {
      this.albumWaitTimer = setTimeout(() => {
        if (isActive()) this.setData({ overviewLoading: false });
      }, FIRST_ALBUM_PHOTO_WAIT_MS);
    }
    try {
      await sg.albumRootPhotos(isActive, photos => {
        if (!isActive()) return;
        this.clearAlbumWaitTimer();
        const { albumPhotos, albumPhotoIndex } = this.data;
        this.setAlbumSlide([...albumPhotos, ...photos], albumPhotoIndex, { overviewLoading: false, albumPreviewError: false });
        this.scheduleOverviewRotation();
      });
    } catch {
      if (isActive() && !this.data.albumPhotos.length) this.setData({ albumPreviewError: true });
    } finally {
      if (isActive()) {
        request.pending = false;
        this.clearAlbumWaitTimer();
        if (this.data.overviewLoading) this.setData({ overviewLoading: false });
        this.scheduleOverviewRotation();
      }
    }
  },
  clearAlbumWaitTimer() {
    clearTimeout(this.albumWaitTimer);
    this.albumWaitTimer = null;
  },
  setAlbumSlide(photos, current, patch = {}) {
    const next = stepIndex(current, photos.length, 1);
    const previous = stepIndex(current, photos.length, -1);
    const sources = [current, next, previous].map(index => photos[index]?.url).filter(Boolean);
    const loaded = this.loadedAlbumSources || new Set();
    this.loadedAlbumSources = new Set(sources.filter(url => loaded.has(url)));
    if (photos !== this.data.albumPhotos) patch.albumPhotos = photos;
    this.setData({
      ...patch,
      albumPhotoIndex: current,
      albumNextIndex: next,
      albumPreviousIndex: previous,
      albumTouchBlocked: photos.length > 1 && !sources.every(url => loaded.has(url)),
    });
  },
  onAlbumPhotoLoad(event) {
    const { url } = event.currentTarget.dataset;
    const { albumPhotos, albumPhotoIndex, albumNextIndex, albumPreviousIndex } = this.data;
    const sources = [albumPhotoIndex, albumNextIndex, albumPreviousIndex].map(index => albumPhotos[index]?.url);
    if (!sources.includes(url) || this.loadedAlbumSources.has(url)) return;
    this.loadedAlbumSources.add(url);
    if (this.data.albumTouchBlocked && sources.every(source => this.loadedAlbumSources.has(source))) {
      this.setData({ albumTouchBlocked: false });
    }
    this.scheduleOverviewRotation();
  },
  onAlbumPhotoError(event) {
    const { id, url } = event.currentTarget.dataset;
    const { albumPhotos, albumPhotoIndex } = this.data;
    const failedIndex = albumPhotos.findIndex(photo => photo.id === id && photo.url === url);
    if (failedIndex < 0) return;
    const photos = albumPhotos.filter((_, index) => index !== failedIndex);
    const current = failedIndex < albumPhotoIndex ? albumPhotoIndex - 1 : Math.min(albumPhotoIndex, Math.max(0, photos.length - 1));
    this.setAlbumSlide(photos, current, { albumPreviewError: !photos.length });
    this.scheduleOverviewRotation();
  },
  clearOverviewTimer() {
    clearTimeout(this.overviewTimer);
    this.overviewTimer = null;
    this.overviewDue = false;
  },
  scheduleOverviewRotation() {
    const { summary, overviewLoading, albumPhotos, albumPhotoIndex, albumNextIndex, anniversarySlides } = this.data;
    const loadingAlbum = this.albumPreviewRequest?.pending;
    if (this.hidden || !summary || overviewLoading || this.overviewTimer) return;
    if (loadingAlbum ? !albumPhotos.length : albumPhotos.length < 2 && anniversarySlides.length < 2) return;
    if (this.overviewDue) {
      if (loadingAlbum && albumPhotoIndex + 1 >= albumPhotos.length) return;
      if (albumPhotos.length > 1 && !this.loadedAlbumSources.has(albumPhotos[albumNextIndex].url)) return;
      this.overviewDue = false;
      this.stepOverview(1);
    }
    this.overviewTimer = setTimeout(() => {
      this.overviewTimer = null;
      this.overviewDue = true;
      this.scheduleOverviewRotation();
    }, OVERVIEW_ROTATION_INTERVAL);
  },
  stepOverview(step) {
    const { albumPhotos, albumPhotoIndex, anniversarySlides, anniversaryIndex } = this.data;
    this.setAlbumSlide(albumPhotos, stepIndex(albumPhotoIndex, albumPhotos.length, step), {
      anniversaryIndex: stepIndex(anniversaryIndex, anniversarySlides.length, step),
    });
  },
  changeOverviewSlide(event) {
    const { current, source } = event.detail;
    if (this.hidden || source !== 'touch') return;
    const isAlbum = event.currentTarget.dataset.carousel === 'album';
    const { albumPhotos, albumPhotoIndex, anniversarySlides, anniversaryIndex } = this.data;
    const count = isAlbum ? albumPhotos.length : anniversarySlides.length;
    const previous = isAlbum ? albumPhotoIndex : anniversaryIndex;
    if (!Number.isInteger(current) || current < 0 || current >= count || current === previous) return;
    const step = current === stepIndex(previous, count, 1) ? 1 : -1;
    this.setAlbumSlide(albumPhotos, isAlbum ? current : stepIndex(albumPhotoIndex, albumPhotos.length, step), {
      anniversaryIndex: isAlbum ? stepIndex(anniversaryIndex, anniversarySlides.length, step) : current,
    });
    this.clearOverviewTimer();
    this.scheduleOverviewRotation();
  },
  openMood() {
    const { summary, moodSaving } = this.data;
    if (!summary || moodSaving) return;
    const entry = summary.moods.find(mood => mood.createdBy === summary.userId);
    const name = entry?.payload.mood || '';
    this.setData({ moodOpen: true, moodExpanded: false, moodCurrent: name,
      moodName: name, moodDescription: entry?.payload.description || '', moodError: '' });
  },
  closeMood() { if (!this.data.moodSaving) this.setData({ moodOpen: false }); },
  toggleMoodDetails() { this.setData({ moodExpanded: !this.data.moodExpanded }); },
  editMoodName(event) { this.setData({ moodName: event.detail.value }); },
  editMoodDescription(event) { this.setData({ moodDescription: event.detail.value }); },
  pickMood(event) { return this.saveMood(event.currentTarget.dataset.mood); },
  submitMood() { return this.saveMood(this.data.moodName, this.data.moodDescription); },
  async saveMood(name, description) {
    const { summary, moodSaving, moodOpen } = this.data;
    if (!summary || moodSaving || !moodOpen) return;
    const mood = name.trim();
    if (!mood) { this.setData({ moodError: '请输入心情' }); return; }
    const entry = summary.moods.find(record => record.createdBy === summary.userId);
    const payload = { mood, description: (description ?? entry?.payload.description ?? '').trim() };
    this.setData({ moodSaving: true, moodError: '' });
    try {
      const saved = entry
        ? await sg.api(`/mood/${entry.id}`, 'PUT', { version: entry.version, payload })
        : await sg.api('/mood', 'POST', { id: sg.uuid(), payload });
      if (this.hidden) return;
      const current = this.data.summary;
      if (current?.space.id === summary.space.id && current.today === saved.moodDate) {
        this.moodRevision = (this.moodRevision || 0) + 1;
        const memberIndex = current.space.members.findIndex(member => member.userId === current.userId);
        this.setData({
          'summary.moods': [...current.moods.filter(record => record.createdBy !== current.userId), saved],
          [`summary.space.members[${memberIndex}].todayMood`]: saved.payload.mood,
          moodOpen: false,
        });
      } else {
        this.setData({ moodOpen: false });
        await this.load();
      }
    } catch (error) {
      if (!this.hidden) {
        this.setData({ moodError: error.message || '保存失败，请重试' });
        if (error.statusCode === 409) await this.load();
      }
    } finally {
      this.setData({ moodSaving: false });
    }
  },
  openMoodHistory() {
    if (!this.data.moodOpen || this.data.moodSaving || this.openingMoodHistory) return;
    this.openingMoodHistory = true;
    wx.navigateTo({
      url: '/pages/shiguang/entries?kind=mood',
      success: () => this.closeMood(),
      complete: () => { this.openingMoodHistory = false; },
    });
  },
  toggleLetter() { this.setData({ letterOpen: !this.data.letterOpen }); },
  editProfile(event) {
    if (event.currentTarget.dataset.userId !== this.data.summary?.userId) return;
    wx.navigateTo({ url: '/pages/shiguang/profile' });
  },
  async open(e) {
    const { key } = e.currentTarget.dataset;
    try {
      if (key === 'album') {
        const link = await sg.api('/album');
        const albumTitle = this.data.summary?.album?.title?.trim();
        const titleParam = albumTitle ? `&albumTitle=${encodeURIComponent(albumTitle)}` : '';
        wx.navigateTo({ url: `${link.miniPath}${titleParam}` });
        return;
      }
      wx.navigateTo({ url: key === 'tickets' ? '/pages/shiguang/tickets' : `/pages/shiguang/entries?kind=${key}` });
    } catch (error) {
      sg.fail(this, error);
    }
  },
});
