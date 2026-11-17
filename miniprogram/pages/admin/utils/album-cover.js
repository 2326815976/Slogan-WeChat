// 管理端封面压缩：专属空间与拾光空间共用尺寸、质量和失败回退规则。
const ALBUM_COVER_TARGET_SIZE = 900 * 1024;
const ALBUM_COVER_MAX_LONG_EDGE = 1920;
const ALBUM_COVER_COMPRESS_QUALITIES = [86, 78, 70, 62];

function getLocalFileSize(path) {
  const filePath = String(path || "").trim();
  if (!filePath) return Promise.resolve(0);
  return new Promise((resolve) => {
    wx.getFileInfo({
      filePath,
      success: (res) => {
        const size = Number((res && res.size) || 0);
        resolve(Number.isFinite(size) && size > 0 ? size : 0);
      },
      fail: () => resolve(0),
    });
  });
}

function readImageInfo(path) {
  const src = String(path || "").trim();
  if (!src) return Promise.resolve(null);
  return new Promise((resolve) => {
    wx.getImageInfo({
      src,
      success: (res) => resolve(res || null),
      fail: () => resolve(null),
    });
  });
}

function buildCompressedSize(width, height, maxLongEdge) {
  const w = Number(width || 0);
  const h = Number(height || 0);
  const maxEdge = Number(maxLongEdge || 0);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0 || maxEdge <= 0) {
    return null;
  }
  const longEdge = Math.max(w, h);
  if (longEdge <= maxEdge) {
    return null;
  }
  const ratio = maxEdge / longEdge;
  return {
    width: Math.max(1, Math.round(w * ratio)),
    height: Math.max(1, Math.round(h * ratio)),
  };
}

function compressImageFile(path, quality, maxLongEdge) {
  const src = String(path || "").trim();
  const q = Math.max(1, Math.min(100, Number(quality || 0) || 80));
  if (!src) return Promise.resolve("");
  const maxEdge = Math.max(0, Number(maxLongEdge || 0));
  return readImageInfo(src)
    .then((info) => {
      const options = {
        src,
        quality: q,
      };
      const compressedSize = buildCompressedSize(info && info.width, info && info.height, maxEdge);
      if (compressedSize) {
        options.compressedWidth = compressedSize.width;
        options.compressedHeight = compressedSize.height;
      }
      return new Promise((resolve) => {
        wx.compressImage({
          ...options,
          success: (res) => {
            const nextPath = String((res && res.tempFilePath) || "").trim();
            resolve(nextPath || "");
          },
          fail: () => resolve(""),
        });
      });
    })
    .then((resultPath) => {
      if (resultPath) {
        return resultPath;
      }
      return new Promise((resolve) => {
        wx.compressImage({
          src,
          quality: q,
          success: (res) => {
            const nextPath = String((res && res.tempFilePath) || "").trim();
            resolve(nextPath || "");
          },
          fail: () => resolve(""),
        });
      });
    });
}

async function optimizeAlbumCoverPath(path) {
  const filePath = String(path || "").trim();
  if (!filePath) {
    return {
      path: "",
      compressed: false,
      notice: "",
    };
  }

  let bestPath = "";
  let bestSize = 0;

  for (let i = 0; i < ALBUM_COVER_COMPRESS_QUALITIES.length; i += 1) {
    // 从原图压缩，避免多次有损叠加导致画质劣化。
    // eslint-disable-next-line no-await-in-loop
    const compressedPath = await compressImageFile(
      filePath,
      ALBUM_COVER_COMPRESS_QUALITIES[i],
      ALBUM_COVER_MAX_LONG_EDGE
    );
    if (!compressedPath) continue;

    // eslint-disable-next-line no-await-in-loop
    const compressedSize = await getLocalFileSize(compressedPath);
    if (!bestPath) {
      bestPath = compressedPath;
      bestSize = compressedSize;
    } else if (compressedSize > 0 && (bestSize <= 0 || compressedSize < bestSize)) {
      bestPath = compressedPath;
      bestSize = compressedSize;
    }

    if (compressedSize > 0 && compressedSize <= ALBUM_COVER_TARGET_SIZE) {
      break;
    }
  }

  if (!bestPath) {
    return {
      path: filePath,
      compressed: false,
      notice: "封面压缩失败，已自动回退原图",
    };
  }

  return {
    path: bestPath,
    compressed: true,
    notice: "",
  };
}

module.exports = { optimizeAlbumCoverPath };
