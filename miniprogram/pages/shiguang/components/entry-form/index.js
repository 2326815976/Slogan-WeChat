const sg = require('../../../../services/shiguang');
const { messageMedia } = require('../message-media');

Component({
  behaviors: [messageMedia],
  properties: { kind: String, title: String, entry: { type: Object, value: null } },
  data: { draft: {}, busy: false, error: '' },
  observers: { entry(entry) { if (this.mediaAlive) this.initializeDraft(entry); } },
  lifetimes: { attached() { this.initializeDraft(this.properties.entry); } },
  methods: {
    initializeDraft(entry) {
      this.requestId = entry ? entry.id : sg.uuid();
      this.setData({ draft: entry ? { ...entry.payload } : { direction: 'up', status: 'pending' }, error: '' });
      this.resetMedia(entry?.payload);
    },
    input(event) { this.setData({ [`draft.${event.currentTarget.dataset.key}`]: event.detail.value }); },
    choice(event) { this.setData({ [`draft.${event.currentTarget.dataset.key}`]: event.currentTarget.dataset.value }); },
    async save() {
      if (this.data.busy || this.data.attachmentBusy) return;
      const { entry, kind } = this.properties;
      const { draft, media } = this.data;
      const payload = { ...draft };
      if (kind === 'whisper') {
        const { audio, image, video } = media;
        Object.assign(payload, { audio, image, video, type: audio ? 'audio' : 'text' });
      } else if (kind === 'collection') {
        const { image, width, height } = media;
        Object.assign(payload, { image, width, height });
      }
      this.setData({ busy: true, error: '' });
      try {
        await sg.api(`/${kind}${entry ? `/${entry.id}` : ''}`, entry ? 'PUT' : 'POST', { id: this.requestId, version: entry && entry.version, payload });
        this.triggerEvent('saved');
      } catch (error) {
        if (this.mediaAlive) this.setData({ error: error.message });
      } finally {
        if (this.mediaAlive) this.setData({ busy: false });
      }
    },
    cancel() { if (!this.data.busy && !this.data.attachmentBusy) this.triggerEvent('cancel'); },
  },
});
