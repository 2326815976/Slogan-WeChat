const {
  buildRuntimeConfigPreset,
  getDisplayedTabBarItems,
  isTabBarPagePath,
  normalizeRuntimeConfig,
} = require("../utils/runtime-config");
const {
  normalizeMiniProgramRoutePath,
  resolvePagePresentationState,
} = require("../utils/page-presentation");

const shiguang = require('../services/shiguang');
const TAB_SWITCH_TIMEOUT_MS = 3000;

const ICON_PATH_MAP = {
  hearts: { normal: '/images/tab/hearts.svg', active: '/images/tab/hearts-active.svg' },
  home: {
    normal: "/images/tab/house.svg",
    active: "/images/tab/house-active.svg",
  },
  album: {
    normal: "/images/tab/lock.svg",
    active: "/images/tab/lock-active.svg",
  },
  gallery: {
    normal: "/images/tab/image.svg",
    active: "/images/tab/image-active.svg",
  },
  booking: {
    normal: "/images/tab/calendar.svg",
    active: "/images/tab/calendar-active.svg",
  },
  profile: {
    normal: "/images/tab/user.svg",
    active: "/images/tab/user-active.svg",
  },
};

function hydrateTabBarItems(runtimeConfig, isLoggedIn) {
  return shiguang.withSpaceTab(getDisplayedTabBarItems(runtimeConfig, isLoggedIn), isLoggedIn).map((item) => {
    const iconConfig = ICON_PATH_MAP[item.iconKey] || ICON_PATH_MAP.profile;
    return {
      key: item.key,
      pagePath: item.pagePath,
      text: item.displayText,
      iconPath: iconConfig.normal,
      selectedIconPath: iconConfig.active,
    };
  });
}

function resolveCurrentRouteFromStack() {
  try {
    const pages = typeof getCurrentPages === "function" ? getCurrentPages() : [];
    const currentPage = Array.isArray(pages) && pages.length > 0 ? pages[pages.length - 1] : null;
    return normalizeMiniProgramRoutePath(currentPage && currentPage.route);
  } catch (error) {
    return "";
  }
}

