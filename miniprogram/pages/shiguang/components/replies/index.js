const sg = require('../../../../services/shiguang');
Component({
  properties: { entryId: String, userId: String, members: Array },
  data: { items: [], page: 0, hasMore: false, loaded: false, formOpen: false, content: '', editing: null, busy: false, error: '' },
  lifetimes: { attached() { this.requestId = sg.uuid(); this.load(); } },
  methods: {
    async load(page = 0) { try { const result = await sg.api(`/replies?entryId=${this.properties.entryId}&page=${page}`); const items = result.items.map(r => ({ ...r, author: (this.properties.members.find(m => m.userId === r.createdBy) || {}).name, time: sg.time(r.createdAt) })); this.setData({ items: page ? this.data.items.concat(items) : items, page, hasMore: result.hasMore, loaded: true }); } catch (e) { this.setData({ error: e.message }); } },
    more() { this.load(this.data.page + 1); }, input(e) { this.setData({ content: e.detail.value }); },
    start() { if (!this.data.busy) this.setData({ formOpen: true, editing: null, content: '', error: '' }); },
    edit(e) { const item = this.data.items.find(r => r.id === e.currentTarget.dataset.id); if (!this.data.busy && item?.createdBy === this.properties.userId) this.setData({ formOpen: true, editing: item, content: item.content, error: '' }); },
    cancel() { this.setData({ formOpen: false, editing: null, content: '', error: '' }); },
    close() { if (!this.data.busy) this.triggerEvent('close'); },
    async save() { if (this.data.busy) return; this.setData({ busy: true, error: '' }); try { const e = this.data.editing; await sg.api(`/replies${e ? `/${e.id}` : ''}`, e ? 'PUT' : 'POST', { id: this.requestId, entryId: this.properties.entryId, content: this.data.content, version: e && e.version }); this.requestId = sg.uuid(); this.cancel(); await this.load(); } catch (e) { this.setData({ error: e.message }); } finally { this.setData({ busy: false }); } },
    async remove(e) { if (this.data.busy || !await sg.confirm('删除这条回复？')) return; this.setData({ busy: true }); try { const r = this.data.items.find(r => r.id === e.currentTarget.dataset.id); await sg.api(`/replies/${r.id}`, 'DELETE', { version: r.version }); await this.load(); } catch (e) { this.setData({ error: e.message }); } finally { this.setData({ busy: false }); } },
  },
});
