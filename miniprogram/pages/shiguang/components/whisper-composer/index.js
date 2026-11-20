const sg = require('../../../../services/shiguang');
const { messageMedia } = require('../message-media');
const { extractTopics, firstTopic } = require('../../utils/topics');

Component({
  behaviors: [messageMedia],
  data: {
    content: '',
    topics: [],
    composerOpen: false,
    busy: false,
    error: '',
    mediaItems: [],
    mediaUploading: false,
    mediaUploadLabel: '',
    audioPlaying: false,
    audioDurationText: '00:00',
    audioWaveBars: [14, 24, 36, 20, 44, 28, 16, 40, 56, 32, 18, 48, 26, 38, 16, 50, 30, 22, 42, 14, 34, 24, 48, 18],
  },
  methods: {
    input(event) {
      this.setData({ content: event.detail.value, topics: extractTopics(event.detail.value), error: '' });
    },
    openComposer() {
      if (this.data.busy || this.data.attachmentBusy) return;
      this.setData({ composerOpen: true, error: '' });
    },
    closeComposer() {
      if (this.data.busy || this.data.attachmentBusy) return;
      this.setData({ composerOpen: false, error: '', mediaError: '', mediaUploadLabel: '' });
    },
    chooseMediaSource() {
      if (this.data.busy || this.data.attachmentBusy || this.data.mediaItems.length >= 3) return;
      wx.showActionSheet({
        itemList: ['从相册选择', '拍照'],
        success: result => {
          void this.pickMediaItems(result.tapIndex === 0 ? 'album' : 'camera');
        },
      });
    },
    async pickMediaItems(source) {
      const remaining = 3 - this.data.mediaItems.length;
      if (remaining <= 0 || this.data.busy || this.data.attachmentBusy) return;
      this.setData({ attachmentBusy: true, mediaUploading: true, mediaError: '', mediaUploadLabel: '' });
      try {
        const files = await sg.chooseMediaBatch(source, remaining);
        if (!this.mediaAlive) return;
        if (!files.length) return;
        let failed = 0;
        for (let index = 0; index < files.length && this.data.mediaItems.length < 3; index += 1) {
          const file = files[index];
          this.setData({ mediaUploadLabel: `正在上传 ${index + 1}/${files.length}` });
          try {
            const type = file.fileType === 'video' ? 'video' : 'image';
            const videoName = /\.mov$/i.test(file.tempFilePath) ? 'video.mov' : 'video.mp4';
            const options = type === 'video'
              ? { attachment: true, fileName: videoName, contentType: /\.mov$/i.test(file.tempFilePath) ? 'video/quicktime' : 'video/mp4' }
              : { attachment: true };
            const reference = await sg.upload(file.tempFilePath, false, false, options);
            if (!this.mediaAlive) return;
            const next = this.data.mediaItems.concat({
              id: sg.uuid(),
              type,
              reference,
              previewPath: type === 'image' ? file.tempFilePath : file.thumbTempFilePath || '',
            }).slice(0, 3);
            this.setData({ mediaItems: next });
          } catch {
            failed += 1;
          }
        }
        if (failed) this.setData({ mediaError: `${failed} 个媒体上传失败，请重试` });
      } catch (error) {
        if (this.mediaAlive && !String(error.errMsg || '').includes('cancel')) {
          this.setData({ mediaError: error.message || '图片或视频上传失败' });
        }
      } finally {
        if (this.mediaAlive) this.setData({ attachmentBusy: false, mediaUploading: false, mediaUploadLabel: '' });
      }
    },
    removeMediaItem(event) {
      if (this.data.busy || this.data.attachmentBusy) return;
      const index = Number(event.currentTarget.dataset.index);
      if (!Number.isInteger(index) || index < 0) return;
      this.setData({ mediaItems: this.data.mediaItems.filter((_, itemIndex) => itemIndex !== index), mediaError: '' });
    },
    handleAudioControl() {
      if (this.data.media.audio && !this.data.recording) {
        this.selectComponent('.whisper-audio-bar__player')?.toggleAudio();
        return;
      }
      this.recordAttachment();
    },
    audioStateChange(event) {
      this.setData({ audioPlaying: Boolean(event.detail?.playing) });
    },
    audioDurationChange(event) {
      this.setData({ audioDurationText: event.detail?.duration || '00:00' });
    },
    clearAudio() {
      this.selectComponent('.whisper-audio-bar__player')?.pauseFromPeer();
      this.audioPlayer?.stop();
      this.setData({ 'media.audio': '', audioPlaying: false, audioDurationText: '00:00', mediaError: '' });
    },
    async publish() {
      const { busy, attachmentBusy, content, media, mediaItems } = this.data;
      const text = String(content || '').trim();
      const { audio = '' } = media || {};
      const selectedMedia = mediaItems.map(item => ({ type: item.type, reference: item.reference }));
      if (busy || attachmentBusy) return;
      if (!text && !audio && !selectedMedia.length) {
        this.setData({ error: '写点什么或添加附件后再发布' });
        return;
      }
      this.setData({ busy: true, error: '' });
      try {
        await sg.api('/whisper', 'POST', {
          id: sg.uuid(),
          payload: { content: text, title: firstTopic(text), audio, media: selectedMedia, type: audio ? 'audio' : 'text' },
        });
        this.resetMedia();
        this.setData({ content: '', topics: [], mediaItems: [], composerOpen: false, error: '', mediaError: '' });
        this.triggerEvent('published');
      } catch (error) {
        if (this.mediaAlive) this.setData({ error: error.message || '发布失败，请重试' });
      } finally {
        if (this.mediaAlive) this.setData({ busy: false });
      }
    },
  },
});
