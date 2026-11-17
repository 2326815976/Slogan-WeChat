const sg = require('../../../../services/shiguang');
Component({
  properties: { kind: String, entry: { type: Object, value: null } },
  data: { draft: {}, busy: false, recording: false, audioUrl: '', imageUrl: '', error: '' },
  observers: { entry(entry) { if (!this.alive) return; this.requestId = entry ? entry.id : sg.uuid(); this.setData({ draft: entry ? { ...entry.payload } : { direction: 'up', status: 'pending', type: 'text' }, error: '' }); this.loadMedia(); } },
  pageLifetimes: { hide() { if (this.data.recording && this.recorder) this.recorder.stop(); if (this.audio) this.audio.stop(); } },
  lifetimes: {
    attached() {
      const entry = this.properties.entry;
      this.requestId = entry ? entry.id : sg.uuid();
      this.setData({ draft: entry ? { ...entry.payload } : { direction: 'up', status: 'pending', type: 'text' } });
      this.loadMedia();
      this.recorder = wx.getRecorderManager();
      this.onStop = async result => {
        if (!this.alive) return;
        this.setData({ recording: false, busy: true });
        try { const audio = await sg.upload(result.tempFilePath, false, true); this.setData({ 'draft.audio': audio, audioUrl: result.tempFilePath }); }
        catch (e) { this.setData({ error: e.message }); } finally { this.setData({ busy: false }); }
      };
      this.onRecordError = e => this.setData({ busy: false, recording: false, error: e.errMsg || '录音失败，请检查麦克风权限' });
      this.recorder.onStop(this.onStop); this.recorder.onError(this.onRecordError); this.alive = true;
    },
    detached() { this.alive = false; if (this.data.recording) this.recorder.stop(); this.recorder.offStop(this.onStop); this.recorder.offError(this.onRecordError); if (this.audio) this.audio.destroy(); },
  },
  methods: {
    async loadMedia() { try { const d = this.data.draft; const links = await sg.mediaLinks([d.audio, d.image]); this.setData({ audioUrl: links[d.audio] || '', imageUrl: links[d.image] || '' }); } catch (e) { this.setData({ error: e.message }); } },
    input(e) { this.setData({ [`draft.${e.currentTarget.dataset.key}`]: e.detail.value }); },
    choice(e) { this.setData({ [`draft.${e.currentTarget.dataset.key}`]: e.currentTarget.dataset.value }); },
    record() {
      if (this.data.recording) { this.recorder.stop(); return; }
      if (this.data.busy) return;
      this.setData({ recording: true, busy: true, error: '' });
      this.recorder.start({ duration: 180000, sampleRate: 44100, numberOfChannels: 1, encodeBitRate: 128000, format: 'mp3' });
    },
    play() { if (!this.data.audioUrl) return; if (!this.audio) this.audio = wx.createInnerAudioContext(); this.audio.src = this.data.audioUrl; this.audio.play(); },
    async image() { if (this.data.busy) return; this.setData({ busy: true }); try { const file = await sg.chooseImage(); const image = await sg.upload(file); const info = await new Promise((resolve, reject) => wx.getImageInfo({ src: file, success: resolve, fail: reject })); this.setData({ 'draft.image': image, 'draft.width': info.width, 'draft.height': info.height, imageUrl: file }); } catch (e) { if (!String(e.errMsg || '').includes('cancel')) this.setData({ error: e.message || '图片上传失败' }); } finally { this.setData({ busy: false }); } },
    async save() {
      if (this.data.busy) return; this.setData({ busy: true, error: '' });
      try { const entry = this.properties.entry; await sg.api(`/${this.properties.kind}${entry ? `/${entry.id}` : ''}`, entry ? 'PUT' : 'POST', { id: this.requestId, version: entry && entry.version, payload: this.data.draft }); this.triggerEvent('saved'); }
      catch (e) { this.setData({ error: e.message }); } finally { this.setData({ busy: false }); }
    },
    cancel() { if (!this.data.busy) this.triggerEvent('cancel'); },
  },
});
