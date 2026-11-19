const sg = require('../../../services/shiguang');

let recorder;
let session;
const attachmentLabels = { image: '图片', video: '视频', audio: '音频' };

function finishRecording(result, error) {
  const owner = session?.owner;
  session = null;
  if (!owner?.mediaAlive) return;
  if (error) {
    owner.setData({ recording: false, attachmentBusy: false, mediaError: error.errMsg || '录音失败，请检查麦克风权限' });
    return;
  }
  void owner.uploadAudio(result.tempFilePath);
}

function getRecorder() {
  if (!recorder) {
    recorder = wx.getRecorderManager();
    recorder.onStop(result => finishRecording(result));
    recorder.onError(error => finishRecording(null, error));
  }
  return recorder;
}

function stopRecording(owner, discard = false) {
  if (session?.owner !== owner) return;
  if (discard) session.owner = null;
  if (session.stopping) return;
  session.stopping = true;
  try { recorder.stop(); }
  catch (error) { finishRecording(null, error); }
}

const messageMedia = Behavior({
  data: { media: {}, recording: false, attachmentBusy: false, uploadOpen: false, selectedAttachment: null, audioUrl: '', imageUrl: '', localImageUrl: '', mediaError: '' },
  lifetimes: {
    attached() { this.mediaAlive = true; },
    detached() {
      this.mediaAlive = false;
      stopRecording(this, true);
      this.audioPlayer?.destroy();
    },
  },
  pageLifetimes: { hide() { stopRecording(this); this.playRequest = null; this.audioPlayer?.stop(); } },
  methods: {
    resetMedia(source = {}) {
      const { audio = '', image = '', video = '', width = 1, height = 1 } = source;
      const revision = this.mediaRevision = (this.mediaRevision || 0) + 1;
      this.audioPlayer?.stop();
      this.playRequest = null;
      this.setData({ media: { audio, image, video, width, height }, uploadOpen: false, selectedAttachment: null, audioUrl: '', imageUrl: '', localImageUrl: '', mediaError: '' });
      const preview = image && this.properties.kind !== 'collection' ? `${image}?variant=preview` : image;
      if (preview) void sg.mediaLinks([preview]).then(links => {
        if (this.mediaAlive && this.mediaRevision === revision && this.data.media.image === image) {
          this.setData({ imageUrl: sg.mediaDisplayUrl(preview, links) });
        }
      }).catch(error => {
        if (this.mediaAlive && this.mediaRevision === revision && this.data.media.image === image) this.setData({ mediaError: error.message });
      });
    },
    async uploadSelectedAttachment(field, file, options = {}, name = attachmentLabels[field]) {
      const selectedAttachment = { name, imageUrl: field === 'image' ? file : '', failed: false };
      this.setData({ selectedAttachment, uploadOpen: false });
      try {
        const reference = await sg.upload(file, false, false, { ...options, attachment: true });
        if (!this.mediaAlive) return;
        if (!reference) throw new Error('未收到附件地址，请重试');
        const preview = field === 'image' ? { imageUrl: file, localImageUrl: file } : field === 'audio' ? { audioUrl: file } : {};
        this.setData({ [`media.${field}`]: reference, selectedAttachment: null, ...preview });
        if (field === 'image') {
          const ref = `${reference}?variant=preview`;
          const revision = this.mediaRevision;
          void sg.mediaLinks([ref]).catch(() => ({})).then(links => {
            if (this.mediaAlive && this.mediaRevision === revision && this.data.media.image === reference && links[ref]) {
              this.setData({ imageUrl: links[ref] });
            }
          });
        }
      } catch (error) {
        if (this.mediaAlive) this.setData({ selectedAttachment: { ...selectedAttachment, failed: true }, mediaError: error.message || '上传失败，请重试' });
      }
    },
    dismissFailedAttachment() {
      if (!this.data.busy && !this.data.attachmentBusy && this.data.selectedAttachment?.failed) {
        this.setData({ selectedAttachment: null, mediaError: '' });
      }
    },
    onAttachmentImageError(event) {
      const { url } = event.currentTarget.dataset;
      const { imageUrl, localImageUrl } = this.data;
      if (url === imageUrl) this.setData({ imageUrl: url === localImageUrl ? '' : localImageUrl });
    },
    toggleAttachmentUpload() {
      if (this.data.busy || this.data.attachmentBusy) return;
      this.setData({ uploadOpen: !this.data.uploadOpen });
    },
    recordAttachment() {
      if (this.data.recording) { stopRecording(this); return; }
      if (this.data.busy || this.data.attachmentBusy) return;
      if (session) { this.setData({ mediaError: '上一段录音尚未结束，请稍后重试' }); return; }
      this.audioPlayer?.stop();
      session = { owner: this, stopping: false };
      this.setData({ recording: true, attachmentBusy: true, uploadOpen: false, mediaError: '' });
      try { getRecorder().start({ duration: 180000, sampleRate: 44100, numberOfChannels: 1, encodeBitRate: 128000, format: 'mp3' }); }
      catch (error) { finishRecording(null, error); }
    },
    async uploadAudio(file) {
      this.setData({ recording: false, attachmentBusy: true });
      try {
        await this.uploadSelectedAttachment('audio', file, { fileName: 'recording.mp3', contentType: 'audio/mpeg' }, '录音');
      } finally {
        if (this.mediaAlive) this.setData({ attachmentBusy: false });
      }
    },
    async pickAttachmentImage(event) {
      if (this.data.busy || this.data.attachmentBusy) return;
      this.setData({ attachmentBusy: true, mediaError: '' });
      try {
        const collection = this.properties.kind === 'collection';
        const source = event.currentTarget.dataset.source;
        const file = await sg.chooseImage(source ? [source] : undefined, !collection);
        if (!this.mediaAlive) return;
        if (!collection) { await this.uploadSelectedAttachment('image', file); return; }
        const image = await sg.upload(file);
        const size = await new Promise((resolve, reject) => wx.getImageInfo({ src: file, success: resolve, fail: reject }));
        if (this.mediaAlive) this.setData({ 'media.image': image, 'media.width': size.width, 'media.height': size.height, imageUrl: file, uploadOpen: false });
      } catch (error) {
        if (this.mediaAlive && !String(error.errMsg || '').includes('cancel')) this.setData({ mediaError: error.message || '图片上传失败' });
      } finally {
        if (this.mediaAlive) this.setData({ attachmentBusy: false });
      }
    },
    async pickAttachmentFile(event) {
      if (this.data.busy || this.data.attachmentBusy) return;
      const { field, source } = event.currentTarget.dataset;
      const settings = getApp().globalData;
      this.setData({ attachmentBusy: true, mediaError: '' });
      try {
        let path, name, contentType;
        if (field === 'video') {
          path = await sg.chooseVideo(source);
          const quickTime = /\.mov$/i.test(path);
          name = quickTime ? 'video.mov' : 'video.mp4';
          contentType = quickTime ? 'video/quicktime' : 'video/mp4';
        } else {
          settings.shiguangMediaChoosing = true;
          const file = await new Promise((resolve, reject) => wx.chooseMessageFile({
            count: 1, type: 'file', extension: ['mp3', 'm4a', 'aac', 'wav'],
            success: result => resolve(result.tempFiles[0]), fail: reject,
          }));
          path = file?.path || file?.tempFilePath;
          if (!path) throw new Error('未读取到所选音频，请重新选择');
          name = file.name;
          const extension = name?.split('.').pop().toLowerCase();
          contentType = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav' }[extension];
          if (!contentType) throw new Error('请选择 MP3、M4A、AAC 或 WAV 音频');
        }
        if (this.mediaAlive) await this.uploadSelectedAttachment(field, path, { fileName: name, contentType }, field === 'audio' ? name : undefined);
      } catch (error) {
        if (this.mediaAlive && !String(error.errMsg || '').includes('cancel')) this.setData({ mediaError: error.message || '上传失败' });
      } finally {
        settings.shiguangMediaChoosing = false;
        if (this.mediaAlive) this.setData({ attachmentBusy: false });
      }
    },
    removeAttachment(event) {
      if (this.data.busy || this.data.attachmentBusy) return;
      const { field } = event.currentTarget.dataset;
      if (field === 'audio') { this.playRequest = null; this.audioPlayer?.stop(); }
      this.setData({ [`media.${field}`]: '', [`${field}Url`]: '', ...(field === 'image' ? { localImageUrl: '' } : {}), mediaError: '' });
    },
    async openAttachment(event) {
      const { field, reference } = event.currentTarget.dataset;
      const ref = reference || this.data.media[field];
      if (!ref) return;
      try { await openMedia(ref, field, () => this.mediaAlive); }
      catch (error) { if (this.mediaAlive) this.setData({ mediaError: error.message }); }
    },
    playAttachment(event) {
      const { reference } = event.currentTarget.dataset;
      if (this.data.busy || this.data.attachmentBusy) return;
      void this.playMedia(reference || this.data.media.audio, reference ? '' : this.data.audioUrl);
    },
    async playMedia(reference, localUrl) {
      const request = this.playRequest = {};
      try {
        const url = localUrl || sg.mediaDisplayUrl(reference, await sg.mediaLinks([reference]));
        if (!this.mediaAlive || this.playRequest !== request) return;
        if (!url) throw new Error('音频暂时无法播放');
        if (!this.audioPlayer) {
          this.audioPlayer = wx.createInnerAudioContext();
          this.audioPlayer.onError(() => this.setData({ mediaError: '音频暂时无法播放' }));
        }
        this.audioPlayer.src = url;
        this.audioPlayer.play();
      } catch (error) {
        if (this.mediaAlive && this.playRequest === request) this.setData({ mediaError: error.message });
      }
    },
  },
});

async function openMedia(reference, field, isActive = () => true) {
  const url = sg.mediaDisplayUrl(reference, await sg.mediaLinks([reference]));
  if (!isActive()) return;
  if (!url) throw new Error(field === 'video' ? '视频暂时无法打开' : '原图暂时无法打开');
  if (field === 'video') wx.previewMedia({ sources: [{ url, type: 'video' }] });
  else wx.previewImage({ urls: [url] });
}

module.exports = { messageMedia, openMedia };
