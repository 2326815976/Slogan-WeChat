const sg = require('../../../../services/shiguang');
const { messageMedia } = require('../message-media');
const { extractTopics, firstTopic } = require('../../utils/topics');

Component({
  behaviors: [messageMedia],
  properties: { kind: String, title: String, entry: { type: Object, value: null } },
  data: { draft: {}, topics: [], busy: false, error: '' },
  observers: { entry(entry) { if (this.mediaAlive) this.initializeDraft(entry); } },
  lifetimes: { attached() { this.initializeDraft(this.properties.entry); } },
  methods: {
    initializeDraft(entry) {
      this.requestId = entry ? entry.id : sg.uuid();
      const draft = entry ? { ...entry.payload } : { direction: 'up', status: 'pending' };
      if (this.properties.kind === 'whisper') {
        draft.content = String(draft.content || draft.title || '');
        delete draft.title;
      }
      this.setData({ draft, topics: extractTopics(draft.content), error: '' });
      this.resetMedia(entry?.payload);
    },
    input(event) {
      const key = event.currentTarget.dataset.key;
      const update = { [`draft.${key}`]: event.detail.value };
      if (this.properties.kind === 'whisper' && key === 'content') update.topics = extractTopics(event.detail.value);
      this.setData(update);
    },
    choice(event) { this.setData({ [`draft.${event.currentTarget.dataset.key}`]: event.currentTarget.dataset.value }); },
    async save() {
      if (this.data.busy || this.data.attachmentBusy) return;
      const { entry, kind } = this.properties;
      const { draft, media } = this.data;
      const payload = { ...draft };
      if (kind === 'whisper') {
        const { audio, image, video } = media;
        delete payload.title;
        Object.assign(payload, { audio, image, video, title: firstTopic(draft.content), type: audio ? 'audio' : 'text' });
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