Component({
  data: {
    selected: 0,
    selectedPath: "",
    visible: false,
    isLoggedIn: false,
    runtimeConfigReady: false,
    presentationMode: "tabbar",
    hasBottomTabbar: true,
    runtimeConfig: buildRuntimeConfigPreset("standard"),
    list: [],
  },
  lifetimes: {
    attached() {
      this._detached = false;
      const app = typeof getApp === "function" ? getApp() : null;
      const globalData = app && app.globalData ? app.globalData : {};
      const auditConfigReady = Boolean(globalData.auditConfigReady);
      const bootRuntimeConfig = globalData.runtimeConfig || buildRuntimeConfigPreset("standard");

      // 先使用当前会话已确认的状态，避免每个 Tab 首帧都退回游客菜单。
      this._unsubscribeMembership = shiguang.subscribeMembership((member) => {
        this.applyLoginState(Boolean(member && member.userId));
      });

      // 先用现有配置绘制菜单，远端配置就绪前暂不响应导航。
      this.applyRuntimeConfig(bootRuntimeConfig);

      if (!auditConfigReady && app && typeof app.ensureAuditConfig === "function") {
        app.ensureAuditConfig().catch(() => {});
      }

      if (app && typeof app.subscribeMiniProgramRuntimeConfig === "function") {
        this._unsubscribeRuntimeConfig = app.subscribeMiniProgramRuntimeConfig((runtimeConfig) => {
          this.applyRuntimeConfig(runtimeConfig);
        });
      }

      if (app && typeof app.subscribePagePresentation === "function") {
        this._unsubscribePresentation = app.subscribePagePresentation((presentation) => {
          this.applyPresentation(presentation);
        });
      } else if (app && typeof app.getPagePresentation === "function") {
        this.applyPresentation(app.getPagePresentation());
      }

      if (app && typeof app.subscribeBackendStatus === "function") {
        this._unsubscribeBackendStatus = app.subscribeBackendStatus((status) => {
          if (status && status.backendReady) {
            this.refreshLoginState();
          }
        });
      }

      this.refreshLoginState();
    },
    detached() {
      this._detached = true;
      if (this._unsubscribeMembership) this._unsubscribeMembership();
      this._unsubscribeMembership = null;
      this.releaseSwitchLock();
      if (typeof this._unsubscribeRuntimeConfig === "function") {
        this._unsubscribeRuntimeConfig();
      }
      this._unsubscribeRuntimeConfig = null;
      if (typeof this._unsubscribePresentation === "function") {
        this._unsubscribePresentation();
      }
      this._unsubscribePresentation = null;
      if (typeof this._unsubscribeBackendStatus === "function") {
        this._unsubscribeBackendStatus();
      }
      this._unsubscribeBackendStatus = null;
    },
  },
  pageLifetimes: {
    show() {
      this.releaseSwitchLock();
      const app = typeof getApp === "function" ? getApp() : null;
      if (app && typeof app.getPagePresentation === "function") {
        this.applyPresentation(app.getPagePresentation());
      }
      this.setData({ selectedPath: resolveCurrentRouteFromStack() });
      this.refreshLoginState();
      this.applyList(Array.isArray(this.data.list) ? this.data.list : []);
    },
  },
  methods: {
    releaseSwitchLock() {
      if (this._switchLockTimer) {
        clearTimeout(this._switchLockTimer);
      }
      this._switchLockTimer = null;
      this._switchingPath = "";
    },

    applyList(list) {
      const nextList = Array.isArray(list) ? list : [];
      const pendingPath = String(this._switchingPath || "")
        .trim()
        .replace(/^\/+/, "");
      const selectedPath = String(this.data.selectedPath || "")
        .trim()
        .replace(/^\/+/, "");
      const currentRoute = resolveCurrentRouteFromStack();
      const selectedIndex = Number(this.data.selected);

      let nextSelected = -1;
      if (pendingPath) {
        nextSelected = nextList.findIndex((item) => item.pagePath === pendingPath);
      }
      if (nextSelected < 0 && currentRoute) {
        nextSelected = nextList.findIndex((item) => item.pagePath === currentRoute);
      }
      if (nextSelected < 0 && selectedPath) {
        nextSelected = nextList.findIndex((item) => item.pagePath === selectedPath);
      }
      if (nextSelected < 0) {
        const safeIndex = Number.isFinite(selectedIndex) ? Math.round(selectedIndex) : 0;
        nextSelected = safeIndex >= 0 && safeIndex < nextList.length ? safeIndex : 0;
      }

      const nextSelectedPath = nextList[nextSelected]
        ? String(nextList[nextSelected].pagePath || "")
        : currentRoute;

      this.setData({
        visible:
          Boolean(this.data.hasBottomTabbar) && nextList.length > 0,
        list: nextList,
        selected: nextSelected < 0 ? 0 : nextSelected,
        selectedPath: nextSelectedPath,
      });
    },

    applyPresentation(presentation) {
      let currentRoute = "";
      try {
        const pages = typeof getCurrentPages === "function" ? getCurrentPages() : [];
        const currentPage = Array.isArray(pages) && pages.length > 0 ? pages[pages.length - 1] : null;
        currentRoute = normalizeMiniProgramRoutePath(currentPage && currentPage.route);
      } catch (error) {
        currentRoute = "";
      }

      const state = resolvePagePresentationState(presentation, currentRoute, this.data.runtimeConfig);
      this.setData({
        presentationMode: state.mode,
        hasBottomTabbar: Boolean(state.hasBottomTabbar),
      });
      this.applyList(Array.isArray(this.data.list) ? this.data.list : []);
    },

    applyRuntimeConfig(runtimeConfig) {
      const app = typeof getApp === "function" ? getApp() : null;
      const normalized = normalizeRuntimeConfig(runtimeConfig);
      const nextList = hydrateTabBarItems(normalized, this.data.isLoggedIn);

      this.setData({
        runtimeConfig: normalized,
        runtimeConfigReady: Boolean(app && app.globalData && app.globalData.auditConfigReady),
        list: nextList,
      });

      if (app && typeof app.getPagePresentation === "function") {
        this.applyPresentation(app.getPagePresentation());
        return;
      }
      this.applyList(nextList);
    },

    applyLoginState(isLoggedIn) {
      const nextLoggedIn = Boolean(isLoggedIn);
      const normalized = normalizeRuntimeConfig(this.data.runtimeConfig);
      const nextList = hydrateTabBarItems(normalized, nextLoggedIn);
      this.setData({
        isLoggedIn: nextLoggedIn,
      });
      this.applyList(nextList);
    },

    async refreshLoginState() {
      const app = typeof getApp === "function" ? getApp() : null;
      const globalData = app && app.globalData ? app.globalData : {};
      if (globalData.cloudRunService && !globalData.backendReady) {
        return;
      }

      try {
        await shiguang.refreshMembership();
        if (!this._detached) shiguang.preferSpaceEntry();
      } catch (error) {
        // 会话服务统一处理权限失效；临时网络错误保留最近确认的菜单。
      }
    },

    syncForPage(pagePath) {
      const app = typeof getApp === "function" ? getApp() : null;
      const globalData = app && app.globalData ? app.globalData : {};
      const normalizedPagePath = normalizeMiniProgramRoutePath(pagePath);
      if (!normalizedPagePath) {
        this.applyList(Array.isArray(this.data.list) ? this.data.list : []);
        return;
      }

      const normalizedRuntimeConfig = normalizeRuntimeConfig(globalData.runtimeConfig);
      const nextList = hydrateTabBarItems(normalizedRuntimeConfig, this.data.isLoggedIn);
      const nextHasBottomTabbar = isTabBarPagePath(normalizedPagePath, normalizedRuntimeConfig);

      this.setData({
        runtimeConfig: normalizedRuntimeConfig,
        runtimeConfigReady: Boolean(globalData.auditConfigReady),
        hasBottomTabbar: nextHasBottomTabbar,
        selectedPath: normalizedPagePath,
        list: nextList,
      });
      this.applyList(nextList);
    },

    switchTab(e) {
      if (!this.data.runtimeConfigReady) return;
      const path = String(
        (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.path) || ""
      )
        .trim()
        .replace(/^\/+/, "");
      if (!path) return;

      const list = Array.isArray(this.data.list) ? this.data.list : [];
      const currentRoute = resolveCurrentRouteFromStack();
      const index = list.findIndex((item) => item.pagePath === path);

      if (currentRoute === path) {
        this.releaseSwitchLock();
        this.applyList(list);
        return;
      }

      if (this._switchingPath) {
        return;
      }

      this._switchingPath = path;

      if (index >= 0) {
        this.setData({ selected: index, selectedPath: path });
      } else {
        this.setData({ selectedPath: path });
      }

      const revertSelection = () => {
        const fallbackPath = currentRoute || resolveCurrentRouteFromStack();
        const fallbackIndex = list.findIndex((item) => item.pagePath === fallbackPath);
        this.releaseSwitchLock();
        if (fallbackIndex >= 0) {
          this.setData({
            selected: fallbackIndex,
            selectedPath: fallbackPath,
          });
        } else {
          this.setData({ selectedPath: fallbackPath });
        }
        this.applyList(list);
      };

      const app = typeof getApp === "function" ? getApp() : null;
      if (app && typeof app.resetPagePresentation === "function") {
        app.resetPagePresentation({ silent: true });
        if (typeof app.getPagePresentation === "function") {
          this.applyPresentation(app.getPagePresentation());
        }
      }
      this._switchLockTimer = setTimeout(() => {
        if (String(this._switchingPath || "") !== path) return;
        const activePath = resolveCurrentRouteFromStack();
        if (activePath === path) {
          this.releaseSwitchLock();
          return;
        }
        revertSelection();
      }, TAB_SWITCH_TIMEOUT_MS);
      const navigate = path === 'pages/shiguang/index' ? wx.reLaunch : wx.switchTab;
      navigate({
        url: `/${path}`,
        success: () => {
          this.releaseSwitchLock();
        },
        fail: revertSelection,
      });
    },
  },
});

