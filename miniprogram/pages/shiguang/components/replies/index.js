const sg = require('../../../../services/shiguang');
const { messageMedia } = require('../message-media');
const { getVideoAspectRatio } = require('../../utils/media-info');

Component({
  behaviors: [messageMedia],
  properties: { entryId: String, userId: String, members: Array },
  data: {
    items: [],
    page: 0,
    hasMore: false,
    loaded: false,
    content: '',
    editing: null,
    busy: false,
    error: '',
    composerToolsOpen: false,
    composerFocused: false,
    replyToId: '',
    replyToName: '',
  },
  lifetimes: {
    attached() {
      this.requestId = sg.uuid();
      void this.load();
    },
  },
  methods: {
    async load(page = 0) {
      try {
        const result = await sg.api(`/replies?entryId=${this.properties.entryId}&page=${page}`);
        const members = Array.isArray(this.properties.members) ? this.properties.members : [];
        const imageRefs = result.items.filter(reply => reply.image).map(reply => `${reply.image}?variant=preview`);
        const videoRefs = result.items.filter(reply => reply.video).map(reply => reply.video);
        const avatarRefs = members.map(member => member.avatar).filter(Boolean);
        const links = await sg.mediaLinks(imageRefs.concat(videoRefs, avatarRefs));
        if (!this.mediaAlive) return;
        const videoAspectRatios = {};
        await Promise.all(result.items.filter(reply => reply.video).map(async reply => {
          const videoUrl = sg.mediaDisplayUrl(reply.video, links);
          videoAspectRatios[reply.id] = await getVideoAspectRatio(videoUrl);
        }));
        if (!this.mediaAlive) return;
        const items = result.items.map(reply => {
          const member = members.find(candidate => candidate.userId === reply.createdBy);
          const author = member?.name || '空间成员';
          const previewPath = reply.image ? `${reply.image}?variant=preview` : '';
          const replyMatch = String(reply.content || '').match(/^回复\s*@([^：:]+)[：:]\s*([\s\S]*)$/);
          return {
            ...reply,
            author,
            authorAvatar: sg.mediaDisplayUrl(String(member?.avatar || ''), links),
            authorInitial: author.slice(0, 1),
            time: sg.time(reply.createdAt).slice(0, 16),
            imageUrl: sg.mediaDisplayUrl(previewPath, links),
            videoUrl: sg.mediaDisplayUrl(reply.video, links),
            videoAspectRatio: videoAspectRatios[reply.id] || '16 / 9',
            replyMention: replyMatch ? `回复 @${replyMatch[1]}` : '',
            replyText: replyMatch ? replyMatch[2] : reply.content,
          };
        });
        this.setData({
          items: page ? this.data.items.concat(items) : items,
          page,
          hasMore: result.hasMore,
          loaded: true,
          error: '',
        });
      } catch (error) {
        if (this.mediaAlive) this.setData({ error: error.message, loaded: true });
      }
    },
    more() {
      void this.load(this.data.page + 1);
    },
    input(event) {
      this.setData({ content: event.detail.value });
    },
    focusComposer() {
      if (!this.data.busy) this.setData({ composerFocused: true });
    },
    edit(event) {
      if (this.data.busy || this.data.attachmentBusy) return;
      const item = this.data.items.find(reply => reply.id === event.currentTarget.dataset.id);
      if (!item || item.createdBy !== this.properties.userId) return;
      this.resetMedia(item);
      this.setData({
        editing: item,
        content: item.content,
        composerToolsOpen: false,
        composerFocused: false,
        replyToId: '',
        replyToName: '',
        error: '',
      });
    },
    cancel() {
      this.resetMedia();
      this.setData({
        editing: null,
        content: '',
        composerToolsOpen: false,
        composerFocused: false,
        replyToId: '',
        replyToName: '',
        error: '',
      });
    },
    beginReply(event) {
      if (this.data.busy || this.data.attachmentBusy) return;
      const item = this.data.items.find(reply => reply.id === event.currentTarget.dataset.id);
      if (!item) return;
      this.resetMedia();
      this.setData({
        editing: null,
        content: '',
        composerToolsOpen: false,
        composerFocused: true,
        replyToId: item.id,
        replyToName: item.author,
        error: '',
      });
    },
    cancelReplyTarget() {
      if (this.data.busy || this.data.attachmentBusy) return;
      this.setData({ replyToId: '', replyToName: '', composerFocused: true });
    },
    blurComposer() { this.setData({ composerFocused: false }); },
    toggleComposerTools() {
      if (this.data.busy || this.data.attachmentBusy) return;
      this.setData({ composerToolsOpen: !this.data.composerToolsOpen });
    },
    async save() {
      const { busy, attachmentBusy, content, editing, media } = this.data;
      const { audio, image, video } = media;
      if (busy || attachmentBusy || !(content.trim() || audio || image || video)) return;
      const replyContent = !editing && this.data.replyToName
        ? `回复 @${this.data.replyToName}：${content.trim()}`
        : content;
      this.setData({ busy: true, error: '' });
      try {
        await sg.api(`/replies${editing ? `/${editing.id}` : ''}`, editing ? 'PUT' : 'POST', {
          id: this.requestId,
          entryId: this.properties.entryId,
          content: replyContent,
          audio,
          image,
          video,
          version: editing && editing.version,
        });
        this.requestId = sg.uuid();
        this.cancel();
        await this.load();
      } catch (error) {
        if (this.mediaAlive) this.setData({ error: error.message });
      } finally {
        if (this.mediaAlive) this.setData({ busy: false });
      }
    },
    async remove(event) {
      if (this.data.busy || this.data.attachmentBusy || !await sg.confirm('删除这条回复？')) return;
      this.setData({ busy: true, error: '' });
      try {
        const reply = this.data.items.find(item => item.id === event.currentTarget.dataset.id);
        if (!reply || reply.createdBy !== this.properties.userId) return;
        await sg.api(`/replies/${reply.id}`, 'DELETE', { version: reply.version });
        if (this.data.editing?.id === reply.id) this.cancel();
        await this.load();
      } catch (error) {
        if (this.mediaAlive) this.setData({ error: error.message });
      } finally {
        if (this.mediaAlive) this.setData({ busy: false });
      }
    },
  },
});
