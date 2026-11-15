const { requestJson } = require('../services/photo-api');
const {
  getHomeRedirectPath,
  getManagedPageAccess,
  normalizeRuntimeConfig,
} = require('./runtime-config');

function normalizeMiniProgramPath(value) {
  return String(value || '').trim().replace(/^\/+/, '');
}

function resolveCurrentRoutePath() {
  try {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    const currentPage = Array.isArray(pages) && pages.length > 0 ? pages[pages.length - 1] : null;
    return normalizeMiniProgramPath(currentPage && currentPage.route);
  } catch (error) {
    return '';
  }
}

function resolveHomeFallbackTab(app, currentRoute) {
  const globalData = app && app.globalData ? app.globalData : {};
  const runtimeConfig = normalizeRuntimeConfig(globalData.runtimeConfig);
  const normalizedCurrentRoute = normalizeMiniProgramPath(currentRoute);
  const homePath = normalizeMiniProgramPath(getHomeRedirectPath(runtimeConfig));
  if (homePath && homePath !== normalizedCurrentRoute) {
    return homePath;
  }

  const enabledItems = Array.isArray(runtimeConfig.tabBarItems)
    ? runtimeConfig.tabBarItems.filter((item) => item && item.enabled)
    : [];
  const firstTab = enabledItems[0] || null;
  const firstTabPath = normalizeMiniProgramPath((firstTab && firstTab.pagePath) || '');
  return firstTabPath !== normalizedCurrentRoute ? firstTabPath : '';
}

function hasErrorMessage(error, keywords) {
  const message = String((error && error.message) || '').toLowerCase();
  if (!message) return false;
  return keywords.some((keyword) => message.includes(String(keyword || '').toLowerCase()));
}

function isMissingPageAccessEndpointError(error) {
  const statusCode = Number((error && error.statusCode) || 0);
  if (statusCode === 404 || statusCode === 405) {
    return true;
  }
  return hasErrorMessage(error, ['not found', 'no route', 'route not found', '/api/page-center/access']);
}

function isTransientPageAccessError(error) {
  const statusCode = Number((error && error.statusCode) || 0);
  const code = String((error && error.code) || '').trim().toUpperCase();
  if (statusCode >= 500) {
    return true;
  }
  if (code === 'TRANSIENT_BACKEND') {
    return true;
  }
  return hasErrorMessage(error, [
    'service unavailable',
    'temporarily unavailable',
    'retry later',
    'backend recovery',
    'cold start',
  ]);
}

function isLegacyPageAccessPayload(payload) {
  const reason = String((payload && payload.reason) || '').trim().toLowerCase();
  const source = String((payload && payload.source) || '').trim().toLowerCase();
  return (
    reason.startsWith('legacy_') ||
    source.startsWith('legacy_') ||
    source === 'legacy_compatible' ||
    source === 'page_center_with_legacy'
  );
}

function resolveLocalPageAccess(app, pageKey, presentationMode) {
  const globalData = app && app.globalData ? app.globalData : {};
  if (!Boolean(globalData.auditConfigReady)) {
    return null;
  }
  const runtimeConfig = normalizeRuntimeConfig(globalData.runtimeConfig);
  const managedAccess = getManagedPageAccess(runtimeConfig, pageKey);
  if (!managedAccess) {
    return null;
  }

  const publishState = String(managedAccess.publishState || '').trim().toLowerCase();
  if (!publishState) {
    return null;
  }

  if (presentationMode === 'preview') {
    return null;
  }

  if (presentationMode === 'beta') {
    if (publishState !== 'beta') {
      return {
        allowed: false,
        reason: publishState === 'offline' ? 'offline' : 'beta_disabled',
        data: managedAccess,
        source: 'runtime_config',
      };
    }
    return null;
  }

  if (publishState === 'online') {
    return {
      allowed: true,
      reason: 'runtime_online',
      data: managedAccess,
      source: 'runtime_config',
    };
  }

  return {
    allowed: false,
    reason: publishState === 'beta' ? 'beta_preview_only' : 'offline',
    data: managedAccess,
    source: 'runtime_config',
  };
}

async function checkMiniProgramPageAccess(pageKey, presentationMode) {
  const params = [
    'page_key=' + encodeURIComponent(String(pageKey || '').trim()),
    'channel=miniprogram',
  ];
  if (presentationMode === 'preview' || presentationMode === 'beta') {
    params.push('presentation=' + encodeURIComponent(presentationMode));
  }

  const payload = await requestJson('/api/page-center/access?' + params.join('&'), {
    method: 'GET',
    timeout: 10000,
  });
  return payload;
}

