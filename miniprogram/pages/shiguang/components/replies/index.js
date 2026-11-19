const sg = require('../../../../services/shiguang');
const { messageMedia } = require('../message-media');

Component({
  behaviors: [messageMedia],
  properties: { entryId: String, userId: String, members: Array },
  data: { items: [], page: 0, hasMore: false, loaded: false, formOpen: false, content: '', editing: null, busy: false, error: '' },
  lifetimes: { attached() { this.requestId = sg.uuid(); void this.load(); } },
  methods: {
    async load(page = 0) {
      try {
        const result = await sg.api(`/replies?entryId=${this.properties.entryId}&page=${page}`);
        const links = await sg.mediaLinks(result.items.filter(reply => reply.image).map(reply => `${reply.image}?variant=preview`));
        if (!this.mediaAlive) return;
        const items = result.items.map(reply => ({
          ...reply, author: this.properties.members.find(member => member.userId === reply.createdBy)?.name,
          time: sg.time(reply.createdAt), imageUrl: links[`${reply.image}?variant=preview`] || '',
        }));
        this.setData({ items: page ? this.data.items.concat(items) : items, page, hasMore: result.hasMore, loaded: true });
      } catch (error) { if (this.mediaAlive) this.setData({ error: error.message }); }
    },
    more() { void this.load(this.data.page + 1); },
    input(event) { this.setData({ content: event.detail.value }); },
    start() {
      if (this.data.busy || this.data.attachmentBusy) return;
      this.resetMedia();
      this.setData({ formOpen: true, editing: null, content: '', error: '' });
    },
    edit(event) {
      if (this.data.busy || this.data.attachmentBusy) return;
      const item = this.data.items.find(reply => reply.id === event.currentTarget.dataset.id);
      if (!item || item.createdBy !== this.properties.userId) return;
      this.resetMedia(item);
      this.setData({ formOpen: true, editing: item, content: item.content, error: '' });
    },
    cancel() {
      this.resetMedia();
      this.setData({ formOpen: false, editing: null, content: '', error: '' });
    },
    close() { if (!this.data.busy && !this.data.attachmentBusy) this.triggerEvent('close'); },
    async save() {
      const { busy, attachmentBusy, content, editing, media } = this.data;
      const { audio, image, video } = media;
      if (busy || attachmentBusy || !(content.trim() || audio || image || video)) return;
      this.setData({ busy: true, error: '' });
      try {
        await sg.api(`/replies${editing ? `/${editing.id}` : ''}`, editing ? 'PUT' : 'POST', {
          id: this.requestId, entryId: this.properties.entryId, content, audio, image, video, version: editing && editing.version,
        });
        this.requestId = sg.uuid();
        this.cancel();
        await this.load();
      } catch (error) { if (this.mediaAlive) this.setData({ error: error.message }); }
      finally { if (this.mediaAlive) this.setData({ busy: false }); }
    },
    async remove(event) {
      if (this.data.busy || this.data.attachmentBusy || !await sg.confirm('删除这条回复？')) return;
      this.setData({ busy: true });
      try {
        const reply = this.data.items.find(item => item.id === event.currentTarget.dataset.id);
        await sg.api(`/replies/${reply.id}`, 'DELETE', { version: reply.version });
        if (this.data.editing?.id === reply.id) this.cancel();
        await this.load();
      } catch (error) { if (this.mediaAlive) this.setData({ error: error.message }); }
      finally { if (this.mediaAlive) this.setData({ busy: false }); }
    },
  },
});
