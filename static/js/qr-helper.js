/**
 * QR Canvas helper using qrcode-generator
 * Provides QRCode.toCanvas(canvas, text, options, callback) compatible API
 */
window.QRCode = (function() {
  function toCanvas(canvas, text, opts, cb) {
    if (typeof opts === 'function') {
      cb = opts;
      opts = {};
    }
    opts = opts || {};
    const size = opts.width || 200;
    const margin = opts.margin !== undefined ? opts.margin : 4;

    try {
      const qr = qrcode(0, 'M'); // type 0 = auto, error correction M
      qr.addData(text);
      qr.make();

      const moduleCount = qr.getModuleCount();
      const cellSize = Math.floor(size / (moduleCount + margin * 2));
      const totalSize = cellSize * (moduleCount + margin * 2);

      canvas.width = totalSize;
      canvas.height = totalSize;
      const ctx = canvas.getContext('2d');

      // White background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, totalSize, totalSize);

      // Draw modules
      ctx.fillStyle = '#000000';
      for (let row = 0; row < moduleCount; row++) {
        for (let col = 0; col < moduleCount; col++) {
          if (qr.isDark(row, col)) {
            ctx.fillRect(
              (col + margin) * cellSize,
              (row + margin) * cellSize,
              cellSize,
              cellSize
            );
          }
        }
      }

      if (cb) cb(null);
    } catch (err) {
      if (cb) cb(err);
    }
  }

  function toDataURL(text, opts, cb) {
    if (typeof opts === 'function') {
      cb = opts;
      opts = {};
    }
    opts = opts || {};
    const canvas = document.createElement('canvas');
    toCanvas(canvas, text, opts, function(err) {
      if (err) { cb(err); return; }
      cb(null, canvas.toDataURL());
    });
  }

  return { toCanvas: toCanvas, toDataURL: toDataURL };
})();
