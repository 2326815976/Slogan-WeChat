const sg = require('../../services/shiguang');
const { openMedia } = require('./components/message-media');
const { getVideoAspectRatio, getVideoMetadata } = require('./utils/media-info');
const { cleanTopic, topicSegments } = require('./utils/topics');
function formatAudioDuration(value) {
  const seconds = Number(value) > 0 ? Math.round(Number(value)) : 0;
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
function entryMedia(payload = {}) {
  const seen = new Set();
  const items = [
    ...(Array.isArray(payload.media) ? payload.media : []),
    ...(payload.image ? [{ type: 'image', reference: payload.image }] : []),
    ...(payload.video ? [{ type: 'video', reference: payload.video }] : []),
  ];
  return items.filter(item => {
    const type = item?.type === 'video' ? 'video' : item?.type === 'image' ? 'image' : '';
    const reference = String(item?.reference || '').trim();
    const key = `${type}:${reference}`;
    if (!type || !reference || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 3);
}
const entryPages = {
  anniversary: { title: '纪念日', actionLabel: '新增纪念日', emptyLabel: '暂无纪念日' },
  wish: { title: '许愿池', actionLabel: '写下愿望', emptyLabel: '暂无愿望' },
  promise: { title: '心约', actionLabel: '写下约定', emptyLabel: '暂无约定' },
  whisper: { title: '絮语', actionLabel: '写絮语', emptyLabel: '暂无絮语' },
  mood: { title: '心情', actionLabel: '记录今日心情', emptyLabel: '暂无心情记录' },
};
Page({
  data: {
    kind: '', title: '', actionLabel: '', emptyLabel: '', summary: null, items: [], page: 0, hasMore: false,
    date: '', dateLabel: '时间', topic: '', keyword: '', topicInput: '', author: '', authorIndex: 0, authorLabel: '全部发布人', authorOptions: [{ userId: '', name: '全部发布人' }],
    formOpen: false, editing: null, replyId: '', busy: false, error: '', loaded: false, loading: false,
    whisperAudioId: '', whisperAudioPlaying: false, whisperAudioProgress: 0, whisperAudioDuration: '00:00',
  },
  onLoad(options) {
    if (options.kind === 'collection') {
      this.setData({ title: '拾物采集', loaded: true, error: '拾物采集暂未开放' });
      return;
    }
    const kind = Object.prototype.hasOwnProperty.call(entryPages, options.kind) ? options.kind : 'anniversary';
    this.setData({ kind, ...entryPages[kind] });
  },
  onShow() {
    this.visible = true;
    if (!this.data.kind) return;
    this.load();
    this.timer = setInterval(() => this.refreshSummary(), 5000);
  },
  onHide() {
    this.visible = false;
    clearInterval(this.timer);
    clearTimeout(this.searchTimer);
    this.searchTimer = null;
    this.clearWhisperProgressTimer();
    if (this.audio) this.audio.stop();
    if (this.data.whisperAudioId) this.setData({ whisperAudioId: '', whisperAudioPlaying: false, whisperAudioProgress: 0 });
  },
  onUnload() { this.visible = false; clearInterval(this.timer); clearTimeout(this.searchTimer); this.clearWhisperProgressTimer(); if (this.audio) this.audio.destroy(); },
  async refreshSummary() { try { this.setData({ summary: await sg.api() }); } catch (e) { sg.fail(this, e); } },
  async load(page = 0) {
    if (page && (this.data.loading || !this.data.hasMore)) return;
    const request = {};
    const { kind, date, topic, keyword, author } = this.data;
    this.entriesRequest = request;
    this.setData({ loading: true, error: '' });
    try {
      const query = [`page=${page}`];
      if (date) query.push(`date=${encodeURIComponent(date)}`);
      if (kind === 'whisper' && topic) query.push(`topic=${encodeURIComponent(topic)}`);
      if (kind === 'whisper' && keyword) query.push(`q=${encodeURIComponent(keyword)}`);
      if (kind === 'whisper' && author) query.push(`author=${encodeURIComponent(author)}`);
      const responses = await Promise.all([sg.api(), sg.api(`/${kind}?${query.join('&')}`)]);
      if (this.entriesRequest !== request) return;
      const summary = responses[0], result = responses[1];
      const imagePath = entry => entry.payload.image ? `${entry.payload.image}?variant=preview` : '';
      const videoPath = entry => entry.payload.video || '';
      const references = result.items.flatMap(entry => entryMedia(entry.payload).map(item => (
        item.type === 'image' ? `${item.reference}?variant=preview` : item.reference
      )))
        .concat(summary.space.members.map(member => member.avatar).filter(Boolean));
      const links = await sg.mediaLinks(references);
      if (this.entriesRequest !== request) return;
      const videoAspectRatios = {};
      await Promise.all(result.items.filter(entry => entry.payload.video).map(async entry => {
        const videoUrl = sg.mediaDisplayUrl(videoPath(entry), links);
        videoAspectRatios[entry.id] = await getVideoAspectRatio(videoUrl);
      }));
      const whisperVideoMetadata = {};
      if (kind === 'whisper') {
        await Promise.all(result.items.flatMap(entry => entryMedia(entry.payload)
          .filter(media => media.type === 'video')
          .map(async media => {
            const videoUrl = sg.mediaDisplayUrl(media.reference, links);
            whisperVideoMetadata[`${entry.id}:${media.reference}`] = await getVideoMetadata(videoUrl);
          })));
      }
      if (this.entriesRequest !== request) return;
      const items = result.items.map(e => {
        const content = String(e.payload?.content || e.payload?.title || '').trim();
        const member = summary.space.members.find(candidate => candidate.userId === e.createdBy);
        const author = member?.name || '空间成员';
        const previewPath = imagePath(e);
        const mediaItems = entryMedia(e.payload).map((media, index) => {
          const lookup = media.type === 'image' ? `${media.reference}?variant=preview` : media.reference;
          return {
            id: `${e.id}-${index}`,
            type: media.type,
            reference: media.reference,
            url: sg.mediaDisplayUrl(lookup, links),
            durationText: media.type === 'video'
              ? whisperVideoMetadata[`${e.id}:${media.reference}`]?.durationText || '00:00'
              : '',
          };
        });
        return {
          ...e,
          canManage: sg.manage(e, summary),
          author,
          authorAvatar: sg.mediaDisplayUrl(String(member?.avatar || ''), links),
          authorInitial: author.slice(0, 1),
          time: sg.time(e.createdAt).slice(0, 16),
          imageUrl: sg.mediaDisplayUrl(previewPath, links),
          videoUrl: sg.mediaDisplayUrl(videoPath(e), links),
          mediaItems,
          videoAspectRatio: videoAspectRatios[e.id] || '16 / 9',
          showContent: content,
          contentParts: topicSegments(content),
          days: e.kind === 'anniversary' ? Math.round((Date.parse(`${summary.today}T00:00:00Z`) - Date.parse(`${e.payload.date}T00:00:00Z`)) / 86400000) * (e.payload.direction === 'down' ? -1 : 1) : 0,
        };
      });
      const authorOptions = [{ userId: '', name: '全部发布人' }, ...summary.space.members.map(member => ({ userId: member.userId, name: member.name }))];
      const authorIndex = Math.max(0, authorOptions.findIndex(option => option.userId === this.data.author));
      const authorLabel = authorOptions[authorIndex]?.name || '全部发布人';
      this.setData({ summary, authorOptions, authorIndex, authorLabel, items: page ? this.data.items.concat(items) : items, page, hasMore: result.hasMore, error: '', loaded: true });
    } catch (error) {
      if (this.entriesRequest === request) sg.fail(this, error);
    } finally {
      if (this.entriesRequest === request) this.setData({ loading: false });
    }
  },
  more() { this.load(this.data.page + 1); },
  changeDate(event) { this.filterDate(event.detail.value); },
  clearDate() { this.filterDate(''); },
  filterDate(date) {
    if (date === this.data.date) return;
    this.setData({ date, dateLabel: date ? date.slice(5) : '时间', items: [], page: 0, hasMore: false, loaded: false });
    this.load();
  },
  inputTopic(event) {
    this.setData({ topicInput: event.detail.value });
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.searchTimer = null;
      this.applySearch();
    }, 300);
  },
  applySearch() {
    clearTimeout(this.searchTimer);
    this.searchTimer = null;
    const raw = String(this.data.topicInput || '').trim();
    const isTopic = raw.startsWith('#');
    const topic = isTopic ? cleanTopic(raw) : '';
    const keyword = isTopic ? '' : raw.slice(0, 100);
    const topicInput = isTopic ? (topic ? `#${topic}` : '') : keyword;
    if (topic === this.data.topic && keyword === this.data.keyword) {
      if (topicInput !== this.data.topicInput) this.setData({ topicInput });
      return;
    }
    this.setData({ topic, keyword, items: [], page: 0, hasMore: false, loaded: false }, () => {
      this.load();
    });
  },
  changeAuthor(event) {
    const authorIndex = Number(event.detail.value) || 0;
    const author = this.data.authorOptions[authorIndex]?.userId || '';
    if (author === this.data.author) return;
    const authorLabel = this.data.authorOptions[authorIndex]?.name || '全部发布人';
    this.setData({ author, authorIndex, authorLabel, items: [], page: 0, hasMore: false, loaded: false });
    this.load();
  },
  filterTopic(event) {
    const topic = cleanTopic(event.currentTarget.dataset.topic);
    if (!topic || (topic === this.data.topic && !this.data.keyword)) return;
    this.setData({ topic, keyword: '', topicInput: `#${topic}`, items: [], page: 0, hasMore: false, loaded: false });
    this.load();
  },
  clearWhisperFilters() {
    this.setData({ date: '', dateLabel: '时间', topic: '', keyword: '', topicInput: '', author: '', authorIndex: 0, authorLabel: '全部发布人', items: [], page: 0, hasMore: false, loaded: false });
    this.load();
  },
  add() { const s = this.data.summary; const own = s && this.data.kind === 'mood' ? s.moods.find(e => e.createdBy === s.userId) : null; this.setData({ formOpen: true, editing: own || null }); },
  edit(e) { const entry = this.data.items.find(i => i.id === e.currentTarget.dataset.id); if (entry.canManage) this.setData({ formOpen: true, editing: entry }); },
  async toggleWish(event) {
    const { kind, busy, loading, items } = this.data;
    if (kind !== 'wish' || busy || loading) return;
    const { id } = event.currentTarget.dataset;
    const entry = items.find(item => item.id === id);
    if (!entry?.canManage) return;
    const status = entry.payload.status === 'fulfilled' ? 'pending' : 'fulfilled';
    this.setData({ busy: true, error: '' });
    try {
      await sg.api(`/wish/${id}`, 'PUT', { version: entry.version, payload: { ...entry.payload, status } });
      if (this.visible) await this.load();
    } catch (error) {
      if (!this.visible) return;
      if (error.statusCode === 409) {
        await this.load();
        if (this.visible && !this.data.error) wx.showToast({ title: '愿望已变化，请重试', icon: 'none' });
      } else {
        sg.fail(this, error);
      }
    } finally {
      this.setData({ busy: false });
    }
  },
  cancel() { this.setData({ formOpen: false, editing: null }); }, saved() { this.cancel(); this.load(); },
  quickPublished() { return this.load(); },
  replies(e) {
    const { id } = e.currentTarget.dataset;
    this.setData({ replyId: this.data.replyId === id ? '' : id });
  },
  openWhisperVideoPreview(event) {
    const { url } = event.currentTarget.dataset;
    if (!url) return;
    wx.previewMedia({ sources: [{ url, type: 'video' }] });
  },
  onWhisperVideoMetadata(event) {
    const id = event.currentTarget.dataset.id;
    const duration = Number(event.detail?.duration);
    if (!id || !Number.isFinite(duration) || duration <= 0) return;
    const durationText = formatAudioDuration(duration);
    let changed = false;
    const items = this.data.items.map(item => {
      const mediaItems = Array.isArray(item.mediaItems) ? item.mediaItems : [];
      const index = mediaItems.findIndex(media => media.id === id);
      if (index < 0 || mediaItems[index].durationText === durationText) return item;
      changed = true;
      return {
        ...item,
        mediaItems: mediaItems.map(media => media.id === id ? { ...media, durationText } : media),
      };
    });
    if (changed) this.setData({ items });
  },
  clearWhisperProgressTimer() {
    if (this.whisperProgressTimer) clearInterval(this.whisperProgressTimer);
    this.whisperProgressTimer = null;
  },
  startWhisperProgress(audio, id, startAt) {
    this.clearWhisperProgressTimer();
    const startedAt = Date.now();
    const baseTime = Number(startAt) || 0;
    this.whisperProgressTimer = setInterval(() => {
      if (this.audio !== audio) return;
      const duration = Number(audio.duration) || 0;
      if (duration <= 0) return;
      const current = Math.min(duration, baseTime + (Date.now() - startedAt) / 1000);
      const progress = Math.max(0, Math.min(1, current / duration));
      this.setData({
        whisperAudioId: id,
        whisperAudioDuration: formatAudioDuration(duration),
        whisperAudioProgress: progress * 100,
      });
    }, 40);
  },
  async toggleWhisperAudio(event) {
    if (!this.visible) return;
    const { id, reference } = event.currentTarget.dataset;
    if (!reference) return;
    if (this.audio && this.audioKey === reference) {
      if (this.data.whisperAudioPlaying) {
        this.audio.pause();
      } else {
        if (this.data.whisperAudioId !== id) this.setData({ whisperAudioId: id, whisperAudioProgress: 0, whisperAudioDuration: '00:00' });
        else if (this.data.whisperAudioProgress >= 99.9) {
          this.audio.seek(0);
          this.setData({ whisperAudioProgress: 0 });
        }
        this.audio.play();
      }
      return;
    }
    const request = this.audioRequest = {};
    try {
      const url = sg.mediaDisplayUrl(reference, await sg.mediaLinks([reference]));
      if (!this.visible || this.audioRequest !== request) return;
      if (!url) throw new Error('音频暂时无法播放');
      if (this.audio) this.audio.destroy();
      const audio = wx.createInnerAudioContext();
      this.audio = audio;
      this.audioKey = reference;
      audio.onPlay(() => {
        if (this.audio === audio) {
          this.setData({ whisperAudioId: id, whisperAudioPlaying: true });
          this.startWhisperProgress(audio, id, audio.currentTime);
        }
      });
      audio.onPause(() => {
        if (this.audio === audio) {
          this.clearWhisperProgressTimer();
          const duration = Number(audio.duration) || 0;
          this.setData({
            whisperAudioPlaying: false,
            ...(duration > 0 ? { whisperAudioProgress: Math.min(1, Number(audio.currentTime) / duration) * 100 } : {}),
          });
        }
      });
      audio.onStop(() => {
        if (this.audio === audio) {
          this.clearWhisperProgressTimer();
          this.setData({ whisperAudioPlaying: false, whisperAudioProgress: 0 });
        }
      });
      audio.onEnded(() => {
        if (this.audio === audio) {
          this.clearWhisperProgressTimer();
          this.setData({ whisperAudioPlaying: false, whisperAudioProgress: 100 });
        }
      });
      audio.onTimeUpdate(() => {
        if (this.audio !== audio) return;
        const duration = Number(audio.duration) || 0;
        if (duration > 0) this.setData({ whisperAudioDuration: formatAudioDuration(duration) });
        if (!this.whisperProgressTimer && duration > 0) {
          this.setData({ whisperAudioProgress: Math.min(1, Number(audio.currentTime) / duration) * 100 });
        }
      });
      audio.onError(() => {
        if (this.audio === audio) {
          this.clearWhisperProgressTimer();
          this.audio = null;
          this.audioKey = '';
          audio.destroy();
          this.setData({ whisperAudioPlaying: false });
        }
        if (this.visible) wx.showToast({ title: '音频暂时无法播放', icon: 'none' });
      });
      audio.src = url;
      audio.play();
    } catch (error) { if (this.visible) sg.fail(this, error); }
  },
  seekWhisperAudio(event) {
    const { id, reference } = event.currentTarget.dataset;
    if (!this.audio || this.audioKey !== reference) return;
    const duration = Number(this.audio.duration) || 0;
    if (!duration) return;
    const clientX = Number(event.changedTouches?.[0]?.clientX ?? event.detail.x);
    if (!Number.isFinite(clientX)) return;
    wx.createSelectorQuery().select(`#whisper-audio-progress-${id}`).boundingClientRect(rect => {
      if (!rect?.width) return;
      const progress = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      this.audio.seek(duration * progress);
      if (this.data.whisperAudioPlaying) this.startWhisperProgress(this.audio, id, duration * progress);
      this.setData({ whisperAudioId: id, whisperAudioProgress: progress * 100 });
    }).exec();
  },
  async openAttachment(event) {
    const { reference, field } = event.currentTarget.dataset;
    try { await openMedia(reference, field, () => this.visible); }
    catch (error) { if (this.visible) sg.fail(this, error); }
  },
  async remove(e) { if (this.data.busy || !await sg.confirm(this.data.kind === 'whisper' ? '删除絮语及其全部回复？' : '删除这条记录？')) return; this.setData({ busy: true }); try { const entry = this.data.items.find(i => i.id === e.currentTarget.dataset.id); await sg.api(`/${this.data.kind}/${entry.id}`, 'DELETE', { version: entry.version }); await this.load(); } catch (e) { sg.fail(this, e); } finally { this.setData({ busy: false }); } },
});
