const shiguang = require('./shiguang');
const { getStoredCookie, subscribeStoredCookieClear } = require('../utils/auth');

let entryCheck = null;

subscribeStoredCookieClear(() => {
  entryCheck = null;
  const data = getApp().globalData;
  data.shiguangEntryChecking = false;
  data.shiguangEntryFailed = false;
});

// 复用页面已有的原生预览标记，选图、预览返回不算重新打开小程序。
function isNativePageReturnExpected() {
  if (getApp().globalData.shiguangMediaChoosing) return true;
  const pages = getCurrentPages(), current = pages[pages.length - 1];
  if (!current) return false;
  const now = Date.now();
  return Boolean(
    current._suppressRefreshOnNextShow && now - current._suppressRefreshMarkedAt < 120000 ||
    current._suppressBootstrapOnNextShow && now - current._suppressBootstrapAt < 120000
  );
}

// App 前台事件与首页共用检查，先确定成员权限，再决定默认入口。
async function enterPreferredSpace() {
  const data = getApp().globalData;
  const cookie = getStoredCookie();
  const sequence = data.appEnterSeq || 0;
  if (!entryCheck || entryCheck.cookie !== cookie || entryCheck.sequence !== sequence) {
    const check = { cookie, sequence, promise: null };
    entryCheck = check;
    data.shiguangEntryChecking = true;
    data.shiguangEntryFailed = false;
    check.promise = shiguang.refreshMembership().then(() => true).catch(() => false).then(ok => {
      if (entryCheck !== check) return false;
      data.shiguangEntryChecking = false;
      if (getStoredCookie() !== cookie) {
        data.shiguangEntryFailed = false;
        return false;
      }
      data.shiguangEntryFailed = !ok;
      return ok;
    });
  }
  const check = entryCheck;
  if (!await check.promise || entryCheck !== check || getStoredCookie() !== cookie) return false;
  return shiguang.preferSpaceEntry({ appEntry: true });
}

module.exports = { enterPreferredSpace, isNativePageReturnExpected };