function redirectToTab(tabPath) {
  const nextTab = normalizeMiniProgramPath(tabPath) || 'pages/index/index';
  wx.switchTab({ url: '/' + nextTab });
}

function relaunchToRoute(routePath) {
  const route = String(routePath || '').trim();
  if (!route) return false;
  wx.reLaunch({ url: route });
  return true;
}

function redirectToFallback(app, options) {
  const current = options && typeof options === 'object' ? options : {};
  const currentRoute = normalizeMiniProgramPath(current.currentRoute || resolveCurrentRoutePath());
  const preferredTab = normalizeMiniProgramPath(current.fallbackTab || '');
  const previewDeniedRoute = String(current.previewDeniedRoute || '').trim() || '/pages/profile/beta/index';

  if (preferredTab && preferredTab !== currentRoute) {
    redirectToTab(preferredTab);
    return;
  }

  const runtimeFallbackTab = resolveHomeFallbackTab(app, currentRoute);
  if (runtimeFallbackTab && runtimeFallbackTab !== currentRoute) {
    redirectToTab(runtimeFallbackTab);
    return;
  }

  relaunchToRoute(previewDeniedRoute);
}

async function guardMiniProgramPageAccess(options) {
  const current = options && typeof options === 'object' ? options : {};
  const pageKey = String(current.pageKey || '').trim();
  if (!pageKey) {
    return { allowed: true, reason: 'missing_page_key' };
  }

  const app = typeof getApp === 'function' ? getApp() : null;
  const rawPresentationMode = String(current.presentationMode || '').trim().toLowerCase();
  const presentationMode =
    rawPresentationMode === 'preview'
      ? 'preview'
      : rawPresentationMode === 'beta'
        ? 'beta'
        : 'tabbar';
  const isStandalone = presentationMode === 'preview' || presentationMode === 'beta';
  const previewDeniedRoute = String(current.previewDeniedRoute || '').trim() || '/pages/profile/beta/index';
  const currentRoute = resolveCurrentRoutePath();
  const fallbackTab = normalizeMiniProgramPath(current.fallbackTab || resolveHomeFallbackTab(app, currentRoute));
  const localAccessResult = resolveLocalPageAccess(app, pageKey, presentationMode);

  if (localAccessResult) {
    if (localAccessResult.allowed) {
      return localAccessResult;
    }

    if (isStandalone) {
      relaunchToRoute(previewDeniedRoute);
    } else {
      redirectToFallback(app, { currentRoute, fallbackTab, previewDeniedRoute });
    }
    return localAccessResult;
  }

  try {
    const payload = await checkMiniProgramPageAccess(pageKey, presentationMode);
    if (payload && payload.allowed === true && isLegacyPageAccessPayload(payload)) {
      if (isStandalone) {
        relaunchToRoute(previewDeniedRoute);
      } else {
        redirectToFallback(app, { currentRoute, fallbackTab, previewDeniedRoute });
      }
      return { allowed: false, reason: 'legacy_beta_disabled' };
    }
    if (payload && payload.allowed === true) {
      return { allowed: true, reason: String(payload.reason || 'allowed'), data: payload.data || null };
    }

    const reason = String((payload && payload.reason) || 'forbidden');
    if (isStandalone) {
      relaunchToRoute(previewDeniedRoute);
    } else {
      redirectToFallback(app, { currentRoute, fallbackTab, previewDeniedRoute });
    }
    return { allowed: false, reason };
  } catch (error) {
    if (isMissingPageAccessEndpointError(error) || isTransientPageAccessError(error)) {
      const missingEndpoint = isMissingPageAccessEndpointError(error);
      // 没有可验证的发布规则时不开放页面，也不在几个未确认的页面之间循环跳转。
      wx.showToast({ title: '页面配置加载失败，请稍后重试', icon: 'none' });
      return {
        allowed: false,
        reason: missingEndpoint ? 'access_endpoint_unavailable' : 'access_check_transient_failure',
        error: error && error.message ? String(error.message) : '请求失败',
      };
    }

    if (isStandalone) {
      relaunchToRoute(previewDeniedRoute);
    } else {
      redirectToFallback(app, { currentRoute, fallbackTab, previewDeniedRoute });
    }
    return {
      allowed: false,
      reason: 'request_failed',
      error: error && error.message ? String(error.message) : '请求失败',
    };
  }
}

module.exports = {
  guardMiniProgramPageAccess,
};
