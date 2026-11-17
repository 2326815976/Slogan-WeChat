const sg = require('../../services/shiguang');
Page({
  data: { summary: null, pool: [], poolCount: 0, canDraw: false, own: [], tickets: [], grants: [], balance: 0, partnerBalance: 0, partnerName: '', angle: 0, gradient: '#FBEFCB', amount: '1', form: '', name: '', content: '', editing: null, busy: false, message: '', error: '', ticketMore: false, grantMore: false },
  onShow() { this.load(); this.timer = setInterval(() => { if (!this.data.busy) this.load(); }, 5000); },
  onHide() { clearInterval(this.timer); }, onUnload() { clearInterval(this.timer); },
  async history(resource, page = 0) {
    const result = await sg.api(`/${resource}?page=${page}`), s = this.data.summary;
    const name = id => (s.space.members.find(m => m.userId === id) || {}).name || '成员';
    const items = result.items.map(r => resource === 'tickets' ? { ...r, provider: name(r.providerId), holder: name(r.holderId), time: sg.time(r.obtainedAt), usedTime: sg.time(r.usedAt), canRedeem: r.providerId === s.userId && r.status === 'unused' } : { ...r, giver: name(r.giverId), receiver: name(r.receiverId), time: sg.time(r.createdAt) });
    this[`${resource}Page`] = page;
    this.setData({ [resource]: page ? this.data[resource].concat(items) : items, [resource === 'tickets' ? 'ticketMore' : 'grantMore']: result.hasMore });
  },
  async load() {
    if (this.loading) return; this.loading = true;
    try {
      const responses = await Promise.all([sg.api(), sg.api('/prizes')]);
      const s = responses[0], result = responses[1];
      const partner = s.space.members.find(m => m.userId !== s.userId);
      const pool = result.items.filter(p => p.providerId !== s.userId).map((p, i, list) => ({ ...p, time: sg.time(p.createdAt), labelStyle: `transform:rotate(${(i + .5) * 360 / list.length - 90}deg) translateX(20rpx)` }));
      this.setData({ summary: s, pool, poolCount: pool.length, canDraw: pool.length > 0 && s.balances[s.userId] > 0, own: result.items.filter(p => p.providerId === s.userId).map(p => ({ ...p, time: sg.time(p.createdAt) })), balance: s.balances[s.userId], partnerBalance: s.balances[partner.userId], partnerName: partner.name, gradient: pool.length ? `conic-gradient(${pool.map((p, i) => `${['#FFE2AE', '#F6C6C6', '#DCE7D1', '#FBEFCB'][i % 4]} ${i * 100 / pool.length}% ${(i + 1) * 100 / pool.length}%`).join(',')})` : '#FBEFCB' });
      await Promise.all([this.history('tickets'), this.history('grants')]);
    } catch (e) { sg.fail(this, e); } finally { this.loading = false; }
  },
  input(e) { this.setData({ [e.currentTarget.dataset.key]: e.detail.value }); },
  openForm(e) { const mode = e.currentTarget.dataset.mode, id = e.currentTarget.dataset.id; const prize = id ? this.data.own.find(p => p.id === id) : null; this.prizeId = prize ? prize.id : sg.uuid(); this.setData({ form: mode, editing: prize, name: prize ? prize.name : '', content: prize ? prize.content : '' }); },
  cancel() { this.setData({ form: '', editing: null }); },
  async action(operation, data = {}) {
    if (this.data.busy) return; this.setData({ busy: true, error: '', message: '' });
    const key = JSON.stringify([operation, data]);
    if (!this.request || this.request.key !== key) this.request = { key, id: sg.uuid() };
    try {
      const result = await sg.api('/actions', 'POST', { operation, requestId: this.request.id, ...data }); this.request = null;
      if (operation === 'draw') { const i = Math.max(0, this.data.pool.findIndex(p => p.id === result.prizeId)); this.setData({ angle: Math.ceil(this.data.angle / 360) * 360 + 1440 + 360 - (i + .5) * 360 / Math.max(1, this.data.pool.length), message: `抽中了「${result.name}」，已经放入你的奖券。` }); }
      else this.setData({ message: operation === 'grant' ? '抽奖次数已送达' : operation === 'gift' ? '心意已送达' : '已记录兑现时间' });
      this.cancel(); await this.load();
    } catch (e) { sg.fail(this, e); } finally { this.setData({ busy: false }); }
  },
  draw() { if (this.data.balance > 0 && this.data.pool.length) this.action('draw'); },
  grant() { this.action('grant', { amount: Number(this.data.amount) }); },
  async redeem(e) { if (await sg.confirm('确认已经为对方兑现这张券？')) this.action('redeem', { ticketId: e.currentTarget.dataset.id }); },
  async save() { if (this.data.form === 'gift') return this.action('gift', { name: this.data.name, content: this.data.content }); if (this.data.busy) return; this.setData({ busy: true }); try { const p = this.data.editing; await sg.api(`/prizes${p ? `/${p.id}` : ''}`, p ? 'PUT' : 'POST', { id: this.prizeId, version: p && p.version, name: this.data.name, content: this.data.content }); this.cancel(); await this.load(); } catch (e) { sg.fail(this, e); } finally { this.setData({ busy: false }); } },
  async remove(e) { if (this.data.busy || !await sg.confirm('删除这个奖项？已获得的券会保留。')) return; this.setData({ busy: true }); try { const p = this.data.own.find(p => p.id === e.currentTarget.dataset.id); await sg.api(`/prizes/${p.id}`, 'DELETE', { version: p.version }); await this.load(); } catch (e) { sg.fail(this, e); } finally { this.setData({ busy: false }); } },
  more(e) { const resource = e.currentTarget.dataset.resource; this.history(resource, (this[`${resource}Page`] || 0) + 1).catch(e => sg.fail(this, e)); },
});
