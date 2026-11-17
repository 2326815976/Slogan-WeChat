const sg = require('../../../services/shiguang');
const { getSession, extractSessionUser } = require('../../../services/photo-api');
const { hasAdminAccess } = require('../../../utils/admin-access');
Page({
  data: { authorized: false, items: [], page: 0, hasMore: false, options: { users: [], albums: [] }, available: [], query: '', formOpen: false, editing: null, form: {}, member: null, error: '', busy: false },
  async onLoad() {
    try {
      // 复用主包会话与角色判断，避免依赖管理页面的拆包路径。
      const user = extractSessionUser(await getSession());
      if (!user || !user.id || !hasAdminAccess(user)) throw new Error('需要管理员权限');
      this.setData({ authorized: true });
      await Promise.all([this.load(), this.loadOptions()]);
    } catch (error) { this.setData({ error: error.message || '需要管理员权限' }); }
  },
  async load(page = 0) { try { const result = await sg.api(`admin/shiguang?page=${page}`); const links = await sg.mediaLinks(result.items.map(s => s.cover)); this.setData({ items: result.items.map(s => ({ ...s, coverUrl: links[s.cover] || s.cover })), page, hasMore: result.hasMore }); } catch (e) { this.setData({ error: e.message }); } },
  async loadOptions() { try { const options = await sg.api('admin/shiguang?options=1'); this.setData({ options, available: options.users.filter(u => !u.bound) }); } catch (e) { this.setData({ error: e.message }); } },
  search(e) { const query = e.detail.value; this.setData({ query, available: this.data.options.users.filter(u => !u.bound && u.label.includes(query)) }); },
  open(e) { const s = this.data.items.find(s => s.id === e.currentTarget.dataset.id); const album = this.data.options.albums.find(a => a.id === (s && s.albumId)); this.setData({ formOpen: true, editing: s || null, error: '', form: { id: s ? s.id : sg.uuid(), name: s ? s.name : '', cover: s ? s.cover : '', coverUrl: s ? s.coverUrl : '', letter: s ? s.letter : '', enabled: s ? s.enabled : true, albumId: s ? s.albumId : '', albumName: album ? album.title : '', boyId: '', girlId: '', boyName: '', girlName: '' } }); },
  input(e) { this.setData({ [`form.${e.currentTarget.dataset.key}`]: e.detail.value }); },
  enabled(e) { this.setData({ 'form.enabled': e.detail.value }); },
  album(e) { const a = this.data.options.albums[Number(e.detail.value)]; this.setData({ 'form.albumId': a.id, 'form.albumName': a.title }); },
  user(e) { const role = e.currentTarget.dataset.role, u = this.data.available[Number(e.detail.value)]; this.setData({ [`form.${role}Id`]: u.id, [`form.${role}Name`]: u.label }); },
  cancel() { this.setData({ formOpen: false, member: null }); },
  async image(e) { if (this.data.busy) return; this.setData({ busy: true }); try { const path = await sg.chooseImage(); const ref = await sg.upload(path, true); this.setData(e.currentTarget.dataset.member ? { 'member.avatar': ref, 'member.avatarUrl': path } : { 'form.cover': ref, 'form.coverUrl': path }); } catch (e) { if (!String(e.errMsg || '').includes('cancel')) this.setData({ error: e.message || '图片上传失败' }); } finally { this.setData({ busy: false }); } },
  async save() {
    if (this.data.busy) return; this.setData({ busy: true, error: '' });
    try { const f = this.data.form, s = this.data.editing; const body = { id: f.id, name: f.name, cover: f.cover, letter: f.letter, enabled: f.enabled, albumId: f.albumId }; if (s) body.version = s.version; else { body.boyId = f.boyId; body.girlId = f.girlId; } await sg.api(`admin/shiguang${s ? `/${s.id}` : ''}`, s ? 'PUT' : 'POST', body); this.cancel(); await Promise.all([this.load(), this.loadOptions()]); }
    catch (e) { this.setData({ error: e.message }); } finally { this.setData({ busy: false }); }
  },
  async remove(e) { if (this.data.busy || !await sg.confirm('删除后停止双方访问，保留永久成员绑定及全部历史数据。确认删除？')) return; this.setData({ busy: true }); try { const s = this.data.items.find(s => s.id === e.currentTarget.dataset.id); await sg.api(`admin/shiguang/${s.id}`, 'DELETE', { version: s.version }); await this.load(this.data.page); } catch (e) { this.setData({ error: e.message }); } finally { this.setData({ busy: false }); } },
  async editMember(e) { const s = this.data.items.find(s => s.id === e.currentTarget.dataset.space), m = s.members.find(m => m.userId === e.currentTarget.dataset.user); try { const links = await sg.mediaLinks([m.avatar]); this.setData({ member: { ...m, space: s.id, avatarUrl: links[m.avatar] || m.avatar } }); } catch (e) { this.setData({ error: e.message }); } },
  memberName(e) { this.setData({ 'member.name': e.detail.value }); },
  async saveMember() { if (this.data.busy) return; this.setData({ busy: true }); try { const m = this.data.member; await sg.api(`admin/shiguang/${m.space}`, 'PUT', { operation: 'member', userId: m.userId, name: m.name, avatar: m.avatar }); this.cancel(); await this.load(this.data.page); } catch (e) { this.setData({ error: e.message }); } finally { this.setData({ busy: false }); } },
  previous() { if (this.data.page) this.load(this.data.page - 1); }, next() { if (this.data.hasMore) this.load(this.data.page + 1); },
});
