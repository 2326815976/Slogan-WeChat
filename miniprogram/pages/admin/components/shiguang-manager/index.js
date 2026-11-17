const sg = require('../../../../services/shiguang');
const { dbQuery, getSession, extractSessionUser } = require('../../../../services/photo-api');
const { hasAdminAccess } = require('../../../../utils/admin-access');

Component({
  // 接收后台既有按钮、分页和弹窗样式，业务状态保留在组件内。
  options: { virtualHost: true, styleIsolation: 'apply-shared' },
  data: {
    authorized: false, loading: true, items: [], page: 0, hasMore: false,
    options: { users: [], albums: [] }, available: [], query: '',
    formOpen: false, editing: null, form: {}, member: null, error: '', busy: false,
  },
  lifetimes: {
    attached() { void this.initialize(); },
  },
  methods: {
    async initialize() {
      try {
        const user = extractSessionUser(await getSession());
        if (!user || !user.id || !hasAdminAccess(user)) throw new Error('需要管理员权限');
        this.setData({ authorized: true });
        await Promise.all([this.load(), this.loadOptions()]);
      } catch (error) { this.setData({ error: error.message || '需要管理员权限' }); }
      finally { this.setData({ loading: false }); }
    },
    async load(page = 0) {
      this.setData({ loading: true });
      try {
        const result = await sg.api(`admin/shiguang?page=${page}`);
        // 兼容尚未更新的列表接口，已软删除空间不再展示或请求封面。
        const items = result.items.filter(s => !s.deletedAt);
        const links = await sg.mediaLinks(items.map(s => s.cover));
        this.setData({ items: items.map(s => ({ ...s, coverUrl: links[s.cover] || s.cover })), page, hasMore: result.hasMore });
      } catch (e) { this.setData({ error: e.message }); }
      finally { this.setData({ loading: false }); }
    },
    async loadOptions() {
      try {
        const options = await sg.api('admin/shiguang?options=1');
        // 旧接口的用户文案没有 ID，新旧接口统一展示且避免重复添加。
        options.users = options.users.map(u => {
          const prefix = `${u.id.slice(-6)} · `;
          return { ...u, label: u.label.startsWith(prefix) ? u.label : `${prefix}${u.label}` };
        });
        // 云端选项尚未更新时，通过既有管理员查询接口批量补齐空间密钥。
        const missingLabels = options.albums.filter(a => !a.label);
        const keys = new Map();
        if (missingLabels.length) {
          const result = await dbQuery({
            table: 'albums', action: 'select', columns: 'id,access_key',
            filters: [{ column: 'id', operator: 'in', value: missingLabels.map(a => a.id) }],
          });
          if (result.error) throw new Error(result.error.message || '获取专属空间密钥失败');
          (result.data || []).forEach(a => keys.set(a.id, String(a.access_key || '').trim()));
        }
        options.albums = options.albums.map(a => ({ ...a, label: a.label || `${a.title} · ${keys.get(a.id) || '未设置密钥'}` }));
        this.setData({ options, available: options.users.filter(u => !u.bound) });
      } catch (e) { this.setData({ error: e.message }); }
    },
    search(e) {
      const query = e.detail.value;
      this.setData({ query, available: this.data.options.users.filter(u => !u.bound && u.id.toLowerCase().includes(query.trim().toLowerCase())) });
    },
    open(e) {
      if (this.data.busy) return;
      const s = this.data.items.find(s => s.id === e.currentTarget.dataset.id);
      const album = this.data.options.albums.find(a => a.id === (s && s.albumId));
      this.setData({
        formOpen: true, editing: s || null, error: '', query: '',
        available: this.data.options.users.filter(u => !u.bound),
        form: {
          id: s ? s.id : sg.uuid(), name: s ? s.name : '', cover: s ? s.cover : '', coverUrl: s ? s.coverUrl : '',
          letter: s ? s.letter : '', enabled: s ? s.enabled : true, albumId: s ? s.albumId : '',
          albumName: album ? album.label : '', boyId: '', girlId: '', boyName: '', girlName: '',
        },
      });
    },
    input(e) { this.setData({ [`form.${e.currentTarget.dataset.key}`]: e.detail.value }); },
    enabled(e) { this.setData({ 'form.enabled': e.detail.value }); },
    album(e) {
      const a = this.data.options.albums[Number(e.detail.value)];
      if (a) this.setData({ 'form.albumId': a.id, 'form.albumName': a.label });
    },
    user(e) {
      const role = e.currentTarget.dataset.role, u = this.data.available[Number(e.detail.value)];
      if (!u) return;
      if (u.id === this.data.form[role === 'boy' ? 'girlId' : 'boyId']) {
        this.setData({ error: '男生女生必须为不同账号' }); return;
      }
      this.setData({ error: '', [`form.${role}Id`]: u.id, [`form.${role}Name`]: u.label });
    },
    cancel() { if (!this.data.busy) this.setData({ formOpen: false, member: null, error: '' }); },
    stopTap() {},
    async image(e) {
      if (this.data.busy) return;
      this.setData({ busy: true, error: '' });
      try {
        const path = await sg.chooseImage();
        const ref = await sg.upload(path, true);
        this.setData(e.currentTarget.dataset.member ? { 'member.avatar': ref, 'member.avatarUrl': path } : { 'form.cover': ref, 'form.coverUrl': path });
      } catch (e) {
        if (!String(e.errMsg || '').includes('cancel')) this.setData({ error: e.message || '图片上传失败' });
      } finally { this.setData({ busy: false }); }
    },
    async save() {
      if (this.data.busy) return;
      this.setData({ busy: true, error: '' });
      try {
        const f = this.data.form, s = this.data.editing;
        const body = { id: f.id, name: f.name, cover: f.cover, letter: f.letter, enabled: f.enabled, albumId: f.albumId };
        // 修改空间资料不提交成员 ID，保持成员永久绑定规则。
        if (s) body.version = s.version;
        else { body.boyId = f.boyId; body.girlId = f.girlId; }
        await sg.api(`admin/shiguang${s ? `/${s.id}` : ''}`, s ? 'PUT' : 'POST', body);
        this.setData({ formOpen: false });
        await Promise.all([this.load(s ? this.data.page : 0), this.loadOptions()]);
      } catch (e) { this.setData({ error: e.message }); }
      finally { this.setData({ busy: false }); }
    },
    async remove(e) {
      if (this.data.busy || !await sg.confirm('删除后停止双方访问，保留永久成员绑定及全部历史数据。确认删除？')) return;
      this.setData({ busy: true, error: '' });
      try {
        const s = this.data.items.find(s => s.id === e.currentTarget.dataset.id);
        await sg.api(`admin/shiguang/${s.id}`, 'DELETE', { version: s.version });
        await this.load(this.data.page);
      } catch (e) { this.setData({ error: e.message }); }
      finally { this.setData({ busy: false }); }
    },
    async editMember(e) {
      if (this.data.busy) return;
      const s = this.data.items.find(s => s.id === e.currentTarget.dataset.space);
      const m = s.members.find(m => m.userId === e.currentTarget.dataset.user);
      this.setData({ member: { ...m, space: s.id, avatarUrl: '' }, error: '' });
      try {
        const links = await sg.mediaLinks([m.avatar]);
        // 关闭或切换编辑对象后，不让异步头像结果重新打开弹窗。
        if (this.data.member && this.data.member.userId === m.userId) this.setData({ 'member.avatarUrl': links[m.avatar] || m.avatar });
      } catch (e) { this.setData({ error: e.message }); }
    },
    memberName(e) { this.setData({ 'member.name': e.detail.value }); },
    async saveMember() {
      if (this.data.busy) return;
      this.setData({ busy: true, error: '' });
      try {
        const m = this.data.member;
        await sg.api(`admin/shiguang/${m.space}`, 'PUT', { operation: 'member', userId: m.userId, name: m.name, avatar: m.avatar });
        this.setData({ member: null });
        await this.load(this.data.page);
      } catch (e) { this.setData({ error: e.message }); }
      finally { this.setData({ busy: false }); }
    },
    previous() { if (this.data.page && !this.data.loading && !this.data.busy) void this.load(this.data.page - 1); },
    next() { if (this.data.hasMore && !this.data.loading && !this.data.busy) void this.load(this.data.page + 1); },
  },
});
